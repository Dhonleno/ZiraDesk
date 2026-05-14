import type { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';

let io: SocketServer | null = null;
let hasPublicUsersTable: boolean | null = null;
const PRESENCE_TTL_SECONDS = 60;
const DISCONNECT_GRACE_MS = 5_000;

interface TypingPayload {
  conversationId?: string;
}

interface PresencePayload {
  userId?: string;
  status?: string;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseTypingPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const conversationId = (payload as TypingPayload).conversationId;
  if (typeof conversationId !== 'string' || !conversationId.trim()) return null;
  const normalized = conversationId.trim();
  if (!isUuid(normalized)) return null;
  return normalized;
}

function parsePresencePayload(payload: unknown): PresencePayload {
  if (!payload || typeof payload !== 'object') return {};
  const incoming = payload as PresencePayload;
  const parsed: PresencePayload = {};
  if (typeof incoming.userId === 'string') {
    parsed.userId = incoming.userId;
  }
  if (typeof incoming.status === 'string') {
    parsed.status = incoming.status;
  }
  return parsed;
}

function normalizePresenceStatus(status: string | undefined): 'online' | 'paused' {
  return status === 'paused' ? 'paused' : 'online';
}

function presenceRedisKey(tenantId: string, userId: string): string {
  return `presence:${tenantId}:${userId}`;
}

async function publicUsersTableExists(): Promise<boolean> {
  if (hasPublicUsersTable !== null) return hasPublicUsersTable;

  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT to_regclass('public.users') IS NOT NULL AS exists`,
  );
  hasPublicUsersTable = rows[0]?.exists === true;
  return hasPublicUsersTable;
}

async function refreshAgentPresence(schemaName: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
    await tx.$executeRawUnsafe(
      `UPDATE agent_assignments
       SET last_seen_at = NOW()
       WHERE user_id = $1::uuid`,
      userId,
    );
    await tx.$executeRawUnsafe(
      `UPDATE users
       SET last_seen_at = NOW()
       WHERE id = $1::uuid`,
      userId,
    );
  });

  if (await publicUsersTableExists()) {
    await prisma.$executeRawUnsafe(
      `UPDATE public.users
       SET last_seen_at = NOW()
       WHERE id = $1::uuid`,
      userId,
    );
  }
}

async function touchPresenceKey(
  tenantId: string,
  userId: string,
  status: 'online' | 'paused' = 'online',
): Promise<void> {
  await redis.setex(presenceRedisKey(tenantId, userId), PRESENCE_TTL_SECONDS, status);
}

async function renewPresenceKey(tenantId: string, userId: string): Promise<void> {
  const key = presenceRedisKey(tenantId, userId);
  const renewed = await redis.expire(key, PRESENCE_TTL_SECONDS);
  if (renewed === 0) {
    await redis.setex(key, PRESENCE_TTL_SECONDS, 'online');
  }
}

async function setAgentPresenceState(
  schemaName: string,
  userId: string,
  nextStatus: 'online' | 'paused',
): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ previous_status: string | null }>>(
    `WITH previous AS (
       SELECT status
       FROM ${quoteIdent(schemaName)}.agent_assignments
       WHERE user_id = $1::uuid
     )
     UPDATE ${quoteIdent(schemaName)}.agent_assignments
     SET status = $2::text,
         is_available = CASE WHEN $2::text = 'online' THEN true ELSE false END,
         last_seen_at = NOW(),
         online_since = CASE
           WHEN $2::text = 'online' AND COALESCE(status, 'offline') = 'offline' THEN NOW()
           WHEN $2::text <> 'online' THEN NULL
           ELSE online_since
         END
     WHERE user_id = $1::uuid
     RETURNING (SELECT status FROM previous LIMIT 1) AS previous_status`,
    userId,
    nextStatus,
  );

  return rows[0]?.previous_status ?? null;
}

export function createSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.APP_URL,
      credentials: true,
    },
    path: '/socket.io',
    pingTimeout: 60_000,
    pingInterval: 25_000,
    allowEIO3: true,
  });
  const socketServer = io;

  // Valida JWT antes de aceitar a conexão
  socketServer.use((socket, next) => {
    const token = socket.handshake.auth['token'] as string | undefined;
    if (!token) return next(new Error('Unauthorized'));

    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as {
        sub: string;
        tenantId?: string;
        schemaName?: string;
        isSuperAdmin: boolean;
      };

      if (!payload.tenantId) return next(new Error('Unauthorized'));

      socket.data.tenantId = payload.tenantId;
      socket.data.userId = payload.sub;
      if (payload.schemaName) {
        socket.data.schemaName = payload.schemaName;
        next();
        return;
      }

      void prisma.tenant.findUnique({
        where: { id: payload.tenantId },
        select: { schemaName: true },
      }).then((tenant) => {
        if (!tenant?.schemaName) {
          next(new Error('Unauthorized'));
          return;
        }
        socket.data.schemaName = tenant.schemaName;
        next();
      }).catch(() => next(new Error('Unauthorized')));
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  socketServer.on('connection', (socket) => {
    const tenantId = socket.data.tenantId as string;
    const userId = socket.data.userId as string;
    const schemaName = socket.data.schemaName as string | undefined;
    void socket.join(`tenant:${tenantId}`);
    void socket.join(`agent:${userId}`);

    const handlePresenceOnline = async (payload?: unknown): Promise<void> => {
      if (!schemaName) return;

      const presencePayload = parsePresencePayload(payload);
      if (presencePayload.userId && presencePayload.userId !== userId) {
        console.warn('[Socket] Invalid user:online payload userId mismatch', {
          socketUserId: userId,
          payloadUserId: presencePayload.userId,
        });
        return;
      }

      const status = normalizePresenceStatus(presencePayload.status);
      const previousStatus = await setAgentPresenceState(schemaName, userId, status);
      await refreshAgentPresence(schemaName, userId);
      await touchPresenceKey(tenantId, userId, status);

      if (previousStatus === null) return;
      if (previousStatus === status) return;
      if (status === 'paused') {
        socketServer.to(`tenant:${tenantId}`).emit('agent:paused', { userId });
        return;
      }
      if (previousStatus === 'paused') {
        socketServer.to(`tenant:${tenantId}`).emit('agent:resumed', { userId });
        return;
      }
      socketServer.to(`tenant:${tenantId}`).emit('agent:online', { userId });
    };

    if (schemaName) {
      void handlePresenceOnline().catch((err: unknown) => {
        console.error('[Socket] Connect handler error:', err);
      });
    }

    socket.on('user:online', (payload: unknown) => {
      if (!schemaName) return;
      void handlePresenceOnline(payload).catch((err: unknown) => {
        console.error('[Socket] user:online handler error:', err);
      });
    });

    socket.on('user:heartbeat', (payload: unknown) => {
      if (!schemaName) return;
      const heartbeatPayload = parsePresencePayload(payload);
      if (heartbeatPayload.userId && heartbeatPayload.userId !== userId) {
        console.warn('[Socket] Invalid user:heartbeat payload userId mismatch', {
          socketUserId: userId,
          payloadUserId: heartbeatPayload.userId,
        });
        return;
      }

      void refreshAgentPresence(schemaName, userId)
        .then(() => renewPresenceKey(tenantId, userId))
        .catch((err: unknown) => {
          console.error('[Socket] user:heartbeat handler error:', err);
        });
    });

    socket.on('agent:heartbeat', () => {
      if (!schemaName) return;
      void refreshAgentPresence(schemaName, userId)
        .then(() => renewPresenceKey(tenantId, userId))
        .catch((err: unknown) => {
          console.error('[Socket] Heartbeat handler error:', err);
        });
    });

    socket.on('conversation:join', (payload: unknown) => {
      const conversationId = parseTypingPayload(payload);
      if (!conversationId) return;
      void socket.join(`conversation:${conversationId}`);
    });

    socket.on('conversation:leave', (payload: unknown) => {
      const conversationId = parseTypingPayload(payload);
      if (!conversationId) return;
      void socket.leave(`conversation:${conversationId}`);
    });

    socket.on('disconnect', () => {
      setTimeout(() => {
        if (!schemaName) return;

        void (async () => {
          try {
            const room = `agent:${userId}`;
            const socketsInRoom = await socketServer.in(room).fetchSockets();
            const hasAnotherSocket = socketsInRoom.some((item) => item.id !== socket.id);
            if (hasAnotherSocket) return;

            await prisma.$executeRawUnsafe(
              `UPDATE ${quoteIdent(schemaName)}.agent_assignments
               SET status = 'offline',
                   is_available = false,
                   online_since = NULL
               WHERE user_id = $1::uuid`,
              userId,
            );

            await redis.del(presenceRedisKey(tenantId, userId));
            socketServer.to(`tenant:${tenantId}`).emit('agent:offline', { userId });
            console.log(`[Socket] Agent ${userId} went offline`);
          } catch (err) {
            console.error('[Socket] Disconnect handler error:', err);
          }
        })();
      }, DISCONNECT_GRACE_MS);
    });
  });

  return socketServer;
}

export function getSocketServer(): SocketServer {
  if (!io) throw new Error('Socket.io não inicializado');
  return io;
}
