import type { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

let io: SocketServer | null = null;

export function createSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.APP_URL,
      credentials: true,
    },
    path: '/socket.io',
  });

  // Valida JWT antes de aceitar a conexão
  io.use((socket, next) => {
    const token = socket.handshake.auth['token'] as string | undefined;
    if (!token) return next(new Error('Unauthorized'));

    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as {
        sub: string;
        tenantId?: string;
        isSuperAdmin: boolean;
      };

      if (!payload.tenantId) return next(new Error('Unauthorized'));

      socket.data.tenantId = payload.tenantId;
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const tenantId = socket.data.tenantId as string;
    const userId = socket.data.userId as string;
    void socket.join(`tenant:${tenantId}`);
    void socket.join(`agent:${userId}`);

    socket.on('disconnect', () => {
      // cleanup se necessário
    });
  });

  return io;
}

export function getSocketServer(): SocketServer {
  if (!io) throw new Error('Socket.io não inicializado');
  return io;
}
