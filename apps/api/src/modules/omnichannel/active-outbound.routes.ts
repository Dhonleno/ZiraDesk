import type { FastifyInstance } from 'fastify';
import type { AuthUser } from '@ziradesk/shared';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { prisma } from '../../config/database.js';
import { messageQueue } from '../../jobs/queue.js';
import { dispatchWebhook } from '../../services/webhook-dispatcher.js';
import { getSocketServer } from '../../socket/index.js';
import { loadConversationSocketPayload } from './conversations/socket-payload.js';
import { buildProtocolMessage } from './conversations/protocols.js';
import { decryptCredentials } from '../../utils/crypto.js';
import { listTemplates as listAdminTemplates } from '../admin/templates/templates.service.js';
import { calculateWaitingExpiresAt } from '../../lib/omnichannel/calculate-waiting-expires.js';

const guard = [authMiddleware, tenantSchemaFromJwt, requirePermission('conversations:reply')];

type TenantRawDbClient = Pick<typeof prisma, '$executeRawUnsafe' | '$queryRawUnsafe'>;

interface ContactRow {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
}

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  status: string;
  settings: unknown;
  credentials: string | object | null;
}

interface ConversationInsertRow {
  id: string;
  contact_id: string | null;
  organization_id: string | null;
  channel_id: string | null;
  channel_type: string;
  conversation_type: string;
  status: string;
  protocol_number: string | null;
  assigned_to: string | null;
  assigned_at: Date | null;
  subject: string | null;
  last_message: string | null;
  last_message_at: Date | null;
  created_at: Date;
  metadata: unknown;
}

interface GeneratedProtocolRow {
  protocol: string;
}

interface DuplicateConversationRow {
  id: string;
}

const listTemplatesQuerySchema = z.object({
  channel_id: z.string().uuid().optional(),
});

const activeOutboundSchema = z.object({
  contactId: z.string().uuid(),
  channelId: z.string().uuid(),
  templateName: z.string().trim().min(1).max(512).optional(),
  templateLanguage: z.string().trim().min(2).max(20).optional(),
  templateComponents: z.array(z.record(z.unknown())).optional(),
  subject: z.string().trim().max(255).optional(),
  message: z.string().trim().max(4000).optional(),
  useTemplate: z.boolean().default(true),
});

function extractBodyParamsFromComponents(components: Record<string, unknown>[]): string[] {
  const bodyComp = components.find(
    (c) => typeof c.type === 'string' && c.type.toLowerCase() === 'body',
  );
  if (!bodyComp || !Array.isArray(bodyComp.parameters)) return [];
  return (bodyComp.parameters as Array<Record<string, unknown>>)
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text as string);
}

function applyBodyParams(body: string, params: string[]): string {
  if (!params.length) return body;
  return body.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_full, key: string) => {
    const n = Number.parseInt(key, 10);
    if (Number.isFinite(n) && n > 0) return params[n - 1] ?? `{{${key}}}`;
    return `{{${key}}}`;
  });
}

function ensureSafeSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new Error('Schema do tenant inválido');
  }
  return schemaName.replace(/"/g, '""');
}

async function withTenantSchema<T>(
  schemaName: string,
  runner: (tx: TenantRawDbClient) => Promise<T>,
): Promise<T> {
  const safeSchemaName = ensureSafeSchemaName(schemaName);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchemaName}", public`);
    return runner(tx);
  });
}

export async function activeOutboundRoutes(app: FastifyInstance): Promise<void> {
  app.get('/templates', { preHandler: guard }, async (request, reply) => {
    const parsed = listTemplatesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const user = request.user as AuthUser;
    const schemaName = user.schemaName;
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    const templates = await listAdminTemplates(schemaName, parsed.data);
    const approvedTemplates = templates.filter((template) => {
      const status = String(template.status ?? '').toLowerCase();
      return status === 'approved' && Boolean(template.meta_template_id);
    });
    return reply.send({ success: true, data: approvedTemplates });
  });

  app.post('/active-outbound', { preHandler: guard }, async (request, reply) => {
    const parsed = activeOutboundSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const user = request.user as AuthUser;
    const schemaName = user.schemaName;
    const tenantId = user.tenantId;
    const userId = user.id;

    if (!schemaName || !tenantId) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    const {
      contactId,
      channelId,
      templateName,
      templateLanguage,
      templateComponents,
      subject,
      message,
      useTemplate,
    } = parsed.data;

    const templateNameNormalized = templateName?.trim() ?? '';
    const templateLanguageNormalized = templateLanguage?.trim() || 'pt_BR';
    const normalizedMessage = message?.trim() ?? '';
    const normalizedSubject = subject?.trim() || null;
    const normalizedTemplateComponents = (templateComponents ?? []).filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
    );
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const tenantSettings = typeof tenant?.settings === 'object' && tenant.settings !== null
      ? tenant.settings as Record<string, unknown>
      : {};
    const waitingExpiresAt = calculateWaitingExpiresAt(tenantSettings);

    const result = await withTenantSchema(schemaName, async (tx) => {
      const contacts = await tx.$queryRawUnsafe<ContactRow[]>(
        `SELECT id, name, phone, whatsapp, email
         FROM contacts
         WHERE id = $1::uuid
         LIMIT 1`,
        contactId,
      );
      const contact = contacts[0];
      if (!contact) {
        return { statusCode: 404 as const, payload: { success: false, error: { message: 'Contato não encontrado' } } };
      }

      const channels = await tx.$queryRawUnsafe<ChannelRow[]>(
        `SELECT id, type, name, status, settings, credentials
         FROM channels
         WHERE id = $1::uuid AND status = 'active'
         LIMIT 1`,
        channelId,
      );
      const channel = channels[0];
      if (!channel) {
        return { statusCode: 404 as const, payload: { success: false, error: { message: 'Canal ativo não encontrado' } } };
      }

      if (channel.type !== 'whatsapp' && channel.type !== 'email') {
        return { statusCode: 400 as const, payload: { success: false, error: { message: 'Canal não suporta envio ativo' } } };
      }

      const duplicateRows = await tx.$queryRawUnsafe<DuplicateConversationRow[]>(
        `SELECT id
         FROM conversations
         WHERE contact_id = $1::uuid
           AND channel_id = $2::uuid
           AND status = 'open'
         LIMIT 1`,
        contactId,
        channelId,
      );
      const duplicate = duplicateRows[0];
      if (duplicate) {
        return {
          statusCode: 409 as const,
          payload: { error: 'DUPLICATE_OPEN_CONVERSATION', existingId: duplicate.id },
        };
      }

      if (channel.type === 'whatsapp' && useTemplate && !templateNameNormalized) {
        return {
          statusCode: 400 as const,
          payload: { success: false, error: { message: 'templateName é obrigatório para envio ativo com template' } },
        };
      }

      if (channel.type === 'whatsapp' && !useTemplate && !normalizedMessage) {
        return {
          statusCode: 400 as const,
          payload: { success: false, error: { message: 'message é obrigatório quando useTemplate = false' } },
        };
      }

      if (channel.type === 'email' && (!normalizedSubject || !normalizedMessage)) {
        return {
          statusCode: 400 as const,
          payload: { success: false, error: { message: 'subject e message são obrigatórios para envio ativo por e-mail' } },
        };
      }

      const recipient = channel.type === 'whatsapp'
        ? (contact.whatsapp ?? contact.phone)
        : contact.email;

      if (!recipient?.trim()) {
        return {
          statusCode: 400 as const,
          payload: {
            success: false,
            error: {
              message: channel.type === 'whatsapp'
                ? 'Contato sem telefone/WhatsApp para envio ativo'
                : 'Contato sem e-mail para envio ativo',
            },
          },
        };
      }

      const protocolRows = await tx.$queryRawUnsafe<GeneratedProtocolRow[]>(
        'SELECT generate_protocol() AS protocol',
      );
      const protocolNumber = protocolRows[0]?.protocol ?? null;

      let renderedTemplateBody: string | null = null;
      if (channel.type === 'whatsapp' && useTemplate && templateNameNormalized) {
        const templateRows = await tx.$queryRawUnsafe<Array<{
          body: string | null;
          status: string | null;
          meta_template_id: string | null;
          last_synced_at: Date | null;
        }>>(
          `SELECT body, status, meta_template_id, last_synced_at
           FROM whatsapp_templates
           WHERE channel_id = $1::uuid
             AND name = $2
             AND language = $3
           LIMIT 1`,
          channelId,
          templateNameNormalized,
          templateLanguageNormalized,
        );
        const selectedTemplate = templateRows[0];

        if (!selectedTemplate) {
          const languageRows = await tx.$queryRawUnsafe<Array<{ language: string }>>(
            `SELECT language
             FROM whatsapp_templates
             WHERE channel_id = $1::uuid
               AND name = $2
             ORDER BY language ASC`,
            channelId,
            templateNameNormalized,
          );
          const availableLanguages = languageRows.map((row) => row.language);
          if (availableLanguages.length > 0) {
            return {
              statusCode: 409 as const,
              payload: {
                success: false,
                error: {
                  message: `Template "${templateNameNormalized}" não existe no idioma "${templateLanguageNormalized}". Idiomas disponíveis: ${availableLanguages.join(', ')}.`,
                },
              },
            };
          }
          return {
            statusCode: 404 as const,
            payload: {
              success: false,
              error: {
                message: `Template "${templateNameNormalized}" não encontrado para este canal. Sincronize os templates com a Meta.`,
              },
            },
          };
        }

        const normalizedStatus = selectedTemplate.status?.trim().toLowerCase() ?? '';
        if (normalizedStatus && normalizedStatus !== 'approved') {
          return {
            statusCode: 422 as const,
            payload: {
              success: false,
              error: {
                message: `Template "${templateNameNormalized}" está com status "${selectedTemplate.status}". Envie apenas templates aprovados.`,
              },
            },
          };
        }
        if (!selectedTemplate.meta_template_id) {
          return {
            statusCode: 409 as const,
            payload: {
              success: false,
              error: {
                message: `Template "${templateNameNormalized}" (${templateLanguageNormalized}) não está vinculado à Meta para este canal. Sincronize os templates e tente novamente.`,
              },
            },
          };
        }
        if (selectedTemplate.body) {
          renderedTemplateBody = applyBodyParams(
            selectedTemplate.body,
            extractBodyParamsFromComponents(normalizedTemplateComponents),
          );
        }
      }

      const metadata = {
        type: 'outbound',
        origin: 'outbound',
        outbound_started_at: new Date().toISOString(),
        outbound_origin_agent_id: userId,
      };

      const inserted = await tx.$queryRawUnsafe<ConversationInsertRow[]>(
        `INSERT INTO conversations (
           contact_id,
           channel_id,
           channel_type,
           conversation_type,
           status,
           assigned_to,
           assigned_at,
           waiting_expires_at,
           protocol_number,
           subject,
           metadata
         ) VALUES (
           $1::uuid,
           $2::uuid,
           $3,
           'outbound',
           'waiting',
           $4::uuid,
           NOW(),
           $8::timestamptz,
           $5,
           $6,
           $7::jsonb
         )
         RETURNING *`,
        contactId,
        channelId,
        channel.type,
        userId,
        protocolNumber,
        normalizedSubject,
        JSON.stringify(metadata),
        waitingExpiresAt,
      );

      const conversation = inserted[0];
      if (!conversation) {
        return {
          statusCode: 500 as const,
          payload: { success: false, error: { message: 'Falha ao criar envio ativo' } },
        };
      }

      const protocolMessage = protocolNumber
        ? buildProtocolMessage(protocolNumber, { context: 'agent_initiated', startedAt: new Date() })
        : null;
      let protocolMessageId: string | null = null;
      if (protocolMessage) {
        const protocolMessageRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `INSERT INTO messages (conversation_id, sender_type, content, content_type, is_internal)
           VALUES ($1::uuid, 'system', $2, 'text', false)
           RETURNING id`,
          conversation.id,
          protocolMessage,
        );
        protocolMessageId = protocolMessageRows[0]?.id ?? null;
      }

      const initialContent = channel.type === 'whatsapp' && useTemplate
        ? (renderedTemplateBody ?? `[Template WhatsApp: ${templateNameNormalized}]`)
        : normalizedMessage;
      const initialContentType = channel.type === 'whatsapp' && useTemplate ? 'template' : 'text';
      const initialMetadata = channel.type === 'whatsapp' && useTemplate
        ? {
          whatsapp_template: {
            name: templateNameNormalized,
            language: templateLanguageNormalized,
            ...(normalizedTemplateComponents.length ? { components: normalizedTemplateComponents } : {}),
          },
        }
        : {};

      const initialMessageRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, metadata)
         VALUES ($1::uuid, 'agent', $2::uuid, $3, $4, $5::jsonb)
         RETURNING id`,
        conversation.id,
        userId,
        initialContent,
        initialContentType,
        JSON.stringify(initialMetadata),
      );
      const initialMessageId = initialMessageRows[0]?.id ?? null;

      await tx.$executeRawUnsafe(
        `UPDATE conversations
         SET last_message = $1,
             last_message_at = NOW()
         WHERE id = $2::uuid`,
        initialContent.slice(0, 255),
        conversation.id,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data, ip_address)
         VALUES ($1::uuid, 'conversation.created', 'conversation', $2::uuid, $3::jsonb, $4::inet)`,
        userId,
        conversation.id,
        JSON.stringify({
          contact_id: contactId,
          channel_id: channelId,
          channel_type: channel.type,
          conversation_type: 'outbound',
          initial_message: initialContent.slice(0, 100),
          created_by: userId,
        }),
        request.ip ?? null,
      );

      return {
        statusCode: 201 as const,
        payload: {
          success: true,
          data: {
            conversation,
            protocolMessageId,
            protocolMessage,
            initialMessageId,
            recipient: recipient.trim(),
            contactName: contact.name,
            channelType: channel.type,
            channelCredentials: channel.credentials ? decryptCredentials(channel.credentials) : {},
            useTemplate,
            templateName: templateNameNormalized || null,
            templateLanguage: templateLanguageNormalized,
            templateComponents: normalizedTemplateComponents,
            message: normalizedMessage,
            initialContent,
          },
        },
      };
    });

    if (result.statusCode !== 201 || !('data' in result.payload)) {
      return reply.code(result.statusCode).send(result.payload);
    }

    const {
      conversation,
      initialMessageId,
      recipient,
      contactName,
      channelType,
      channelCredentials,
      templateComponents: queuedTemplateComponents,
    } = result.payload.data;

    const queuePayloadBase = {
      conversationId: conversation.id,
      tenantId,
      tenantSchema: schemaName,
      channelType: channelType as 'whatsapp' | 'email',
      channelCredentials,
      to: recipient,
    };

    if (initialMessageId) {
      await messageQueue.add('send', {
        messageId: initialMessageId,
        ...queuePayloadBase,
        content: result.payload.data.initialContent,
        templateName: result.payload.data.useTemplate ? result.payload.data.templateName : null,
        templateLanguage: result.payload.data.useTemplate ? result.payload.data.templateLanguage : null,
        templateComponents: result.payload.data.useTemplate
          ? (queuedTemplateComponents.length ? queuedTemplateComponents : null)
          : null,
      });
    }

    const io = getSocketServer();
    const socketConversation = await loadConversationSocketPayload(prisma, schemaName, conversation.id);
    io.to(`tenant:${tenantId}`).emit('conversation:created', {
      conversationId: conversation.id,
      contactName,
      conversation: socketConversation ?? undefined,
    });

    void dispatchWebhook(tenantId, 'conversation.created', {
      conversation: {
        id: conversation.id,
        status: 'waiting',
        channelType: channelType,
      },
    });

    return reply.code(201).send({ success: true, data: conversation });
  });
}
