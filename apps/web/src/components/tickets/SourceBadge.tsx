import { useTranslation } from 'react-i18next';

const SOURCE_META = {
  manual: { icon: '✏️', color: 'var(--txt-3)' },
  portal: { icon: '🌐', color: 'var(--blue)' },
  email: { icon: '📧', color: 'var(--purple)' },
  whatsapp: { icon: '📱', color: 'var(--green)' },
  api: { icon: '🔗', color: 'var(--amber)' },
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
      {item.icon} {label}
    </span>
  );
}
