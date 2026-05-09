import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
let heartbeatInterval: number | null = null;
const pendingHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
const HEARTBEAT_INTERVAL_MS = 30_000;

function startHeartbeat(): void {
  if (heartbeatInterval !== null) return;

  heartbeatInterval = window.setInterval(() => {
    if (!socket || !socket.connected) return;
    socket.emit('agent:heartbeat');
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatInterval === null) return;
  window.clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

export function connectSocket(token: string, tenantId: string): void {
  if (socket) {
    if (!socket.connected) socket.connect();
    startHeartbeat();
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

  startHeartbeat();
}

export function disconnectSocket(): void {
  stopHeartbeat();
  socket?.disconnect();
  socket = null;
  pendingHandlers.length = 0;
}

export function getSocket(): Socket | null {
  return socket;
}

export function emitSocketEvent<TPayload>(event: string, payload: TPayload): void {
  if (!socket || !socket.connected) return;
  socket.emit(event, payload);
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
