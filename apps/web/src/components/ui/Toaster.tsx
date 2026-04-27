import { useToastStore, type ToastType } from '../../stores/toast.store';

const typeClasses: Record<ToastType, string> = {
  success: 'border-emerald-700 bg-emerald-950/80 text-emerald-300',
  error: 'border-red-700 bg-red-950/80 text-red-300',
  info: 'border-blue-700 bg-blue-950/80 text-blue-300',
};

const icons: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
};

export function Toaster() {
  const { toasts, removeToast } = useToastStore();

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={[
            'flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm',
            'animate-in slide-in-from-right duration-200',
            typeClasses[toast.type],
          ].join(' ')}
        >
          <span className="mt-0.5 shrink-0 text-sm font-bold">{icons[toast.type]}</span>
          <p className="flex-1 text-sm">{toast.message}</p>
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
