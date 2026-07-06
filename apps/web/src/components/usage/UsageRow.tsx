import { useTranslation } from 'react-i18next';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function pct(used: number, limit: number): number {
  if (limit === -1) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function barColor(p: number): string {
  if (p >= 90) return 'var(--red)';
  if (p >= 75) return 'var(--amber)';
  return 'var(--teal)';
}

interface UsageRowProps {
  label: string;
  used: number;
  limit: number;
  format?: (n: number) => string;
  unlimitedLabel?: string;
  ofLabel?: string;
}

export function UsageRow({ label, used, limit, format, unlimitedLabel, ofLabel }: UsageRowProps) {
  const { t } = useTranslation('admin');
  const fmt = format ?? ((n: number) => n.toLocaleString('pt-BR'));
  const p = pct(used, limit);
  const color = barColor(p);
  const isUnlimited = limit === -1;
  const unlimited = unlimitedLabel ?? t('usage.unlimited');
  const of = ofLabel ?? t('usage.of');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--txt)' }}>
          {isUnlimited ? `${fmt(used)} · ${unlimited}` : `${fmt(used)} ${of} ${fmt(limit)}`}
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 'var(--r-pill)',
          background: 'var(--bg-4)',
          overflow: 'hidden',
        }}
      >
        {!isUnlimited && (
          <div
            style={{
              height: '100%',
              width: `${p}%`,
              background: color,
              borderRadius: 'var(--r-pill)',
              transition: 'width .4s ease',
            }}
          />
        )}
        {isUnlimited && (
          <div
            style={{
              height: '100%',
              width: '100%',
              background: 'var(--teal)',
              opacity: 0.25,
              borderRadius: 'var(--r-pill)',
            }}
          />
        )}
      </div>
    </div>
  );
}
