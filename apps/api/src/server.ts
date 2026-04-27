import './config/env.js'; // valida env antes de qualquer coisa
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { languageMiddleware } from './middleware/language.js';
import { createSocketServer } from './socket/index.js';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'development' ? 'info' : 'warn',
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
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

  // Rotas de autenticação — sem tenant middleware (login é global)
  await app.register(authRoutes, { prefix: '/api/auth' });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Inicia o servidor HTTP e anexa Socket.io
  const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
  createSocketServer(app.server);

  app.log.info(`🚀 ZiraDesk API rodando em ${address}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
