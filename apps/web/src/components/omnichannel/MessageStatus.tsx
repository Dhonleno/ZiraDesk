type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

interface Props {
  status: MessageDeliveryStatus;
}

function baseIconStyle(color: string) {
  return {
    width: 14,
    height: 14,
    color,
    display: 'inline-block',
    flexShrink: 0,
  } as const;
}

export function MessageStatus({ status }: Props) {
  if (status === 'failed') {
    return (
      <span title="Falha no envio" style={baseIconStyle('#EF4444')}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  if (status === 'pending') {
    return (
      <span title="Enviando..." style={baseIconStyle('var(--txt-2)')}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7 4.8V7.2L8.8 8.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  if (status === 'sent') {
    return (
      <span title="Enviada" style={baseIconStyle('var(--txt-2)')}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M3.3 7.3l2.2 2.2 5.2-5.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  if (status === 'read') {
    return (
      <span title="Lida" style={baseIconStyle('var(--teal)')}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M1.8 7.3l2 2 4.2-4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.7 7.3l2 2 4.5-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  return (
    <span title="Entregue" style={baseIconStyle('var(--txt-2)')}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M1.8 7.3l2 2 4.2-4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.7 7.3l2 2 4.5-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
