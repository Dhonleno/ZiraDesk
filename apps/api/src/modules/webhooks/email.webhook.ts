import type { FastifyInstance } from 'fastify';
import { Resend } from 'resend';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { getSocketServer } from '../../socket/index.js';

interface ResendInboundPayload {
  type?: string;
  data?: {
    from?: string;
    to?: string | string[];
    subject?: string;
    text?: string;
    html?: string;
    message_id?: string;
    headers?: Record<string, string>;
  };
}

interface LegacyInboundPayload {
  from?: string;
  to?: string[];
  subject?: string;
  text?: string;
  html?: string;
  message_id?: string;
}

interface NormalizedInboundEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  messageId: string | null;
}

interface TenantLookup {
  id: string;
  slug: string;
  schema_name: string;
  status: string;
  settings: Record<string, unknown> | null;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function extractTenantFromEmail(address: string): string | null {
  const normalized = address.trim().toLowerCase();
  const supportMatch = normalized.match(/^suporte@([^.]+)\.ziradesk\.com\.br$/);
  if (supportMatch?.[1]) return supportMatch[1];

  const plusMatch = normalized.match(/^tickets\+([^@]+)@ziradesk\.com\.br$/);
  if (plusMatch?.[1]) return plusMatch[1];

  return null;
}

function extractEmail(rawFrom: string): string {
  const trimmed = rawFrom.trim();
  const match = trimmed.match(/<([^>]+)>/);
  const value = (match?.[1] ?? trimmed).trim().toLowerCase();
  return value;
}

function extractName(rawFrom: string): string {
  const trimmed = rawFrom.trim();
  const match = trimmed.match(/^(.+?)\s*</);
  if (match?.[1]) return match[1].trim();

  const emailOnly = extractEmail(trimmed);
  return emailOnly.split('@')[0] ?? 'Cliente';
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanEmailBody(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';

  const lines = normalized.split('\n');
  const signaturePatterns = [
    /^--\s*$/,
    /^att[:,]?/i,
    /^atenciosamente[:,]?/i,
    /^enviado do meu/i,
    /^sent from my/i,
    /^em .* escreveu:/i,
    /^on .* wrote:/i,
  ];

  let cutAt = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    if (signaturePatterns.some((pattern) => pattern.test(lines[index] ?? ''))) {
      cutAt = index;
      break;
    }
  }

  return lines.slice(0, cutAt).join('\n').trim();
}

function normalizeInboundPayload(payload: unknown): NormalizedInboundEmail | null {
  const raw = payload as ResendInboundPayload | LegacyInboundPayload;

  if ((raw as ResendInboundPayload)?.type && (raw as ResendInboundPayload).type !== 'email.received') {
    return null;
  }

  const data = ((raw as ResendInboundPayload).data ?? raw) as LegacyInboundPayload;
  const from = (data.from ?? '').trim();
  if (!from) return null;

  const toListRaw = data.to;
  const to = Array.isArray(toListRaw)
    ? toListRaw.map((item) => String(item).trim()).filter(Boolean)
    : [String(toListRaw ?? '').trim()].filter(Boolean);
  if (to.length === 0) return null;

  return {
    from,
    to,
    subject: (data.subject ?? 'Sem assunto').trim() || 'Sem assunto',
    text: (data.text ?? '').trim(),
    html: (data.html ?? '').trim(),
    messageId: data.message_id?.trim() || null,
  };
}

function hasValidWebhookSecret(headers: Record<string, unknown>): boolean {
  if (!env.RESEND_WEBHOOK_SECRET) return true;

  const authorization = String(headers.authorization ?? '');
  const resendSignature = String(headers['resend-signature'] ?? headers['x-resend-signature'] ?? '');

  return (
    authorization === `Bearer ${env.RESEND_WEBHOOK_SECRET}`
    || resendSignature === env.RESEND_WEBHOOK_SECRET
  );
}

async function processInboundEmail(app: FastifyInstance, inbound: NormalizedInboundEmail): Promise<void> {
  const toAddress = inbound.to[0] ?? '';
  const tenantSlug = extractTenantFromEmail(toAddress);
  if (!tenantSlug) {
    app.log.warn({ toAddress }, '[Email Webhook] tenant slug não encontrado no destinatário');
    return;
  }

  const tenantRows = await prisma.$queryRawUnsafe<TenantLookup[]>(
    `SELECT id, slug, schema_name, status, settings
     FROM tenants
     WHERE slug = $1
     LIMIT 1`,
    tenantSlug,
  );

  const tenant = tenantRows[0];
  if (!tenant || !['active', 'trial'].includes(tenant.status)) {
    app.log.warn({ tenantSlug }, '[Email Webhook] tenant não encontrado ou inativo');
    return;
  }

  const schema = quoteIdent(tenant.schema_name);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.tickets
    ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS email_message_id VARCHAR(500)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_email_message_id
    ON ${schema}.tickets(email_message_id)
    WHERE email_message_id IS NOT NULL
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${schema}.contacts
    ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS portal_password_hash VARCHAR(255),
    ADD COLUMN IF NOT EXISTS portal_last_login TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS portal_invited_at TIMESTAMPTZ
  `);

  const senderEmail = extractEmail(inbound.from);
  const senderName = extractName(inbound.from);

  if (inbound.messageId) {
    const existingRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
       FROM ${schema}.tickets
       WHERE email_message_id = $1
       LIMIT 1`,
      inbound.messageId,
    );

    if (existingRows[0]) {
      app.log.info({ messageId: inbound.messageId }, '[Email Webhook] mensagem já processada');
      return;
    }
  }

  let contacts = await prisma.$queryRawUnsafe<Array<{
    id: string;
    name: string;
    organization_id: string | null;
  }>>(
    `SELECT id, name, organization_id
     FROM ${schema}.contacts
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    senderEmail,
  );

  if (!contacts[0]) {
    contacts = await prisma.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      organization_id: string | null;
    }>>(
      `INSERT INTO ${schema}.contacts (id, name, email, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())
       RETURNING id, name, organization_id`,
      senderName,
      senderEmail,
    );
  }

  const contact = contacts[0];
  if (!contact) return;

  const description = cleanEmailBody(inbound.text || stripHtml(inbound.html));

  const createdRows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    title: string;
    status: string;
    source: string;
  }>>(
    `INSERT INTO ${schema}.tickets (
       id,
       title,
       description,
       source,
       email_message_id,
       status,
       priority,
       contact_id,
       organization_id,
       created_at,
       updated_at
     ) VALUES (
       gen_random_uuid(),
       $1,
       $2,
       'email',
       $3,
       'open',
       'medium',
       $4::uuid,
       $5::uuid,
       NOW(),
       NOW()
     )
     RETURNING id, title, status, source`,
    inbound.subject || 'Sem assunto',
    description || null,
    inbound.messageId,
    contact.id,
    contact.organization_id,
  );

  const ticket = createdRows[0];
  if (!ticket) return;

  await prisma.$queryRawUnsafe(
    `INSERT INTO ${schema}.ticket_events (ticket_id, event_type, new_value)
     VALUES ($1::uuid, 'created', 'email')`,
    ticket.id,
  );

  const conversationRows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    assigned_to: string | null;
    status: string | null;
  }>>(
    `SELECT id, assigned_to, status
     FROM ${schema}.conversations
     WHERE contact_id = $1::uuid
       AND channel_type = 'email'
       AND status IN ('open', 'pending', 'in_service', 'active_outbound', 'bot')
     ORDER BY created_at DESC
     LIMIT 1`,
    contact.id,
  );
  const linkedConversation = conversationRows[0];
  const assignedUserId = linkedConversation?.assigned_to ?? null;
  if (linkedConversation && assignedUserId) {
    const previewSource = (description || inbound.subject || '').trim();
    const isNumericOnly = /^\d+$/.test(previewSource);
    if (!(isNumericOnly && linkedConversation.status === 'bot')) {
      const notificationPreview = isNumericOnly
        ? `Mensagem de ${contact.name ?? 'Cliente'}`
        : (previewSource.substring(0, 100) || 'Nova mensagem');

      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${tenant.schema_name}", public`);
        await tx.$executeRawUnsafe(
          `INSERT INTO audit_logs (
             user_id, action, entity, entity_id, new_data, created_at
           ) VALUES (
             $1::uuid,
             'conversation.message',
             'conversation',
             $2::uuid,
             $3::jsonb,
             NOW()
           )`,
          assignedUserId,
          linkedConversation.id,
          JSON.stringify({
            assigned_to: assignedUserId,
            contact_name: contact.name ?? 'Cliente',
            preview: notificationPreview,
            channel: 'email',
          }),
        );
      });
    }
  }

  try {
    getSocketServer().to(`tenant:${tenant.id}`).emit('ticket:created', {
      ticket: {
        id: ticket.id,
        title: ticket.title,
        status: ticket.status,
        source: ticket.source,
      },
      source: 'email',
      contactName: contact.name,
      subject: inbound.subject || 'Sem assunto',
    });
  } catch {
    // socket pode não estar disponível em testes
  }

  const sendConfirmation = (tenant.settings?.['email_confirmation'] as boolean | undefined) !== false;
  if (env.RESEND_API_KEY && sendConfirmation) {
    const resend = new Resend(env.RESEND_API_KEY);
    await resend.emails.send({
      from: `suporte@${tenant.slug}.ziradesk.com.br`,
      to: senderEmail,
      subject: `Re: ${inbound.subject || 'Ticket recebido'}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#111827;">
          <h2 style="margin:0 0 12px;">Ticket recebido</h2>
          <p style="margin:0 0 10px;">Olá, ${senderName}.</p>
          <p style="margin:0 0 10px;">
            Recebemos seu e-mail e criamos o ticket <strong>#${ticket.id.slice(-6).toUpperCase()}</strong>.
          </p>
          <p style="margin:0 0 10px;"><strong>Assunto:</strong> ${inbound.subject || 'Sem assunto'}</p>
          <p style="margin:0;">Nossa equipe vai analisar e responder em breve.</p>
        </div>
      `,
    });
  }

  app.log.info(
    {
      tenant: tenant.slug,
      ticketId: ticket.id,
      from: senderEmail,
      messageId: inbound.messageId,
    },
    '[Email Webhook] ticket criado via inbound',
  );
}

export async function emailWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/email', async (request, reply) => {
    reply.code(200).send({ success: true });

    const headers = request.headers as Record<string, unknown>;
    if (!hasValidWebhookSecret(headers)) {
      request.log.warn('[Email Webhook] assinatura inválida');
      return;
    }

    const inbound = normalizeInboundPayload(request.body);
    if (!inbound) return;

    void processInboundEmail(app, inbound).catch((error) => {
      request.log.error({ error }, '[Email Webhook] erro ao processar e-mail inbound');
    });
  });
}
