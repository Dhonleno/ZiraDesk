import type { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { quoteIdent } from '../modules/omnichannel/conversations/protocols.js';

let io: SocketServer | null = null;

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
      void prisma.$executeRawUnsafe(
        `UPDATE ${quoteIdent(schemaName)}.agent_assignments
         SET status = 'online',
             is_available = true
         WHERE user_id = $1::uuid
           AND status = 'offline'`,
        userId,
      ).then((updatedCount) => {
        if (Number(updatedCount) > 0) {
          socketServer.to(`tenant:${tenantId}`).emit('agent:online', { userId });
        }
      }).catch((err: unknown) => {
        console.error('[Socket] Connect handler error:', err);
      });
    }

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
