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
import {
  ensureTemplatesInfrastructure,
  listTemplates as listAdminTemplates,
} from '../admin/templates/templates.service.js';

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

interface WhatsAppTemplateValidationRow {
  body: string | null;
  header: string | null;
  header_format: string | null;
  buttons: unknown;
  status: string | null;
  meta_template_id: string | null;
  last_synced_at: Date | null;
}

type TemplateValidationCode =
  | 'template.validation.missingBodyVar'
  | 'template.validation.missingHeaderVar'
  | 'template.validation.missingHeaderMedia'
  | 'template.validation.missingButtonParam'
  | 'template.validation.varCountMismatch';

interface TemplateValidationResult {
  code: TemplateValidationCode;
  message: string;
}

interface TemplateValidationInput {
  body: string | null;
  header: string | null;
  headerFormat: string | null;
  buttons: unknown;
  components: Record<string, unknown>[];
}

const templateValidationMessages: Record<TemplateValidationCode, string> = {
  'template.validation.missingBodyVar': 'Variável {{n}} do corpo não preenchida',
  'template.validation.missingHeaderVar': 'Variável {{n}} do cabeçalho não preenchida',
  'template.validation.missingHeaderMedia': 'Template requer mídia no cabeçalho',
  'template.validation.missingButtonParam': 'Parâmetro dinâmico do botão {{n}} não preenchido',
  'template.validation.varCountMismatch': 'Número de variáveis não corresponde ao template',
};

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

function extractTemplateVariableIndexes(text: string | null | undefined): number[] {
  if (!text) return [];

  const variableIndexes = new Set<number>();
  const regex = /\{\{\s*(\d+)\s*\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const variableIndex = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(variableIndex) && variableIndex > 0) {
      variableIndexes.add(variableIndex);
    }
  }

  return [...variableIndexes].sort((left, right) => left - right);
}

function formatTemplateValidationMessage(
  code: TemplateValidationCode,
  vars: Record<string, string | number> = {},
): string {
  let message = templateValidationMessages[code];
  for (const [key, value] of Object.entries(vars)) {
    const replacement = key === 'n' ? `{{${String(value)}}}` : String(value);
    message = message.replaceAll(`{{${key}}}`, replacement);
  }
  return message;
}

function templateValidationError(
  code: TemplateValidationCode,
  vars: Record<string, string | number> = {},
): TemplateValidationResult {
  return {
    code,
    message: formatTemplateValidationMessage(code, vars),
  };
}

function findTemplateComponent(
  components: Record<string, unknown>[],
  type: string,
  predicate?: (component: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  const normalizedType = type.toLowerCase();
  return components.find((component) => {
    const componentType = typeof component.type === 'string' ? component.type.toLowerCase() : '';
    return componentType === normalizedType && (!predicate || predicate(component));
  }) ?? null;
}

function extractComponentParameters(component: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!Array.isArray(component?.parameters)) return [];
  return component.parameters.filter(
    (parameter): parameter is Record<string, unknown> => Boolean(parameter) && typeof parameter === 'object',
  );
}

function hasTextValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasFilledTextParameter(parameter: Record<string, unknown> | undefined): boolean {
  return hasTextValue(parameter?.text);
}

function hasFilledMediaValue(value: unknown): boolean {
  if (hasTextValue(value)) return true;
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  return hasTextValue(record.id) || hasTextValue(record.link) || hasTextValue(record.url);
}

function hasFilledMediaParameter(parameter: Record<string, unknown> | undefined, mediaType: string): boolean {
  if (!parameter) return false;

  const normalizedMediaType = mediaType.toLowerCase();
  return (
    hasFilledMediaValue(parameter[normalizedMediaType])
    || hasFilledMediaValue(parameter.media)
    || hasFilledMediaValue(parameter.id)
    || hasFilledMediaValue(parameter.link)
    || hasFilledMediaValue(parameter.url)
  );
}

function hasFilledButtonParameter(parameter: Record<string, unknown> | undefined): boolean {
  if (!parameter) return false;

  return (
    hasTextValue(parameter.text)
    || hasTextValue(parameter.payload)
    || hasTextValue(parameter.coupon_code)
    || hasFilledMediaValue(parameter.image)
    || hasFilledMediaValue(parameter.video)
    || hasFilledMediaValue(parameter.document)
  );
}

function normalizeHeaderFormat(header: string | null, headerFormat: string | null): string | null {
  const normalizedFormat = headerFormat?.trim().toUpperCase() ?? '';
  if (['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(normalizedFormat)) {
    return normalizedFormat;
  }

  const headerText = header?.trim() ?? '';
  if (!headerText) return null;
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerText.toUpperCase())) {
    return headerText.toUpperCase();
  }

  return 'TEXT';
}

function normalizeButtons(buttons: unknown): Record<string, unknown>[] {
  if (!Array.isArray(buttons)) return [];
  return buttons.filter(
    (button): button is Record<string, unknown> => Boolean(button) && typeof button === 'object',
  );
}

function buttonTextFields(button: Record<string, unknown>): string[] {
  return ['text', 'url', 'payload', 'phone_number']
    .map((field) => button[field])
    .filter((value): value is string => typeof value === 'string');
}

function buttonRequiresDynamicParameter(button: Record<string, unknown>): boolean {
  return buttonTextFields(button).some((value) => extractTemplateVariableIndexes(value).length > 0);
}

function findButtonComponent(
  components: Record<string, unknown>[],
  buttonIndex: number,
): Record<string, unknown> | null {
  return findTemplateComponent(components, 'button', (component) => {
    if (component.index === undefined || component.index === null) return false;
    return String(component.index) === String(buttonIndex);
  });
}

export function validateTemplateVariablesForOutbound(
  input: TemplateValidationInput,
): TemplateValidationResult | null {
  const bodyVariables = extractTemplateVariableIndexes(input.body);
  const bodyComponent = findTemplateComponent(input.components, 'body');
  const bodyParameters = extractComponentParameters(bodyComponent);

  for (let position = 0; position < bodyVariables.length; position += 1) {
    const variableIndex = bodyVariables[position];
    if (!hasFilledTextParameter(bodyParameters[position])) {
      return templateValidationError('template.validation.missingBodyVar', {
        n: variableIndex ?? position + 1,
      });
    }
  }

  if (bodyParameters.length !== bodyVariables.length) {
    return templateValidationError('template.validation.varCountMismatch');
  }

  const headerFormat = normalizeHeaderFormat(input.header, input.headerFormat);
  const headerVariables = extractTemplateVariableIndexes(input.header);
  const headerComponent = findTemplateComponent(input.components, 'header');
  const headerParameters = extractComponentParameters(headerComponent);

  if (headerFormat === 'TEXT') {
    for (let position = 0; position < headerVariables.length; position += 1) {
      const variableIndex = headerVariables[position];
      if (!hasFilledTextParameter(headerParameters[position])) {
        return templateValidationError('template.validation.missingHeaderVar', {
          n: variableIndex ?? position + 1,
        });
      }
    }

    if (headerParameters.length !== headerVariables.length) {
      return templateValidationError('template.validation.varCountMismatch');
    }
  }

  if (headerFormat && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
    const firstHeaderParameter = headerParameters[0];
    if (!hasFilledMediaParameter(firstHeaderParameter, headerFormat)) {
      return templateValidationError('template.validation.missingHeaderMedia');
    }
  }

  const dynamicButtons = normalizeButtons(input.buttons).filter(buttonRequiresDynamicParameter);
  for (let position = 0; position < dynamicButtons.length; position += 1) {
    const buttonComponent = findButtonComponent(input.components, position);
    const buttonParameters = extractComponentParameters(buttonComponent);
    if (!hasFilledButtonParameter(buttonParameters[0])) {
      return templateValidationError('template.validation.missingButtonParam', {
        n: position + 1,
      });
    }

    if (buttonParameters.length !== 1) {
      return templateValidationError('template.validation.varCountMismatch');
    }
  }

  return null;
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

    if (useTemplate && templateNameNormalized) {
      await ensureTemplatesInfrastructure(schemaName);
    }

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

      let renderedTemplateBody: string | null = null;
      if (channel.type === 'whatsapp' && useTemplate && templateNameNormalized) {
        const templateRows = await tx.$queryRawUnsafe<WhatsAppTemplateValidationRow[]>(
          `SELECT body, header, header_format, buttons, status, meta_template_id, last_synced_at
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
            statusCode: 409 as const,
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
        const templateValidation = validateTemplateVariablesForOutbound({
          body: selectedTemplate.body,
          header: selectedTemplate.header,
          headerFormat: selectedTemplate.header_format,
          buttons: selectedTemplate.buttons,
          components: normalizedTemplateComponents,
        });
        if (templateValidation) {
          return {
            statusCode: 422 as const,
            payload: {
              success: false,
              error: {
                code: templateValidation.code,
                message: templateValidation.message,
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

      const protocolRows = await tx.$queryRawUnsafe<GeneratedProtocolRow[]>(
        'SELECT generate_protocol() AS protocol',
      );
      const protocolNumber = protocolRows[0]?.protocol ?? null;

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
           NOW() + INTERVAL '24 hours',
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
