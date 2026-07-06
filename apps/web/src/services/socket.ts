import { io, type Socket } from 'socket.io-client';
import i18n from '../lib/i18n';
import { queryClient } from '../lib/queryClient';
import { useAuthStore } from '../stores/auth.store';
import { useToastStore } from '../stores/toast.store';

let socket: Socket | null = null;
let heartbeatInterval: number | null = null;
let currentPresenceStatus = 'online';
let lifecycleListenersAttached = false;
const pendingHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
const HEARTBEAT_INTERVAL_MS = 25_000;

interface PresencePayload {
  userId: string;
  status: string;
}

interface HeartbeatPayload {
  userId: string;
}

function invalidateConversationQueries(): void {
  void queryClient.invalidateQueries({ queryKey: ['conversations'] });
  void queryClient.invalidateQueries({ queryKey: ['conversation-counts'] });
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

  emitHeartbeat();
  heartbeatInterval = window.setInterval(() => {
    emitHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatInterval === null) return;
  window.clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

function syncPresenceAfterForegroundResume(): void {
  if (!socket) return;
  if (document.visibilityState !== 'visible') return;

  if (!socket.connected) {
    socket.connect();
    return;
  }

  emitPresenceOnline();
  startHeartbeat();
  invalidateConversationQueries();
  // Alguns navegadores retomam timers/socket com atraso ao restaurar janela minimizada.
  // Reforçamos o anúncio de presença em seguida para evitar exigir refresh manual.
  window.setTimeout(() => {
    emitPresenceOnline();
    emitHeartbeat();
  }, 800);
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    // Para o heartbeat quando minimizado: browsers throttleiam timers em background.
    stopHeartbeat();
    return;
  }

  syncPresenceAfterForegroundResume();
}

function onWindowFocus(): void {
  // Fallback para janelas minimizadas onde visibilitychange pode não disparar consistentemente.
  if (document.visibilityState !== 'visible') return;

  syncPresenceAfterForegroundResume();
}

function onWindowBlur(): void {
  // Para o heartbeat quando a janela perde foco completamente.
  stopHeartbeat();
}

function onPageShow(): void {
  syncPresenceAfterForegroundResume();
}

function onNetworkOnline(): void {
  syncPresenceAfterForegroundResume();
}

function attachLifecycleListeners(): void {
  if (lifecycleListenersAttached) return;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('online', onNetworkOnline);
  lifecycleListenersAttached = true;
}

function detachLifecycleListeners(): void {
  if (!lifecycleListenersAttached) return;
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('focus', onWindowFocus);
  window.removeEventListener('blur', onWindowBlur);
  window.removeEventListener('pageshow', onPageShow);
  window.removeEventListener('online', onNetworkOnline);
  lifecycleListenersAttached = false;
}

function attachLifecycleHandlers(): void {
  if (!socket) return;

  socket.on('connect', () => {
    emitPresenceOnline();
    startHeartbeat();
    invalidateConversationQueries();
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
    invalidateConversationQueries();
  });

  socket.io.on('reconnect_failed', () => {
    console.error('[Socket] reconnection failed — showing offline warning');
  });

  socket.on('auth:force_logout', () => {
    useAuthStore.getState().logout();
    useToastStore.getState().addToast({
      type: 'warning',
      message: i18n.t('session.forcedLogout', { ns: 'auth' }),
      durationMs: 6000,
    });

    window.setTimeout(() => {
      window.location.href = '/login';
    }, 2000);
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
  attachLifecycleListeners();

  for (const { event, handler } of pendingHandlers) {
    socket.on(event, handler);
  }
}

export function disconnectSocket(): void {
  stopHeartbeat();
  detachLifecycleListeners();
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
