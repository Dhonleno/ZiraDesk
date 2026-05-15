interface CrmFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface CrmActiveFilterChipsProps {
  filters: CrmFilterChip[];
  removeLabel: string;
  clearAllLabel: string;
  onClearAll: () => void;
}

export function CrmActiveFilterChips({
  filters,
  removeLabel,
  clearAllLabel,
  onClearAll,
}: CrmActiveFilterChipsProps) {
  if (filters.length === 0) return null;

  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
      {filters.map((filter) => (
        <span
          key={filter.key}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: 230,
            padding: '4px 8px',
            borderRadius: 'var(--r-pill)',
            border: '1px solid rgba(0, 201, 167, 0.28)',
            background: 'var(--teal-dim)',
            color: 'var(--teal)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.01em',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filter.label}</span>
          <button
            type="button"
            onClick={filter.onRemove}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 11,
              lineHeight: 1,
              padding: 0,
            }}
            aria-label={removeLabel}
            title={removeLabel}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        style={{
          marginLeft: 'auto',
          height: 24,
          borderRadius: 'var(--r)',
          border: '1px solid var(--line-2)',
          background: 'var(--bg-3)',
          color: 'var(--txt-2)',
          cursor: 'pointer',
          fontSize: 10,
          fontWeight: 600,
          padding: '0 8px',
          fontFamily: 'var(--font)',
          whiteSpace: 'nowrap',
        }}
      >
        {clearAllLabel}
      </button>
    </div>
  );
}
