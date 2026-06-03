import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../config/database.js';
import { provisionTenantSchema } from '../../super-admin/tenants/tenants.service.js';
import {
  notifyQueuePosition,
  notifyAgentAssumed,
  handle24hWindowExpiration,
} from './queue-notifications.service.js';

// Mock BullMQ queue — we only want to verify DB side-effects
vi.mock('../../../jobs/queue.js', () => ({
  messageQueue: { add: vi.fn().mockResolvedValue(undefined) },
  knowledgeIndexQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

// Mock decryptCredentials to bypass AES in unit environment
vi.mock('../../../utils/crypto.js', () => ({
  decryptCredentials: vi.fn().mockReturnValue({
    phoneNumberId: 'test-phone-number-id',
    accessToken: 'test-access-token',
  }),
  encryptCredentials: vi.fn().mockReturnValue('mock-encrypted'),
}));

import { messageQueue } from '../../../jobs/queue.js';

const messageQueueAddMock = vi.mocked(messageQueue.add);

interface TempTenant { id: string; schemaName: string }

let tenant: TempTenant;
let channelId: string;
let agentId: string;

async function createTempTenant(): Promise<TempTenant> {
  const suffix = Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000);
  const slug = `qnotif-${suffix}`;
  const schemaName = `qnotif_${suffix}`;

  const plan = await prisma.plan.upsert({
    where: { slug: 'test-plan' },
    update: { name: 'Plano Teste', priceMonth: new Prisma.Decimal('0'), priceYear: new Prisma.Decimal('0'), maxUsers: 50, maxContacts: 500, isActive: true, features: {} },
    create: { name: 'Plano Teste', slug: 'test-plan', priceMonth: new Prisma.Decimal('0'), priceYear: new Prisma.Decimal('0'), maxUsers: 50, maxContacts: 500, isActive: true, features: {} },
  });

  const t = await prisma.tenant.create({
    data: {
      name: `Tenant QNotif ${suffix}`,
      slug,
      schemaName,
      planId: plan.id,
      status: 'active',
      trialEndsAt: null,
      settings: {
        queue_notifications_enabled: true,
        queue_message_template: 'Você é o nº {{position}} na fila.',
        queue_throttle_seconds: 60,
        agent_assume_template: 'Olá! Sou {{agent_name}}, vou te atender.',
        expire_24h_action: 'close',
        expire_24h_message: 'Encerrando por 24h.',
      },
    },
    select: { id: true, schemaName: true },
  });

  await provisionTenantSchema(t.schemaName);
  return { id: t.id, schemaName: t.schemaName };
}

async function createChannel(schemaName: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".channels (name, type, status, credentials)
     VALUES ('Test WA Channel', 'whatsapp', 'active', '{"phoneNumberId":"test-phone","accessToken":"test-token"}'::jsonb)
     RETURNING id`,
  );
  return rows[0]!.id;
}

async function createContact(schemaName: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".contacts (id, name, whatsapp)
     VALUES (gen_random_uuid(), 'Test Contact', '5511999990001')
     RETURNING id`,
  );
  return rows[0]!.id;
}

async function createQueueConversation(
  schemaName: string,
  contactId: string,
  chId: string,
  queueEnteredAt?: Date,
): Promise<string> {
  const enteredAt = queueEnteredAt ?? new Date();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".conversations
       (id, channel_id, channel_type, conversation_type, status, contact_id, assigned_to, queue_entered_at)
     VALUES (gen_random_uuid(), $1::uuid, 'whatsapp', 'inbound', 'open', $2::uuid, NULL, $3::timestamptz)
     RETURNING id`,
    chId,
    contactId,
    enteredAt.toISOString(),
  );
  return rows[0]!.id;
}

async function createAgent(schemaName: string): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".users (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, 'Test Agent', 'agent@test.test', 'hash', 'agent', 'active', 'pt-BR', '{}')
     ON CONFLICT (id) DO NOTHING`,
    id,
  );
  return id;
}

async function getMessageCount(schemaName: string, conversationId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count FROM "${schemaName}".messages WHERE conversation_id = $1::uuid AND sender_type = 'system'`,
    conversationId,
  );
  return Number(rows[0]?.count ?? 0);
}

async function getConversation(schemaName: string, id: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ status: string; closure_reason: unknown }>>(
    `SELECT status, closure_reason FROM "${schemaName}".conversations WHERE id = $1::uuid`,
    id,
  );
  return rows[0] ?? null;
}

async function getQueueNotifRow(schemaName: string, conversationId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ last_position: number; last_notified_at: Date }>>(
    `SELECT last_position, last_notified_at
     FROM "${schemaName}".queue_notifications
     WHERE conversation_id = $1::uuid`,
    conversationId,
  );
  return rows[0] ?? null;
}

beforeAll(async () => {
  tenant = await createTempTenant();
  channelId = await createChannel(tenant.schemaName);
  agentId = await createAgent(tenant.schemaName);
});

afterAll(async () => {
  if (tenant) {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`);
    await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  }
});

beforeEach(async () => {
  // Clean conversations and messages between tests
  await prisma.$executeRawUnsafe(
    `TRUNCATE "${tenant.schemaName}".messages,
              "${tenant.schemaName}".conversations
     RESTART IDENTITY CASCADE`,
  );
  // Reset queue_notifications if exists
  await prisma.$executeRawUnsafe(
    `DELETE FROM "${tenant.schemaName}".queue_notifications WHERE TRUE`,
  ).catch(() => { /* table may not exist yet */ });
  messageQueueAddMock.mockClear();
});

describe('notifyQueuePosition', () => {
  it('sends position 1 message for first customer in queue', async () => {
    const contactId = await createContact(tenant.schemaName);
    const convId = await createQueueConversation(tenant.schemaName, contactId, channelId);

    await notifyQueuePosition(tenant.schemaName, tenant.id, convId);

    const msgCount = await getMessageCount(tenant.schemaName, convId);
    expect(msgCount).toBe(1);
    expect(messageQueueAddMock).toHaveBeenCalledOnce();

    const jobData = messageQueueAddMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(jobData?.content).toContain('nº 1');
    expect(jobData?.to).toBe('5511999990001');
  });

  it('sends position 2 for second customer in queue', async () => {
    const contact1Id = await createContact(tenant.schemaName);
    const contact2Id = await createContact(tenant.schemaName);

    const t1 = new Date(Date.now() - 5000);
    const t2 = new Date(Date.now() - 2000);

    await createQueueConversation(tenant.schemaName, contact1Id, channelId, t1);
    const conv2Id = await createQueueConversation(tenant.schemaName, contact2Id, channelId, t2);

    await notifyQueuePosition(tenant.schemaName, tenant.id, conv2Id);

    const jobData = messageQueueAddMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(jobData?.content).toContain('nº 2');
  });

  it('does NOT resend within throttle window if position unchanged', async () => {
    const contactId = await createContact(tenant.schemaName);
    const convId = await createQueueConversation(tenant.schemaName, contactId, channelId);

    await notifyQueuePosition(tenant.schemaName, tenant.id, convId);
    messageQueueAddMock.mockClear();

    // Call again immediately — should be throttled
    await notifyQueuePosition(tenant.schemaName, tenant.id, convId);

    expect(messageQueueAddMock).not.toHaveBeenCalled();
  });

  it('resends when position changes even within throttle window', async () => {
    const contact1Id = await createContact(tenant.schemaName);
    const contact2Id = await createContact(tenant.schemaName);

    const t1 = new Date(Date.now() - 5000);
    const t2 = new Date(Date.now() - 2000);

    const conv1Id = await createQueueConversation(tenant.schemaName, contact1Id, channelId, t1);
    const conv2Id = await createQueueConversation(tenant.schemaName, contact2Id, channelId, t2);

    // Notify conv2 at position 2
    await notifyQueuePosition(tenant.schemaName, tenant.id, conv2Id);
    expect(messageQueueAddMock).toHaveBeenCalledOnce();
    messageQueueAddMock.mockClear();

    // Remove conv1 from queue (assign it) — conv2 becomes position 1
    await prisma.$executeRawUnsafe(
      `UPDATE "${tenant.schemaName}".conversations
       SET assigned_to = $1::uuid, queue_entered_at = NULL
       WHERE id = $2::uuid`,
      agentId,
      conv1Id,
    );

    // Notify conv2 again — position changed to 1, should resend despite throttle
    await notifyQueuePosition(tenant.schemaName, tenant.id, conv2Id);
    expect(messageQueueAddMock).toHaveBeenCalledOnce();

    const notifRow = await getQueueNotifRow(tenant.schemaName, conv2Id);
    expect(notifRow?.last_position).toBe(1);
  });

  it('does NOT send if queue_notifications_enabled is false', async () => {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { settings: { queue_notifications_enabled: false } },
    });

    try {
      const contactId = await createContact(tenant.schemaName);
      const convId = await createQueueConversation(tenant.schemaName, contactId, channelId);

      await notifyQueuePosition(tenant.schemaName, tenant.id, convId);

      expect(messageQueueAddMock).not.toHaveBeenCalled();
    } finally {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          settings: {
            queue_notifications_enabled: true,
            queue_message_template: 'Você é o nº {{position}} na fila.',
            queue_throttle_seconds: 60,
            agent_assume_template: 'Olá! Sou {{agent_name}}, vou te atender.',
            expire_24h_action: 'close',
            expire_24h_message: 'Encerrando por 24h.',
          },
        },
      });
    }
  });

  it('does NOT send if conversation already has an assigned agent', async () => {
    const contactId = await createContact(tenant.schemaName);
    // Create conversation with agent already assigned (not in queue)
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${tenant.schemaName}".conversations
         (id, channel_id, channel_type, conversation_type, status, contact_id, assigned_to, queue_entered_at)
       VALUES (gen_random_uuid(), $1::uuid, 'whatsapp', 'inbound', 'open', $2::uuid, $3::uuid, NULL)
       RETURNING id`,
      channelId,
      contactId,
      agentId,
    );
    const convId = rows[0]!.id;

    await notifyQueuePosition(tenant.schemaName, tenant.id, convId);

    expect(messageQueueAddMock).not.toHaveBeenCalled();
  });

  it('does NOT send for non-whatsapp channels', async () => {
    // Create an email channel
    const emailChannelRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${tenant.schemaName}".channels (name, type, status, credentials)
       VALUES ('Email Channel', 'email', 'active', '{}')
       RETURNING id`,
    );
    const emailChannelId = emailChannelRows[0]!.id;

    const contactId = await createContact(tenant.schemaName);
    const emailConvRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "${tenant.schemaName}".conversations
         (id, channel_id, channel_type, conversation_type, status, contact_id, assigned_to, queue_entered_at)
       VALUES (gen_random_uuid(), $1::uuid, 'email', 'inbound', 'open', $2::uuid, NULL, NOW())
       RETURNING id`,
      emailChannelId,
      contactId,
    );
    const convId = emailConvRows[0]!.id;

    await notifyQueuePosition(tenant.schemaName, tenant.id, convId);

    expect(messageQueueAddMock).not.toHaveBeenCalled();
  });
});

describe('notifyAgentAssumed', () => {
  it('sends greeting message with agent name', async () => {
    const contactId = await createContact(tenant.schemaName);
    const convId = await createQueueConversation(tenant.schemaName, contactId, channelId);

    // Assign agent
    await prisma.$executeRawUnsafe(
      `UPDATE "${tenant.schemaName}".conversations
       SET assigned_to = $1::uuid, queue_entered_at = NULL
       WHERE id = $2::uuid`,
      agentId,
      convId,
    );

    await notifyAgentAssumed(tenant.schemaName, tenant.id, convId, agentId);

    expect(messageQueueAddMock).toHaveBeenCalledOnce();
    const jobData = messageQueueAddMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(typeof jobData?.content).toBe('string');
    expect(jobData?.content as string).toContain('Test Agent');
  });

  it('does NOT send if queue_notifications_enabled is false', async () => {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { settings: { queue_notifications_enabled: false } },
    });

    try {
      const contactId = await createContact(tenant.schemaName);
      const convId = await createQueueConversation(tenant.schemaName, contactId, channelId);

      await notifyAgentAssumed(tenant.schemaName, tenant.id, convId, agentId);

      expect(messageQueueAddMock).not.toHaveBeenCalled();
    } finally {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          settings: {
            queue_notifications_enabled: true,
            queue_message_template: 'Você é o nº {{position}} na fila.',
            queue_throttle_seconds: 60,
            agent_assume_template: 'Olá! Sou {{agent_name}}, vou te atender.',
            expire_24h_action: 'close',
            expire_24h_message: 'Encerrando por 24h.',
          },
        },
      });
    }
  });
});

describe('handle24hWindowExpiration', () => {
  it('closes and notifies conversation stuck in queue for > 24h (action=close)', async () => {
    const contactId = await createContact(tenant.schemaName);
    const pastDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago
    const convId = await createQueueConversation(tenant.schemaName, contactId, channelId, pastDate);

    await handle24hWindowExpiration(tenant.schemaName, tenant.id);

    // Message should have been enqueued
    expect(messageQueueAddMock).toHaveBeenCalled();
    const jobData = messageQueueAddMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(jobData?.content).toContain('24h');

    // Conversation should be closed
    const conv = await getConversation(tenant.schemaName, convId);
    expect(conv?.status).toBe('closed');
    const reason = typeof conv?.closure_reason === 'string'
      ? JSON.parse(conv.closure_reason)
      : conv?.closure_reason;
    expect((reason as Record<string, unknown>)?.type).toBe('expired_24h');
  });

  it('does NOT close conversation with action=keep_open', async () => {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        settings: {
          queue_notifications_enabled: true,
          queue_message_template: 'Você é o nº {{position}} na fila.',
          queue_throttle_seconds: 60,
          agent_assume_template: 'Olá! Sou {{agent_name}}, vou te atender.',
          expire_24h_action: 'keep_open',
          expire_24h_message: 'Encerrando por 24h.',
        },
      },
    });

    try {
      const contactId = await createContact(tenant.schemaName);
      const pastDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const convId = await createQueueConversation(tenant.schemaName, contactId, channelId, pastDate);

      await handle24hWindowExpiration(tenant.schemaName, tenant.id);

      expect(messageQueueAddMock).not.toHaveBeenCalled();

      const conv = await getConversation(tenant.schemaName, convId);
      expect(conv?.status).toBe('open');
    } finally {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          settings: {
            queue_notifications_enabled: true,
            queue_message_template: 'Você é o nº {{position}} na fila.',
            queue_throttle_seconds: 60,
            agent_assume_template: 'Olá! Sou {{agent_name}}, vou te atender.',
            expire_24h_action: 'close',
            expire_24h_message: 'Encerrando por 24h.',
          },
        },
      });
    }
  });

  it('does NOT affect conversation in queue for < 24h', async () => {
    const contactId = await createContact(tenant.schemaName);
    const recentDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const convId = await createQueueConversation(tenant.schemaName, contactId, channelId, recentDate);

    await handle24hWindowExpiration(tenant.schemaName, tenant.id);

    expect(messageQueueAddMock).not.toHaveBeenCalled();

    const conv = await getConversation(tenant.schemaName, convId);
    expect(conv?.status).toBe('open');
  });
});
