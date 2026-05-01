import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { AuthenticatedUser } from '@ziradesk/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}

interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: AuthenticatedUser['role'];
  tenantId?: string;
  schemaName?: string;
  isSuperAdmin: boolean;
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Token de acesso não fornecido' });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

    if (payload.isSuperAdmin) {
      request.user = {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        role: 'super_admin',
        isSuperAdmin: true,
      };
    } else {
      if (!payload.tenantId) {
        return reply.code(401).send({ error: 'Token inválido' });
      }
      request.user = {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        role: payload.role,
        tenantId: payload.tenantId,
        ...(payload.schemaName ? { schemaName: payload.schemaName } : {}),
        isSuperAdmin: false,
      };
    }
  } catch {
    return reply.code(401).send({ error: 'Token inválido ou expirado' });
  }
}
