import type { CSSProperties, ReactNode } from 'react';

interface PageShellProps {
  children: ReactNode;
  padding?: number | string;
  contentStyle?: CSSProperties;
}

const ROOT_STYLE: CSSProperties = {
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

export function PageShell({ children, padding = 24, contentStyle }: PageShellProps) {
  return (
    <div style={ROOT_STYLE}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding, ...contentStyle }}>
        {children}
      </div>
    </div>
  );
}
