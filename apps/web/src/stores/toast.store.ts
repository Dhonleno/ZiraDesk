import { create } from 'zustand';
import { useCallback, useMemo } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'help_request';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  icon?: string;
  protocol?: string | null;
  agentName?: string;
  persistent?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  durationMs?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).slice(2, 9);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));

    if (!toast.persistent) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, toast.durationMs ?? 4000);
    }
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export function useToast() {
  const { addToast } = useToastStore();
  const success = useCallback((message: string, options?: { icon?: string }) => addToast({ message, type: 'success', ...options }), [addToast]);
  const error = useCallback((message: string, options?: { icon?: string }) => addToast({ message, type: 'error', ...options }), [addToast]);
  const info = useCallback((message: string, options?: { icon?: string }) => addToast({ message, type: 'info', ...options }), [addToast]);
  const helpRequest = useCallback((options: {
    message: string;
    protocol?: string | null;
    agentName?: string;
    onAccept: () => void;
    onDecline: () => void;
  }) => {
    const payload: Omit<Toast, 'id'> = {
      message: options.message,
      type: 'help_request',
      icon: '🆘',
      onAccept: options.onAccept,
      onDecline: options.onDecline,
      persistent: true,
    };
    if (options.protocol !== undefined) payload.protocol = options.protocol;
    if (options.agentName !== undefined) payload.agentName = options.agentName;
    addToast(payload);
  }, [addToast]);

  return useMemo(
    () => ({
      success,
      error,
      info,
      helpRequest,
    }),
    [error, helpRequest, info, success],
  );
}
