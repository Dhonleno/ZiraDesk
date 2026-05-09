import './config/env.js'; // valida env antes de qualquer coisa
import './jobs/send-message.job.js'; // inicia o worker de mensagens
import './jobs/inactivity.job.js'; // inicia o worker de inatividade
import './jobs/cleanup-csat.job.js'; // inicia cleanup horário de CSAT expirado
import './jobs/presence-cleanup.job.js'; // inicia cleanup de presença de agentes
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { redis } from './config/redis.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { superAdminRoutes } from './modules/super-admin/index.js';
import { omnichannelModuleRoutes } from './modules/omnichannel/index.js';
import { adminRoutes } from './modules/admin/index.js';
import { crmRoutes } from './modules/crm/index.js';
import { ticketModuleRoutes } from './modules/tickets/index.js';
import { webhookRoutes } from './modules/webhooks/index.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import { searchRoutes } from './modules/search/search.routes.js';
import { callsRoutes } from './modules/calls/calls.routes.js';
import { portalModuleRoutes } from './modules/portal/index.js';
import { languageMiddleware } from './middleware/language.js';
import { createSocketServer } from './socket/index.js';
import { ensureAgentAssignmentsInfrastructure } from './modules/omnichannel/conversations/auto-assign.service.js';

const app = Fastify({
  ignoreTrailingSlash: true,
  logger: {
    level: env.NODE_ENV === 'development' ? 'info' : 'warn',
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  },
});

function corsOrigin() {
  if (env.NODE_ENV !== 'production') return '*';
  return ['https://app.ziradesk.com.br', /\.ziradesk\.com\.br$/];
}

function rateLimitMax(requestUrl: string) {
  if (requestUrl.startsWith('/api/auth/')) return 10;
  if (requestUrl.startsWith('/api/webhooks/')) return 1000;
  return 200;
}

async function resetAgentPresenceOnBoot(): Promise<void> {
  const tenants = await prisma.$queryRawUnsafe<Array<{ schema_name: string }>>(
    `SELECT schema_name
     FROM tenants
     WHERE status IN ('active', 'trial')`,
  );

  for (const tenant of tenants) {
    await ensureAgentAssignmentsInfrastructure(prisma, tenant.schema_name);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${tenant.schema_name}", public`);
      await tx.$executeRawUnsafe(
        `UPDATE agent_assignments
         SET status = 'offline',
             is_available = false,
             online_since = NULL`,
      );
    });
  }
}

async function bootstrap(): Promise<void> {
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin: corsOrigin(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: (request) => rateLimitMax(request.url),
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      if (request.url.startsWith('/api/auth/') || request.url.startsWith('/api/webhooks/')) {
        return request.ip;
      }
      return request.headers.authorization ?? request.ip;
    },
    allowList: (request) => request.url === '/health',
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

  // Webhooks sem auth JWT e sem tenant middleware — registrar primeiro
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(superAdminRoutes, { prefix: '/api/super-admin' });
  await app.register(omnichannelModuleRoutes, { prefix: '/api/omnichannel' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(crmRoutes, { prefix: '/api/crm' });
  await app.register(ticketModuleRoutes, { prefix: '/api/tickets' });
  await app.register(portalModuleRoutes, { prefix: '/api/portal' });
  await app.register(notificationsRoutes, { prefix: '/api/notifications' });
  await app.register(searchRoutes, { prefix: '/api/search' });
  await app.register(callsRoutes, { prefix: '/api/calls' });

  app.get('/health', async (_request, reply) => {
    const services = {
      database: 'ok' as 'ok' | 'error',
      redis: 'ok' as 'ok' | 'error',
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      services.database = 'error';
    }

    try {
      await redis.ping();
    } catch {
      services.redis = 'error';
    }

    const healthy = services.database === 'ok' && services.redis === 'ok';
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'error',
      version: process.env['npm_package_version'] ?? '0.1.0',
      timestamp: new Date().toISOString(),
      services,
    });
  });

  await resetAgentPresenceOnBoot();
  app.log.info('[Presence] Agent presence reset to offline on boot');

  // Inicia o servidor HTTP e anexa Socket.io
  const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSocketServer(app.server as any);

  app.log.info(`🚀 ZiraDesk API rodando em ${address}`);
}

const signals = ['SIGTERM', 'SIGINT'] as const;
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`[Server] Received ${signal}, shutting down gracefully`);
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  });
});

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
