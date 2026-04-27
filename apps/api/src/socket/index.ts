import type { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
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

  io.on('connection', (socket) => {
    const tenantId = socket.handshake.auth['tenantId'] as string | undefined;

    if (tenantId) {
      // Isola eventos por tenant via rooms
      void socket.join(`tenant:${tenantId}`);
    }

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
