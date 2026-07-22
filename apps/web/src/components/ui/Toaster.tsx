import { useTranslation } from 'react-i18next';
import { useToastStore, type ToastType } from '../../stores/toast.store';

const svgIconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const typeIcons: Record<Exclude<ToastType, 'help_request'>, JSX.Element> = {
  success: (
    <svg {...svgIconProps}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  error: (
    <svg {...svgIconProps}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  warning: (
    <svg {...svgIconProps}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg {...svgIconProps}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

export function Toaster() {
  const { t } = useTranslation('common');
  const { toasts, removeToast } = useToastStore();

  return (
    <div className="zd-toast-container">
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
                  {t('help')}
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
                  {t('dismiss')}
                </button>
              </div>
            </div>
          );
        }

        return (
          <div key={toast.id} className={`zd-toast zd-toast--${toast.type}`}>
            <div className="zd-toast-icon">
              {toast.icon ?? typeIcons[toast.type]}
            </div>
            <div className="zd-toast-content">
              <span className="zd-toast-message">{toast.message}</span>
              {toast.linkHref && toast.linkLabel ? (
                <a href={toast.linkHref} className="zd-toast-link">
                  {toast.linkLabel}
                </a>
              ) : null}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="zd-toast-close"
              aria-label={t('close')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
