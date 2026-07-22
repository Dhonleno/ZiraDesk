import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  portalAddCommentSchema,
  portalCreateTicketSchema,
  portalForgotPasswordSchema,
  portalLgpdConsentSchema,
  portalLgpdRectificationSchema,
  portalLgpdRequestSchema,
  portalLoginSchema,
  portalResetPasswordSchema,
  portalTicketsQuerySchema,
} from './portal.schema.js';
import {
  addPortalComment,
  addPortalTicketAttachment,
  createPortalTicket,
  getPortalAttachmentContent,
  getPortalBranding,
  getPortalTicket,
  getPortalLgpdState,
  listPortalTicketTypes,
  listPortalTickets,
  portalLogin,
  portalMe,
  PortalAuthError,
  PortalForbiddenError,
  PortalNotFoundError,
  reopenTicketByContact,
  requestPortalPasswordReset,
  resetPortalPassword,
  resolveHostTenant,
  submitTicketCsat,
  submitPortalLgpdRequest,
  submitPortalLgpdRectificationRequest,
  updatePortalLgpdConsent,
  verifyPortalToken,
} from './portal.service.js';

const MAX_PORTAL_ATTACHMENT_SIZE = 10 * 1024 * 1024;

function isMultipartTooLargeError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE';
}

declare module 'fastify' {
  interface FastifyRequest {
    portalUser?: {
      contactId: string;
      tenantId: string;
      schemaName: string;
      tenantSlug: string;
      organizationId: string | null;
      type: 'portal';
      exp?: number;
    };
  }
}

async function portalAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) throw new PortalAuthError('Token não fornecido');
    const decoded = await verifyPortalToken(token);
    request.portalUser = decoded;
  } catch {
    return reply.code(401).send({ success: false, error: { message: 'Não autorizado' } });
  }
}

const portalTicketCsatParamsSchema = z.object({
  id: z.string().uuid(),
});

const portalTicketCsatBodySchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

function resolveCsatTenantSlug(request: FastifyRequest): string | null {
  const hostName = (request.hostname || request.headers.host || '').split(':')[0]?.toLowerCase() ?? '';
  const parts = hostName.split('.').filter(Boolean);

  if (parts[0] === 'suporte' && parts[1]) return parts[1];
  return parts[0] && parts[0] !== 'localhost' && parts[0] !== '127' ? parts[0] : null;
}

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_PORTAL_ATTACHMENT_SIZE,
      files: 1,
    },
  });

  app.get<{ Querystring: { tenant_slug?: string } }>('/branding', async (request, reply) => {
    const hostInfo = resolveHostTenant(request.headers.host ?? '', request.query.tenant_slug);
    if (!hostInfo.isPortal || !hostInfo.tenantSlug) {
      return reply.code(404).send({ success: false, error: { message: 'Tenant não encontrado' } });
    }

    try {
      const data = await getPortalBranding(hostInfo.tenantSlug);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = portalLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await portalLogin(request.headers.host ?? '', parsed.data);
      return reply.send({ success: true, ...data });
    } catch (err) {
      if (err instanceof PortalAuthError) {
        return reply.code(401).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof PortalForbiddenError) {
        return reply.code(403).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post('/auth/forgot-password', async (request, reply) => {
    const parsed = portalForgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      await requestPortalPasswordReset(request.headers.host ?? '', parsed.data.email);
    } catch (err) {
      request.log.error(
        {
          event: 'portal.forgot_password.error',
          email: parsed.data.email,
          error: err instanceof Error ? err.message : String(err),
        },
        'Falha ao processar recuperação de senha do portal',
      );
    }

    return reply.send({ success: true });
  });

  app.post('/auth/reset-password', async (request, reply) => {
    const parsed = portalResetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      await resetPortalPassword(parsed.data.token, parsed.data.password);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof PortalAuthError) {
        return reply.code(400).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.get('/me', { preHandler: [portalAuth] }, async (request, reply) => {
    try {
      const data = await portalMe(request.portalUser!);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.get('/ticket-types', { preHandler: [portalAuth] }, async (request, reply) => {
    const data = await listPortalTicketTypes(request.portalUser!);
    return reply.send({ success: true, data });
  });

  app.get('/lgpd', { preHandler: [portalAuth] }, async (request, reply) => {
    try {
      const data = await getPortalLgpdState(request.portalUser!);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.patch('/lgpd/consent', { preHandler: [portalAuth] }, async (request, reply) => {
    const parsed = portalLgpdConsentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await updatePortalLgpdConsent(request.portalUser!, parsed.data);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post('/lgpd/requests', { preHandler: [portalAuth] }, async (request, reply) => {
    const parsed = portalLgpdRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await submitPortalLgpdRequest(request.portalUser!, parsed.data);
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.patch('/lgpd/contact-data', { preHandler: [portalAuth] }, async (request, reply) => {
    const parsed = portalLgpdRectificationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await submitPortalLgpdRectificationRequest(request.portalUser!, parsed.data);
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.get('/tickets', { preHandler: [portalAuth] }, async (request, reply) => {
    const parsed = portalTicketsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    const result = await listPortalTickets(request.portalUser!, parsed.data);
    return reply.send({ success: true, ...result });
  });

  app.get<{ Params: { id: string } }>('/tickets/:id', { preHandler: [portalAuth] }, async (request, reply) => {
    try {
      const data = await getPortalTicket(request.portalUser!, request.params.id);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post('/tickets', { preHandler: [portalAuth] }, async (request, reply) => {
    const parsed = portalCreateTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    const data = await createPortalTicket(request.portalUser!, parsed.data);
    return reply.code(201).send({ success: true, data });
  });

  app.post<{ Params: { id: string } }>('/tickets/:id/csat', async (request, reply) => {
    const parsedParams = portalTicketCsatParamsSchema.safeParse(request.params);
    const parsedBody = portalTicketCsatBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({
        success: false,
        error: {
          message: 'Dados inválidos',
          details: {
            params: parsedParams.success ? undefined : parsedParams.error.flatten(),
            body: parsedBody.success ? undefined : parsedBody.error.flatten(),
          },
        },
      });
    }

    const tenantSlug = resolveCsatTenantSlug(request);
    if (!tenantSlug) {
      return reply.code(404).send({ success: false, error: { message: 'Tenant não encontrado' } });
    }

    try {
      await submitTicketCsat(
        parsedParams.data.id,
        parsedBody.data.score,
        parsedBody.data.comment,
        tenantSlug,
      );
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof PortalForbiddenError) {
        return reply.code(403).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/tickets/:id/comments', { preHandler: [portalAuth] }, async (request, reply) => {
    const parsed = portalAddCommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await addPortalComment(request.portalUser!, request.params.id, parsed.data);
      return reply.send(data);
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/tickets/:id/attachments', { preHandler: [portalAuth] }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Content-Type deve ser multipart/form-data' },
      });
    }

    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let mimeType = '';

    try {
      for await (const part of request.parts()) {
        if (part.type === 'file' && part.fieldname === 'file' && !fileBuffer) {
          fileBuffer = await part.toBuffer();
          fileName = part.filename;
          mimeType = part.mimetype;
          continue;
        }
        if (part.type === 'file') {
          await part.toBuffer();
        }
      }
    } catch (err) {
      if (isMultipartTooLargeError(err)) {
        return reply.code(413).send({ success: false, error: { message: 'Arquivo excede o limite de 10MB' } });
      }
      throw err;
    }

    if (!fileBuffer || !fileName || !mimeType) {
      return reply.code(400).send({ success: false, error: { message: 'Arquivo não enviado' } });
    }

    try {
      const data = await addPortalTicketAttachment(request.portalUser!, request.params.id, {
        fileName,
        mimeType,
        buffer: fileBuffer,
      });
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof PortalForbiddenError) {
        return reply.code(403).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.get<{ Params: { attachmentId: string } }>(
    '/tickets/attachments/:attachmentId/content',
    { preHandler: [portalAuth] },
    async (request, reply) => {
      try {
        const { content, filename, mimeType } = await getPortalAttachmentContent(
          request.portalUser!,
          request.params.attachmentId,
        );
        reply.header('Content-Type', mimeType);
        reply.header('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
        reply.header('Cache-Control', 'private, max-age=3600');
        return reply.send(content);
      } catch (err) {
        if (err instanceof PortalNotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string } }>('/tickets/:id/reopen', { preHandler: [portalAuth] }, async (request, reply) => {
    try {
      await reopenTicketByContact(request.portalUser!, request.params.id);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof PortalForbiddenError) {
        return reply.code(403).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}
