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

async function findTenantsByCallSid(callSid: string): Promise<TwilioTenant[]> {
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ['active', 'trial'] } },
    select: { id: true, schemaName: true },
  });

  const matched: TwilioTenant[] = [];

  for (const tenant of tenants) {
    try {
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
    const toPhone = body.To ?? body.to ?? '';

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

    return reply.header('Content-Type', 'text/xml').send(twiml.toString());
  });

  app.post('/status', async (request, reply) => {
    const body = parseTwilioPayload(request.body);
    const callSid = body.CallSid;
    const callStatus = body.CallStatus ?? 'unknown';

    if (!callSid) {
      return reply.status(200).send({ ok: true });
    }

    const tenants = await findTenantsByCallSid(callSid);
    const io = getSocketServer();

    for (const tenant of tenants) {
      const updated = await updateCallStatusBySid(
        prisma,
        tenant.schemaName,
        callSid,
        {
          status: callStatus,
          duration: asNumber(body.CallDuration),
        },
      );

      if (!updated) continue;

      io.to(`tenant:${tenant.id}`).emit('call:status', {
        callSid,
        status: callStatus,
        duration: asNumber(body.CallDuration),
        conversationId: updated.conversation_id,
      });
    }

    return reply.status(200).send({ ok: true });
  });

  app.post('/recording', async (request, reply) => {
    const body = parseTwilioPayload(request.body);
    const callSid = body.CallSid;
    const recordingUrl = safeRecordingUrl(body.RecordingUrl ?? '');
    const recordingDuration = asNumber(body.RecordingDuration);

    if (!callSid || !recordingUrl) {
      return reply.status(200).send({ ok: true });
    }

    const tenants = await findTenantsByCallSid(callSid);
    const io = getSocketServer();

    for (const tenant of tenants) {
      const updated = await updateCallRecordingBySid(
        prisma,
        tenant.schemaName,
        callSid,
        { recordingUrl, duration: recordingDuration },
      );

      if (!updated) continue;

      await insertRecordingMessage(
        prisma,
        tenant.schemaName,
        updated.conversation_id,
        callSid,
        recordingUrl,
        recordingDuration,
      );

      io.to(`tenant:${tenant.id}`).emit('conversation:new_message', {
        conversationId: updated.conversation_id,
      });
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
