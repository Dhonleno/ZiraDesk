import './config/env.js'; // valida env antes de qualquer coisa
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { superAdminRoutes } from './modules/super-admin/index.js';
import { tenantRoutes } from './modules/tenant/index.js';
import { adminRoutes } from './modules/admin/index.js';
import { crmRoutes } from './modules/crm/index.js';
import { languageMiddleware } from './middleware/language.js';
import { createSocketServer } from './socket/index.js';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'development' ? 'info' : 'warn',
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  },
});

async function bootstrap(): Promise<void> {
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin: env.APP_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Muitas requisições. Tente novamente em instantes.',
    }),
  });

  await app.register(cookie, {
    secret: env.JWT_SECRET,
  });

  // Detecta idioma em todas as requisições via Accept-Language
  app.addHook('onRequest', languageMiddleware);

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(superAdminRoutes, { prefix: '/api/super-admin' });
  await app.register(tenantRoutes, { prefix: '/api/tenant' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(crmRoutes, { prefix: '/api/crm' });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Inicia o servidor HTTP e anexa Socket.io
  const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSocketServer(app.server as any);

  app.log.info(`🚀 ZiraDesk API rodando em ${address}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
