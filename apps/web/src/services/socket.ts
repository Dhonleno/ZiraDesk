import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
const pendingHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

export function connectSocket(token: string, tenantId: string): void {
  if (socket) {
    if (!socket.connected) socket.connect();
    return;
  }

  const isDev = import.meta.env.DEV;

  socket = io('/', {
    path: '/socket.io',
    auth: { token, tenantId },
    transports: isDev ? ['polling'] : ['polling', 'websocket'],
    upgrade: !isDev,
    reconnectionAttempts: 20,
    reconnectionDelay: 2000,
  });

  for (const { event, handler } of pendingHandlers) {
    socket.on(event, handler);
  }
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  pendingHandlers.length = 0;
}

export function getSocket(): Socket | null {
  return socket;
}

export function subscribeToEvent<T>(
  event: string,
  handler: (data: T) => void,
): () => void {
  const wrapped = handler as (...args: unknown[]) => void;

  if (socket) {
    socket.on(event, wrapped);
  } else {
    pendingHandlers.push({ event, handler: wrapped });
  }

  return () => {
    socket?.off(event, wrapped);
    const idx = pendingHandlers.findIndex(p => p.event === event && p.handler === wrapped);
    if (idx >= 0) pendingHandlers.splice(idx, 1);
  };
}
