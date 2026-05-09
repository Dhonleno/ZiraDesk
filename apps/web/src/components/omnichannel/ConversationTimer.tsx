import { useEffect, useState } from 'react';

interface Props {
  assignedAt: string;
}

function elapsed(from: Date): string {
  const secs = Math.max(0, Math.floor((Date.now() - from.getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function ConversationTimer({ assignedAt }: Props) {
  const from = new Date(assignedAt);
  const [display, setDisplay] = useState(() => elapsed(from));

  useEffect(() => {
    setDisplay(elapsed(from));
    const id = window.setInterval(() => setDisplay(elapsed(from)), 1000);
    return () => window.clearInterval(id);
  }, [assignedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span
      style={{
        fontFamily: "'IBM Plex Mono', var(--mono, monospace)",
        fontSize: 12,
        color: 'var(--txt-2)',
        letterSpacing: '0.03em',
      }}
    >
      {display}
    </span>
  );
}
