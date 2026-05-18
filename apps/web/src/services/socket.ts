import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/auth.store';

let socket: Socket | null = null;
let heartbeatInterval: number | null = null;
let currentPresenceStatus = 'online';
let visibilityListenerAttached = false;
const pendingHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
const HEARTBEAT_INTERVAL_MS = 25_000;

interface PresencePayload {
  userId: string;
  status: string;
}

interface HeartbeatPayload {
  userId: string;
}

function getCurrentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

function getPresencePayload(): PresencePayload | null {
  const userId = getCurrentUserId();
  if (!userId) return null;
  return {
    userId,
    status: currentPresenceStatus,
  };
}

function emitPresenceOnline(): void {
  if (!socket || !socket.connected) return;
  const payload = getPresencePayload();
  if (!payload) return;
  socket.emit('user:online', payload);
}

function emitHeartbeat(): void {
  if (!socket || !socket.connected) return;
  const userId = getCurrentUserId();
  if (!userId) return;

  const payload: HeartbeatPayload = { userId };
  socket.emit('user:heartbeat', payload);
  socket.emit('agent:heartbeat');
}

function startHeartbeat(): void {
  if (heartbeatInterval !== null) return;

  heartbeatInterval = window.setInterval(() => {
    emitHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatInterval === null) return;
  window.clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible' || !socket) return;

  if (!socket.connected) {
    socket.connect();
    return;
  }

  emitPresenceOnline();
}

function attachVisibilityListener(): void {
  if (visibilityListenerAttached) return;
  document.addEventListener('visibilitychange', onVisibilityChange);
  visibilityListenerAttached = true;
}

function detachVisibilityListener(): void {
  if (!visibilityListenerAttached) return;
  document.removeEventListener('visibilitychange', onVisibilityChange);
  visibilityListenerAttached = false;
}

function attachLifecycleHandlers(): void {
  if (!socket) return;

  socket.on('connect', () => {
    emitPresenceOnline();
    startHeartbeat();
  });

  socket.on('disconnect', (reason) => {
    stopHeartbeat();
    if (import.meta.env.DEV) {
      console.warn('[Socket] disconnected:', reason);
    }
  });

  socket.io.on('reconnect', (attemptNumber) => {
    void attemptNumber;
    emitPresenceOnline();
    startHeartbeat();
  });

  socket.io.on('reconnect_failed', () => {
    console.error('[Socket] reconnection failed — showing offline warning');
  });
}

export function connectSocket(token: string, tenantId: string): void {
  if (socket) {
    socket.auth = { token, tenantId };
    if (!socket.connected) socket.connect();
    emitPresenceOnline();
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

  attachLifecycleHandlers();
  attachVisibilityListener();

  for (const { event, handler } of pendingHandlers) {
    socket.on(event, handler);
  }
}

export function disconnectSocket(): void {
  stopHeartbeat();
  detachVisibilityListener();
  socket?.disconnect();
  socket = null;
  pendingHandlers.length = 0;
}

export function setPresenceStatus(status: string | null | undefined): void {
  if (!status || !status.trim()) {
    currentPresenceStatus = 'online';
  } else {
    currentPresenceStatus = status.trim().toLowerCase();
  }

  emitPresenceOnline();
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
