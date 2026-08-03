import './config/env.js'; // valida env antes de qualquer coisa
import './jobs/send-message.job.js'; // inicia o worker de mensagens
import './jobs/inactivity.job.js'; // inicia o worker de inatividade
import './jobs/cleanup-csat.job.js'; // inicia cleanup horário de CSAT expirado
import './jobs/waiting-expiry.job.js'; // fecha conversas waiting expiradas
import './jobs/presence-cleanup.job.js'; // inicia cleanup de presença de agentes
import './jobs/process-pending-queue.job.js'; // processa conversas pending periodicamente
import './jobs/conversation-routing-retry.job.js'; // retenta roteamento por habilidade com timeout
import './jobs/lgpd-retention.job.js'; // executa retenção/anonimização LGPD diária
import './jobs/lgpd-sla.job.js'; // monitora SLA LGPD (notificações e alertas a cada 6h)
import './jobs/ticket-sla.job.js'; // monitora SLA de tickets e escala prioridade
import './jobs/ticket-sla-warning.job.js'; // alerta 30min antes do vencimento de SLA
import './jobs/knowledge-index.job.js'; // inicia o worker de indexação de conhecimento
import './jobs/recalculate-queue-positions.job.js'; // recalcula posições na fila e notifica clientes
import './jobs/queue-expire-24h.job.js'; // encerra conversas sem atendimento após 24h na fila
import './jobs/campaign-send.job.js'; // processa disparos de campanhas
import './jobs/campaign-scheduler.job.js'; // agenda campanhas programadas
import './jobs/contact-import.job.js'; // processa importação assíncrona de contatos
import './jobs/usage-snapshot.job.js'; // persiste snapshots diarios de uso
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import rawBody from 'fastify-raw-body';
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
import { legalModuleRoutes } from './modules/legal/index.js';
import { leadsModuleRoutes } from './modules/leads/index.js';
import { redmineWebhookRoutes } from './modules/integrations/redmine/redmine.routes.js';
import { languageMiddleware } from './middleware/language.js';
import { registerTenantPrismaContextHooks } from './middleware/tenantSchemaFromJwt.js';
import { createSocketServer } from './socket/index.js';
import { ensureAgentAssignmentsInfrastructure } from './modules/omnichannel/conversations/auto-assign.service.js';
import { logger } from './config/logger.js';
import { getStorage } from './lib/storage/index.js';

const app = Fastify({
  ignoreTrailingSlash: true,
  // 1 hop = o Nginx da borda, único caminho até a API (o container só faz
  // `expose: 3333`, sem porta publicada). Precisa ser 1, não `true`: o Nginx
  // usa $proxy_add_x_forwarded_for, que *anexa* ao X-Forwarded-For enviado
  // pelo cliente em vez de substituí-lo. Com `true` o proxy-addr devolveria a
  // entrada mais à esquerda — controlada pelo cliente — e o rate limit por IP
  // viraria burlável trocando o header a cada request. Com 1 vale sempre a
  // última entrada, que o Nginx anexou a partir de $remote_addr (derivado de
  // CF-Connecting-IP via real_ip_header).
  trustProxy: 1,
  logger: {
    level: env.NODE_ENV === 'development' ? 'info' : 'warn',
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  },
});

function corsOrigin() {
  if (env.NODE_ENV !== 'production') return '*';
  return ['https://app.ziradesk.com', /\.ziradesk\.com$/];
}

function rateLimitMax(requestUrl: string) {
  if (requestUrl.startsWith('/api/auth/refresh')) return 60;
  if (requestUrl.startsWith('/api/auth/')) return 10;
  if (requestUrl.startsWith('/api/webhooks/')) return 1000;
  if (requestUrl.startsWith('/api/leads')) return 5;
  return 200;
}

// Roda no bootstrap, antes do app.listen: nenhuma falha aqui pode abortar o boot.
// Um tenant meio-provisionado (schema ausente ou incompleto) é pulado, nunca propagado.
async function resetAgentPresenceOnBoot(): Promise<void> {
  let tenants: Array<{ id: string; schema_name: string }>;

  try {
    tenants = await prisma.$queryRawUnsafe<Array<{ id: string; schema_name: string }>>(
      `SELECT id, schema_name
       FROM tenants
       WHERE status IN ('active', 'trial')`,
    );
  } catch (err) {
    logger.error(
      {
        dbErrorCode: (err as { meta?: { code?: string } })?.meta?.code,
        err: err instanceof Error ? err.message : String(err),
      },
      '[Presence] Failed to list tenants — skipping presence reset on boot',
    );
    return;
  }

  let skipped = 0;

  for (const tenant of tenants) {
    try {
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
    } catch (err) {
      skipped += 1;
      logger.error(
        {
          tenantId: tenant.id,
          schemaName: tenant.schema_name,
          dbErrorCode: (err as { meta?: { code?: string } })?.meta?.code,
          err: err instanceof Error ? err.message : String(err),
        },
        '[Presence] Skipping tenant — failed to reset agent presence on boot',
      );
    }
  }

  if (skipped > 0) {
    logger.warn(
      { skipped, total: tenants.length },
      '[Presence] Boot presence reset completed with skipped tenants',
    );
  }
}

async function bootstrap(): Promise<void> {
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin: corsOrigin(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  if (process.env.NODE_ENV !== 'test') {
    await app.register(rateLimit, {
      max: (request) => rateLimitMax(request.url),
      timeWindow: '1 minute',
      keyGenerator: (request) => {
        // Rotas públicas chaveiam por IP e nunca pelo Authorization: sem isso,
        // um cliente anônimo escaparia do balde mandando um header arbitrário
        // e diferente a cada request.
        if (
          request.url.startsWith('/api/auth/')
          || request.url.startsWith('/api/webhooks/')
          || request.url.startsWith('/api/leads')
        ) {
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
  }

  await app.register(cookie, {
    secret: env.JWT_SECRET,
  });

  await app.register(rawBody, {
    field: 'rawBody',
    global: false,
    encoding: false,
    runFirst: true,
  });

  // Detecta idioma em todas as requisições via Accept-Language
  app.addHook('onRequest', languageMiddleware);
  registerTenantPrismaContextHooks(app);

  // Webhooks sem auth JWT e sem tenant middleware — registrar primeiro
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });
  await app.register(redmineWebhookRoutes, { prefix: '/api' });
  await app.register(legalModuleRoutes, { prefix: '/api/legal' });
  await app.register(leadsModuleRoutes, { prefix: '/api/leads' });

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

  // Rota pública para servir uploads locais (logos e avatares).
  // Ticket attachments são servidos via rota autenticada própria.
  app.get('/api/files/*', async (request, reply) => {
    const key = (request.params as { '*': string })['*'] ?? '';
    if (key.startsWith('tickets/')) {
      return reply.code(403).send({ error: 'Acesso negado' });
    }
    try {
      const buffer = await getStorage().download(key);
      const ext = key.split('.').pop() ?? '';
      const mime =
        ext === 'png' ? 'image/png' :
        ext === 'webp' ? 'image/webp' :
        ext === 'svg' ? 'image/svg+xml' :
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
        'application/octet-stream';
      reply.header('Content-Type', mime);
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(buffer);
    } catch {
      return reply.code(404).send({ error: 'Arquivo não encontrado' });
    }
  });

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

  // A função já é resiliente por tenant; este catch é a garantia final de que
  // nada escapa para o bootstrap e impede o app.listen abaixo.
  await resetAgentPresenceOnBoot().catch((err: unknown) => {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[Presence] Presence reset failed — continuing boot',
    );
  });
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
    app.log.info(`[Server] Received ${signal}, shutting down gracefully`);
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  });
});

bootstrap().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Server] Fatal startup error');
  process.exit(1);
});
