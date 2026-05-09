import type { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';

let io: SocketServer | null = null;
let hasPublicUsersTable: boolean | null = null;

interface TypingPayload {
  conversationId?: string;
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

export function createSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.APP_URL,
      credentials: true,
    },
    path: '/socket.io',
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

    if (schemaName) {
      void prisma.$queryRawUnsafe<Array<{ became_online: boolean }>>(
        `WITH previous AS (
           SELECT status
           FROM ${quoteIdent(schemaName)}.agent_assignments
           WHERE user_id = $1::uuid
         ),
         updated AS (
           UPDATE ${quoteIdent(schemaName)}.agent_assignments
           SET status = 'online',
               is_available = true,
               last_seen_at = NOW(),
               updated_at = NOW()
           WHERE user_id = $1::uuid
           RETURNING 1
         )
         SELECT
           EXISTS (SELECT 1 FROM previous WHERE status = 'offline')
           AND EXISTS (SELECT 1 FROM updated) AS became_online`,
        userId,
      ).then((rows) => {
        const becameOnline = rows[0]?.became_online === true;
        if (becameOnline) {
          socketServer.to(`tenant:${tenantId}`).emit('agent:online', { userId });
        }
      }).catch((err: unknown) => {
        console.error('[Socket] Connect handler error:', err);
      });

      void refreshAgentPresence(schemaName, userId).catch((err: unknown) => {
        console.error('[Socket] Presence refresh on connect failed:', err);
      });
    }

    socket.on('agent:heartbeat', () => {
      if (!schemaName) return;
      void refreshAgentPresence(schemaName, userId).catch((err: unknown) => {
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

    socket.on('disconnect', async () => {
      try {
        if (!schemaName) return;

        const room = `agent:${userId}`;
        const socketsInRoom = await socketServer.in(room).fetchSockets();
        const hasAnotherSocket = socketsInRoom.some((item) => item.id !== socket.id);
        if (hasAnotherSocket) return;

        await prisma.$executeRawUnsafe(
          `UPDATE ${quoteIdent(schemaName)}.agent_assignments
           SET status = 'offline',
               is_available = false
           WHERE user_id = $1::uuid`,
          userId,
        );

        socketServer.to(`tenant:${tenantId}`).emit('agent:offline', { userId });
        console.log(`[Socket] Agent ${userId} went offline`);
      } catch (err) {
        console.error('[Socket] Disconnect handler error:', err);
      }
    });
  });

  return socketServer;
}

export function getSocketServer(): SocketServer {
  if (!io) throw new Error('Socket.io não inicializado');
  return io;
}
