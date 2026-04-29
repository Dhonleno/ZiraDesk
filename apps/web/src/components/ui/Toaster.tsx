import { useToastStore, type ToastType } from '../../stores/toast.store';

const typeStyles: Record<ToastType, { wrapper: string; icon: string }> = {
  success: {
    wrapper: 'border-[rgba(62,207,142,.25)] bg-bg-2 text-[#3ECF8E]',
    icon: '✓',
  },
  error: {
    wrapper: 'border-[rgba(248,113,113,.25)] bg-bg-2 text-[#F87171]',
    icon: '✕',
  },
  info: {
    wrapper: 'border-[rgba(96,165,250,.25)] bg-bg-2 text-[#60A5FA]',
    icon: 'ℹ',
  },
};

export function Toaster() {
  const { toasts, removeToast } = useToastStore();

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80">
      {toasts.map((toast) => {
        const { wrapper, icon } = typeStyles[toast.type];
        return (
          <div
            key={toast.id}
            className={[
              'flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm',
              'animate-in slide-in-from-right duration-200',
              wrapper,
            ].join(' ')}
          >
            <span className="mt-0.5 shrink-0 text-sm font-bold">{toast.icon ?? icon}</span>
            <p className="flex-1 text-sm text-txt">{toast.message}</p>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 text-txt-3 hover:text-txt-2 transition-opacity"
              aria-label="Fechar"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
