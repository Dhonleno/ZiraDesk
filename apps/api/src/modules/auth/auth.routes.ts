import type { FastifyInstance } from 'fastify';
import { loginBodySchema } from './auth.schema.js';
import {
  loginWithEmailPassword,
  verifyRefreshToken,
  refreshAccessToken,
  getAuthMessages,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.service.js';

const REFRESH_COOKIE = 'zd_refresh';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    const lang = request.language;

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;

    try {
      const { tokens, user } = await loginWithEmailPassword(email, password, lang);

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
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : getAuthMessages(lang).invalidCredentials;
      return reply.code(401).send({ error: msg });
    }
  });

  // POST /api/auth/logout
  app.post('/logout', async (_request, reply) => {
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
