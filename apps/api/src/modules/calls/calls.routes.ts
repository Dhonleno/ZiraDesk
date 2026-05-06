import type { FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { getSocketServer } from '../../socket/index.js';
import {
  conversationParamsSchema,
  makeCallBodySchema,
} from './calls.schema.js';
import {
  ensureCallRecordsInfrastructure,
  generateAccessToken,
  insertRecordingMessage,
  makeCall,
  normalizePhoneToE164,
  saveCallRecord,
  updateCallRecordingBySid,
  updateCallStatusBySid,
} from './calls.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt];

interface TwilioTenant {
  id: string;
  schemaName: string;
}

const UUID_V4_LIKE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const callRecordsTableCache = new Map<string, boolean>();

function parseTwilioPayload(payload: unknown): Record<string, string> {
  if (!payload) return {};

  if (typeof payload === 'string') {
    return Object.fromEntries(new URLSearchParams(payload).entries());
  }

  if (payload instanceof URLSearchParams) {
    return Object.fromEntries(payload.entries());
  }

  if (typeof payload === 'object') {
    const entries = Object.entries(payload as Record<string, unknown>).map(([key, value]) => {
      if (Array.isArray(value)) return [key, value.join(',')];
      return [key, value == null ? '' : String(value)];
    });
    return Object.fromEntries(entries);
  }

  return {};
}

function asNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeRecordingUrl(url: string): string {
  if (!url) return '';
  return url.endsWith('.mp3') ? url : `${url}.mp3`;
}

function asUuid(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return UUID_V4_LIKE_REGEX.test(normalized) ? normalized : null;
}

function parseTwilioClientIdentity(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.startsWith('client:')) {
    return asUuid(normalized.slice('client:'.length));
  }
  return asUuid(normalized);
}

function extractConversationId(body: Record<string, string>): string | null {
  return asUuid(
    body.ConversationId
    ?? body.conversationId
    ?? body.conversation_id
    ?? body.conversation
    ?? body.Conversation,
  );
}

function extractAgentId(body: Record<string, string>): string | null {
  const candidate = body.AgentId
    ?? body.agentId
    ?? body.agent
    ?? body.Agent
    ?? body.From
    ?? body.Caller;
  return parseTwilioClientIdentity(candidate);
}

function callSidCandidates(body: Record<string, string>): string[] {
  const unique = new Set<string>();
  const values = [body.CallSid, body.ParentCallSid, body.DialCallSid];
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

async function findTenantByConversationId(conversationId: string): Promise<TwilioTenant | null> {
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ['active', 'trial'] } },
    select: { id: true, schemaName: true },
  });

  for (const tenant of tenants) {
    try {
      const record = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id
         FROM "${tenant.schemaName}".conversations
         WHERE id = $1::uuid
         LIMIT 1`,
        conversationId,
      );

      if (record.length > 0) {
        return { id: tenant.id, schemaName: tenant.schemaName };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (!message.includes('conversations')) {
        console.error('[Twilio] Error checking tenant conversation', {
          tenantId: tenant.id,
          error,
        });
      }
    }
  }

  return null;
}

async function findTenantsByCallSid(callSid: string): Promise<TwilioTenant[]> {
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ['active', 'trial'] } },
    select: { id: true, schemaName: true },
  });

  const matched: TwilioTenant[] = [];

  for (const tenant of tenants) {
    try {
      const cached = callRecordsTableCache.get(tenant.schemaName);
      let hasCallRecordsTable = cached;

      if (hasCallRecordsTable === undefined) {
        const existsRows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
          `SELECT EXISTS (
             SELECT 1
             FROM information_schema.tables
             WHERE table_schema = $1
               AND table_name = 'call_records'
           ) AS exists`,
          tenant.schemaName,
        );
        hasCallRecordsTable = Boolean(existsRows[0]?.exists);
        callRecordsTableCache.set(tenant.schemaName, hasCallRecordsTable);
      }

      if (!hasCallRecordsTable) {
        continue;
      }

      const record = await prisma.$queryRawUnsafe<Array<{ call_sid: string }>>(
        `SELECT call_sid
         FROM "${tenant.schemaName}".call_records
         WHERE call_sid = $1
         LIMIT 1`,
        callSid,
      );

      if (record.length > 0) {
        matched.push({ id: tenant.id, schemaName: tenant.schemaName });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (!message.includes('call_records')) {
        console.error('[Twilio] Error checking tenant call record', {
          tenantId: tenant.id,
          error,
        });
      }
    }
  }

  return matched;
}

export async function callsRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      try {
        const payload = Object.fromEntries(new URLSearchParams(String(body)).entries());
        done(null, payload);
      } catch (error) {
        done(error as Error);
      }
    },
  );

  app.get('/token', { preHandler: guard }, async (request, reply) => {
    const token = await generateAccessToken(request.user.id);
    return reply.send({ success: true, token });
  });

  app.post('/twiml/outbound', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const body = parseTwilioPayload(request.body);
    const toPhone = body.To ?? body.to ?? query.to ?? '';

    const twiml = new twilio.twiml.VoiceResponse();

    if (!toPhone) {
      twiml.say('Número de telefone inválido.');
    } else {
      const dial = twiml.dial({
        callerId: env.TWILIO_PHONE_NUMBER,
        record: 'record-from-answer',
        recordingStatusCallback: `${env.API_URL.replace(/\/+$/, '')}/api/calls/recording`,
      });
      dial.number(toPhone);
    }

    void query.agent;
    void query.conversation;

    return reply.header('Content-Type', 'text/xml').send(twiml.toString());
  });

  app.post('/twiml/browser', async (request, reply) => {
    const body = parseTwilioPayload(request.body);
    const callSid = body.CallSid?.trim() ?? '';
    const conversationId = extractConversationId(body);
    const agentId = extractAgentId(body);
    const toPhone = body.To ?? body.to ?? '';

    const twiml = new twilio.twiml.VoiceResponse();
    const callbackUrl = `${env.API_URL.replace(/\/+$/, '')}/api/calls/status`;

    if (!toPhone) {
      request.log.warn({
        event: 'twilio_browser_missing_to',
        callSid: callSid || null,
        from: body.From ?? null,
        conversationId,
        agentId,
        payloadKeys: Object.keys(body).sort(),
      }, '[Twilio] Browser webhook called without To parameter');
    }

    if (!toPhone) {
      twiml.say('Número de telefone inválido.');
    } else {
      const dial = twiml.dial({
        callerId: env.TWILIO_PHONE_NUMBER,
        record: 'record-from-answer',
        recordingStatusCallback: `${env.API_URL.replace(/\/+$/, '')}/api/calls/recording`,
        action: callbackUrl,
        method: 'POST',
      });
      dial.number({
        statusCallback: callbackUrl,
        statusCallbackMethod: 'POST',
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      }, toPhone);
    }

    if (callSid && conversationId) {
      const tenant = await findTenantByConversationId(conversationId);
      if (tenant) {
        try {
          await ensureCallRecordsInfrastructure(prisma, tenant.schemaName);
          callRecordsTableCache.set(tenant.schemaName, true);
          await saveCallRecord(
            prisma,
            tenant.schemaName,
            {
              conversationId,
              agentId,
              callSid,
              toPhone: normalizePhoneToE164(toPhone),
              fromPhone: body.From ?? `client:${agentId ?? 'unknown'}`,
              status: body.CallStatus ?? 'initiated',
            },
          );
        } catch (error) {
          request.log.warn({
            event: 'twilio_browser_call_record_skip',
            reason: 'record_persist_failed',
            callSid,
            conversationId,
            agentId,
            tenantSchema: tenant.schemaName,
            error: error instanceof Error ? error.message : String(error),
          }, '[Twilio] Failed to persist browser call record');
        }
      } else {
        request.log.warn({
          event: 'twilio_browser_call_record_skip',
          reason: 'tenant_not_found_by_conversation',
          callSid,
          conversationId,
          agentId,
        }, '[Twilio] Browser call record not persisted');
      }
    } else {
      request.log.warn({
        event: 'twilio_browser_call_record_skip',
        reason: 'missing_callsid_or_conversation',
        callSid: callSid || null,
        conversationId,
        agentId,
      }, '[Twilio] Browser call record not persisted');
    }

    return reply.header('Content-Type', 'text/xml').send(twiml.toString());
  });

  app.post('/status', async (request, reply) => {
    const body = parseTwilioPayload(request.body);
    const callSids = callSidCandidates(body);
    const callStatus = body.CallStatus ?? body.DialCallStatus ?? 'unknown';
    const duration = asNumber(body.CallDuration ?? body.DialCallDuration);

    if (callSids.length === 0) {
      return reply.status(200).send({ ok: true });
    }

    const io = getSocketServer();
    const processed = new Set<string>();

    for (const currentSid of callSids) {
      const tenants = await findTenantsByCallSid(currentSid);
      for (const tenant of tenants) {
        const key = `${tenant.id}:${currentSid}`;
        if (processed.has(key)) continue;
        processed.add(key);

        const updated = await updateCallStatusBySid(
          prisma,
          tenant.schemaName,
          currentSid,
          {
            status: callStatus,
            duration,
          },
        );

        if (!updated) continue;

        io.to(`tenant:${tenant.id}`).emit('call:status', {
          callSid: currentSid,
          status: callStatus,
          duration,
          conversationId: updated.conversation_id,
        });
      }
    }

    return reply.status(200).send({ ok: true });
  });

  app.post('/recording', async (request, reply) => {
    const body = parseTwilioPayload(request.body);
    const callSids = callSidCandidates(body);
    const recordingUrl = safeRecordingUrl(body.RecordingUrl ?? '');
    const recordingDuration = asNumber(body.RecordingDuration);

    if (callSids.length === 0 || !recordingUrl) {
      return reply.status(200).send({ ok: true });
    }

    const io = getSocketServer();
    const processed = new Set<string>();

    for (const currentSid of callSids) {
      const tenants = await findTenantsByCallSid(currentSid);
      for (const tenant of tenants) {
        const key = `${tenant.id}:${currentSid}`;
        if (processed.has(key)) continue;
        processed.add(key);

        const updated = await updateCallRecordingBySid(
          prisma,
          tenant.schemaName,
          currentSid,
          { recordingUrl, duration: recordingDuration },
        );

        if (!updated) continue;

        await insertRecordingMessage(
          prisma,
          tenant.schemaName,
          updated.conversation_id,
          currentSid,
          recordingUrl,
          recordingDuration,
        );

        io.to(`tenant:${tenant.id}`).emit('conversation:new_message', {
          conversationId: updated.conversation_id,
        });
      }
    }

    return reply.status(200).send({ ok: true });
  });

  app.post('/make', { preHandler: guard }, async (request, reply) => {
    const parsed = makeCallBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    if (request.user.isSuperAdmin) {
      return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    }

    const schemaName = request.user.schemaName;
    if (!schemaName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Schema do tenant não identificado' },
      });
    }

    await ensureCallRecordsInfrastructure(prisma, schemaName);

    const toPhone = normalizePhoneToE164(parsed.data.to_phone);
    if (!toPhone) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Telefone inválido' },
      });
    }

    const callSid = await makeCall(toPhone, request.user.id, parsed.data.conversation_id);

    await saveCallRecord(
      prisma,
      schemaName,
      {
        conversationId: parsed.data.conversation_id,
        agentId: request.user.id,
        callSid,
        toPhone,
        fromPhone: env.TWILIO_PHONE_NUMBER,
        status: 'initiated',
      },
    );

    const io = getSocketServer();
    io.to(`tenant:${request.user.tenantId}`).emit('call:initiated', {
      callSid,
      conversationId: parsed.data.conversation_id,
      toPhone,
    });

    return reply.send({ success: true, call_sid: callSid });
  });

  app.get<{ Params: { id: string } }>('/conversation/:id', { preHandler: guard }, async (request, reply) => {
    const parsed = conversationParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Parâmetros inválidos', details: parsed.error.flatten() },
      });
    }

    if (request.user.isSuperAdmin) {
      return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    }

    const schemaName = request.user.schemaName;
    if (!schemaName) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Schema do tenant não identificado' },
      });
    }

    await ensureCallRecordsInfrastructure(prisma, schemaName);

    const calls = await prisma.$queryRawUnsafe(
      `SELECT cr.*, u.name AS agent_name
       FROM "${schemaName}".call_records cr
       LEFT JOIN "${schemaName}".users u ON u.id = cr.agent_id
       WHERE cr.conversation_id = $1::uuid
       ORDER BY cr.created_at DESC`,
      parsed.data.id,
    );

    return reply.send({ success: true, data: calls });
  });
}
