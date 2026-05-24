import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  portalAddCommentSchema,
  portalCreateTicketSchema,
  portalForgotPasswordSchema,
  portalLoginSchema,
  portalResetPasswordSchema,
  portalTicketsQuerySchema,
} from './portal.schema.js';
import {
  addPortalComment,
  createPortalTicket,
  getPortalTicket,
  listPortalTicketTypes,
  listPortalTickets,
  portalLogin,
  portalMe,
  PortalAuthError,
  PortalForbiddenError,
  PortalNotFoundError,
  requestPortalPasswordReset,
  resetPortalPassword,
  verifyPortalToken,
} from './portal.service.js';

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

export async function portalRoutes(app: FastifyInstance): Promise<void> {
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
}
