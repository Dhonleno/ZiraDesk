import { useToastStore, type ToastType } from '../../stores/toast.store';

const typeStyles: Record<Exclude<ToastType, 'help_request'>, { wrapper: string; icon: string }> = {
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
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
      style={{ width: 'min(92vw, 420px)' }}
    >
      {toasts.map((toast) => {
        if (toast.type === 'help_request') {
          return (
            <div key={toast.id} className="help-toast">
              <div className="help-toast-icon">🆘</div>
              <div className="help-toast-content">
                <strong>{toast.message}</strong>
                {toast.protocol ? <span title={`Protocolo ${toast.protocol}`}>Protocolo {toast.protocol}</span> : null}
              </div>
              <div className="help-toast-actions">
                <button
                  className="tb-icon-btn"
                  style={{
                    width: 'auto',
                    height: 28,
                    border: '1px solid var(--teal)',
                    background: 'var(--teal)',
                    color: '#0E1A18',
                    borderRadius: 'var(--r)',
                    padding: '0 8px',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                  onClick={() => {
                    toast.onAccept?.();
                    removeToast(toast.id);
                  }}
                >
                  Ajudar
                </button>
                <button
                  className="tb-icon-btn"
                  style={{
                    width: 'auto',
                    height: 28,
                    border: '1px solid var(--line-2)',
                    background: 'var(--bg-4)',
                    color: 'var(--txt-2)',
                    borderRadius: 'var(--r)',
                    padding: '0 8px',
                    fontSize: 11,
                  }}
                  onClick={() => {
                    toast.onDecline?.();
                    removeToast(toast.id);
                  }}
                >
                  Recusar
                </button>
              </div>
            </div>
          );
        }

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
            <div className="flex-1">
              <p className="text-sm text-txt">{toast.message}</p>
              {toast.linkHref && toast.linkLabel ? (
                <a
                  href={toast.linkHref}
                  className="mt-1 inline-block text-xs font-medium text-teal hover:opacity-80"
                >
                  {toast.linkLabel}
                </a>
              ) : null}
            </div>
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
