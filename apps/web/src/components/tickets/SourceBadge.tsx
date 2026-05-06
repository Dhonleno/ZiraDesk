import { useTranslation } from 'react-i18next';

const SOURCE_META = {
  manual: { color: 'var(--txt-3)' },
  portal: { color: 'var(--teal)' },
  email: { color: 'var(--amber)' },
  whatsapp: { color: 'var(--green)' },
  api: { color: 'var(--red)' },
} as const;

type SourceKey = keyof typeof SOURCE_META;

export function SourceBadge({ source }: { source: string }) {
  const { t } = useTranslation('tickets');
  const key = (source as SourceKey) in SOURCE_META ? (source as SourceKey) : 'manual';
  const item = SOURCE_META[key];
  const label = t(`tickets.source.${key}`);

  return (
    <span
      className="source-badge"
      style={{ color: item.color }}
      title={`Origem: ${label}`}
    >
      {key === 'manual' ? (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path d="M8 1.5L9.5 3 3.5 9H2V7.5L8 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
      {key === 'portal' ? (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3 5.5c0-1.4.5-2.5 2.5-2.5S8 4.1 8 5.5s-.5 2.5-2.5 2.5S3 6.9 3 5.5z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1 5.5h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ) : null}
      {key === 'email' ? (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <rect x="1" y="2.5" width="9" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1 4l4.5 3L10 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ) : null}
      {key === 'whatsapp' ? (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path d="M5.5 1a4.5 4.5 0 014.2 6.1L10 10l-3-.7A4.5 4.5 0 115.5 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      ) : null}
      {key === 'api' ? (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path d="M3 3.5h5M3 7.5h5M5 2l-2 1.5v4L5 9m1-7 2 1.5v4L6 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
      {label}
    </span>
  );
}
