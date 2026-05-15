interface CrmSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  clearLabel?: string;
  onClear?: () => void;
}

export function CrmSearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  clearLabel,
  onClear,
}: CrmSearchFieldProps) {
  const canClear = Boolean(onClear && value.trim().length > 0);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '7px 10px' }}>
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ color: 'var(--txt-3)', flexShrink: 0 }} aria-hidden>
        <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" />
        <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--font)', color: 'var(--txt)', width: '100%' }}
        aria-label={ariaLabel ?? placeholder}
      />
      {canClear ? (
        <button
          type="button"
          onClick={onClear}
          style={{
            height: 22,
            borderRadius: 'var(--r)',
            border: '1px solid var(--line-2)',
            background: 'var(--bg-4)',
            color: 'var(--txt-3)',
            cursor: 'pointer',
            fontSize: 10,
            fontWeight: 600,
            padding: '0 7px',
            fontFamily: 'var(--font)',
            whiteSpace: 'nowrap',
          }}
        >
          {clearLabel}
        </button>
      ) : null}
    </div>
  );
}
