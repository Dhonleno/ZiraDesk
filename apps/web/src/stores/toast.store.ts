import { create } from 'zustand';
import { useCallback, useMemo } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  icon?: string;
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
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export function useToast() {
  const { addToast } = useToastStore();
  const success = useCallback((message: string, options?: { icon?: string }) => addToast({ message, type: 'success', ...options }), [addToast]);
  const error = useCallback((message: string, options?: { icon?: string }) => addToast({ message, type: 'error', ...options }), [addToast]);
  const info = useCallback((message: string, options?: { icon?: string }) => addToast({ message, type: 'info', ...options }), [addToast]);

  return useMemo(
    () => ({
      success,
      error,
      info,
    }),
    [error, info, success],
  );
}
