import { useTranslation } from 'react-i18next';

export function PortalEmptyDetail() {
  const { t } = useTranslation('portal');

  return (
    <div className="portal-empty-state">
      <div className="portal-empty-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M9 12h6M9 16h4M6 4h9l3 3v13H6V4Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="portal-empty-title">{t('tickets.detail.emptyTitle')}</p>
      <p className="portal-empty-subtitle">{t('tickets.detail.emptySub')}</p>
    </div>
  );
}
