import type { FastifyInstance } from 'fastify';
import { profileRoutes } from './profile.routes.js';
import { loginBodySchema } from './auth.schema.js';
import {
  loginWithEmailPassword,
  verifyRefreshToken,
  refreshAccessToken,
  getAuthMessages,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.service.js';
import { prisma } from '../../config/database.js';
import { redis } from '../../config/redis.js';
import { env } from '../../config/env.js';
import { authMiddleware } from '../../middleware/auth.js';
import { quoteIdent } from '../omnichannel/conversations/protocols.js';
import { getSocketServer } from '../../socket/index.js';

const REFRESH_COOKIE = env.REFRESH_COOKIE_NAME ?? 'zd_refresh';

const RESERVED_SUBDOMAINS = new Set(['app', 'www', 'api', 'localhost', '127', '']);

function extractSlugFromHost(host: string = ''): string | null {
  const subdomain = host.split('.')[0] ?? '';
  return RESERVED_SUBDOMAINS.has(subdomain) ? null : subdomain;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  await app.register(profileRoutes);

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    const lang = request.language;

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }

    const { email, password, tenantSlug: bodySlug } = parsed.data;

    try {
      // Em produção: resolve pelo subdomínio do Host header
      // Em desenvolvimento: usa tenantSlug do body (campo workspace no formulário)
      const isProduction = process.env['NODE_ENV'] === 'production';
      const resolvedSlug = isProduction
        ? extractSlugFromHost(request.headers.host)
        : (bodySlug ?? null);

      let tenantSchemaName: string | undefined;
      let tenantId: string | undefined;
      if (resolvedSlug) {
        const tenant = await prisma.tenant.findUnique({
          where: { slug: resolvedSlug },
          select: { id: true, schemaName: true, status: true },
        });
        if (!tenant) {
          return reply.code(404).send({ error: 'Tenant não encontrado' });
        }
        if (tenant.status !== 'active' && tenant.status !== 'trial') {
          return reply.code(403).send({ error: 'Conta suspensa ou cancelada' });
        }
        tenantSchemaName = tenant.schemaName;
        tenantId = tenant.id;
      }

      const { tokens, user } = await loginWithEmailPassword(email, password, lang, tenantSchemaName, tenantId);

      reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: REFRESH_TOKEN_TTL_SECONDS,
      });

      return reply.code(200).send({
        accessToken: tokens.accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar_url: user.avatar_url ?? null,
          ...(user.tenantId ? { tenantId: user.tenantId } : {}),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : getAuthMessages(lang).invalidCredentials;
      return reply.code(401).send({ error: msg });
    }
  });

  // POST /api/auth/logout
  app.post('/logout', { preHandler: [authMiddleware] }, async (request, reply) => {
    const forcedLogoutAt = Math.floor(Date.now() / 1000).toString();
    await redis.set(`auth:force_logout_after:${request.user.id}`, forcedLogoutAt, 'EX', 60 * 60 * 24 * 30);

    if (!request.user.isSuperAdmin && request.user.tenantId) {
      const tenantSchema = request.user.schemaName ?? (
        await prisma.tenant.findUnique({
          where: { id: request.user.tenantId },
          select: { schemaName: true },
        })
      )?.schemaName;

      if (tenantSchema) {
        await prisma.$executeRawUnsafe(
          `UPDATE ${quoteIdent(tenantSchema)}.agent_assignments
           SET status = 'offline',
               is_available = false
           WHERE user_id = $1::uuid`,
          request.user.id,
        );

        try {
          const io = getSocketServer();
          io.to(`tenant:${request.user.tenantId}`).emit('agent:offline', { userId: request.user.id });
        } catch {
          // socket server not available during startup/shutdown
        }
      }
    }

    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return reply.code(200).send({ message: 'Sessão encerrada' });
  });

  // POST /api/auth/refresh
  app.post('/refresh', async (request, reply) => {
    const refreshToken = request.cookies[REFRESH_COOKIE];
    const lang = request.language;

    if (!refreshToken) {
      return reply.code(401).send({ error: getAuthMessages(lang).tokenExpired });
    }

    try {
      const payload = verifyRefreshToken(refreshToken, lang);
      const accessToken = refreshAccessToken(payload);

      return reply.code(200).send({ accessToken });
    } catch (err) {
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      const msg = err instanceof Error ? err.message : getAuthMessages(lang).tokenExpired;
      return reply.code(401).send({ error: msg });
    }
  });
}
