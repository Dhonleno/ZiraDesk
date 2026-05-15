import type { ReactNode } from 'react';

interface CrmSidebarHeaderProps {
  title: string;
  count?: number | null;
  subtitle?: string;
  action?: ReactNode;
}

export function CrmSidebarHeader({ title, count, subtitle, action }: CrmSidebarHeaderProps) {
  return (
    <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 18, color: 'var(--txt)', fontWeight: 600, letterSpacing: '-0.3px' }}>{title}</h1>
        {typeof count === 'number' ? (
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              color: 'var(--txt-3)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-pill)',
              padding: '2px 8px',
              background: 'var(--bg-3)',
            }}
          >
            {count}
          </span>
        ) : null}
        <div style={{ flex: 1 }} />
        {action}
      </div>
      {subtitle ? <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--txt-3)' }}>{subtitle}</p> : null}
    </div>
  );
}
