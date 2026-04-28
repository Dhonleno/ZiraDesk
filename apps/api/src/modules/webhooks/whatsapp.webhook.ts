import { createHmac } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { decryptCredentials } from '../../utils/crypto.js';
import { getSocketServer } from '../../socket/index.js';

interface WhatsAppPayload {
  instance: string;
  event: string;
  data: {
    key: {
      remoteJid: string;
      id: string;
      fromMe: boolean;
    };
    message?: {
      conversation?: string;
      imageMessage?: Record<string, unknown>;
    };
    pushName?: string;
  };
}

interface TenantRow {
  id: string;
  schema_name: string;
}

interface ChannelRow {
  id: string;
  credentials: string;
}

async function findTenantByWhatsAppInstance(instance: string) {
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, schema_name FROM tenants WHERE status IN ('active', 'trial')`,
  );

  for (const tenant of tenants) {
    const channels = await prisma.$queryRawUnsafe<ChannelRow[]>(
      `SELECT id, credentials FROM "${tenant.schema_name}".channels WHERE type = 'whatsapp' AND status = 'active'`,
    );

    for (const channel of channels) {
      const creds = decryptCredentials(channel.credentials);
      if (creds['instance'] === instance) {
        return { tenant, channel, credentials: creds };
      }
    }
  }

  return null;
}

function verifyHmac(body: string, signature: string): boolean {
  const apiKey = env.EVOLUTION_API_KEY;
  if (!apiKey) return true; // skip verification if key not configured
  const expected = createHmac('sha256', apiKey).update(body).digest('hex');
  return signature === expected;
}

export async function whatsappWebhookRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/webhooks/whatsapp — Evolution API verification
  app.get('/whatsapp', async (_request, reply) => {
    return reply.code(200).send({ status: 'ok' });
  });

  // POST /api/webhooks/whatsapp — receive messages
  app.post<{ Body: WhatsAppPayload }>('/whatsapp', async (request, reply) => {
      const signature = (request.headers['x-hub-signature-256'] as string | undefined) ?? '';
      const rawBody = JSON.stringify(request.body);

      if (!verifyHmac(rawBody, signature.replace('sha256=', ''))) {
        return reply.code(403).send({ error: 'Invalid signature' });
      }

      const payload = request.body;

      if (payload.event !== 'messages.upsert') {
        return reply.send({ success: true });
      }

      if (payload.data.key.fromMe) {
        return reply.send({ success: true });
      }

      const found = await findTenantByWhatsAppInstance(payload.instance);
      if (!found) {
        return reply.send({ success: true });
      }

      const { tenant, channel } = found;
      const phone = payload.data.key.remoteJid.split('@')[0] ?? payload.data.key.remoteJid;
      const text = payload.data.message?.conversation ?? '[mídia]';
      const messageId = payload.data.key.id;
      const pushName = payload.data.pushName ?? phone;

      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL search_path TO "${tenant.schema_name}", public`,
        );

        // Find or create client
        const clientRows = await tx.$queryRawUnsafe<[{ id: string }]>(
          `SELECT id FROM clients WHERE phone = $1 LIMIT 1`,
          phone,
        );

        let clientId: string;
        if (clientRows[0]) {
          clientId = clientRows[0].id;
        } else {
          const newClient = await tx.$queryRawUnsafe<[{ id: string }]>(
            `INSERT INTO clients (name, phone, status) VALUES ($1, $2, 'lead') RETURNING id`,
            pushName,
            phone,
          );
          clientId = newClient[0]!.id;
        }

        // Find or create open conversation for this client+channel
        const convRows = await tx.$queryRawUnsafe<[{ id: string }]>(
          `SELECT id FROM conversations
           WHERE client_id = $1 AND channel_id = $2 AND status = 'open'
           LIMIT 1`,
          clientId,
          channel.id,
        );

        let conversationId: string;
        if (convRows[0]) {
          conversationId = convRows[0].id;
        } else {
          const newConv = await tx.$queryRawUnsafe<[{ id: string }]>(
            `INSERT INTO conversations (client_id, channel_id, channel_type, status)
             VALUES ($1, $2, 'whatsapp', 'open') RETURNING id`,
            clientId,
            channel.id,
          );
          conversationId = newConv[0]!.id;
        }

        // Insert message
        const msgRows = await tx.$queryRawUnsafe<
          [{ id: string; content: string; created_at: Date; sender_type: string }]
        >(
          `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, external_id, status)
           VALUES ($1, 'client', $2, $3, 'text', $4, 'delivered')
           RETURNING id, content, created_at, sender_type`,
          conversationId,
          clientId,
          text,
          messageId,
        );
        const message = msgRows[0]!;

        // Update conversation
        await tx.$executeRawUnsafe(
          `UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2`,
          text.slice(0, 255),
          conversationId,
        );

        return { conversationId, message };
      });

      const io = getSocketServer();
      io.to(`tenant:${tenant.id}`).emit('conversation:message', {
        conversationId: result.conversationId,
        message: result.message,
      });

      return reply.send({ success: true });
    },
  );
}
