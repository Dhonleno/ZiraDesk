import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket(token: string, tenantId: string): void {
  if (socket?.connected) return;

  socket = io('/', {
    path: '/socket.io',
    auth: { token, tenantId },
    transports: ['websocket'],
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}

export function subscribeToEvent<T>(
  event: string,
  handler: (data: T) => void,
): () => void {
  socket?.on(event, handler);
  return () => {
    socket?.off(event, handler);
  };
}
