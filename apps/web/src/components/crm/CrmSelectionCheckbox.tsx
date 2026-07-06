interface CrmSelectionCheckboxProps {
  checked: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: () => void;
}

export function CrmSelectionCheckbox({
  checked,
  disabled = false,
  indeterminate = false,
  label,
  onChange,
}: CrmSelectionCheckboxProps) {
  const active = checked || indeterminate;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      className={`crm-selection-checkbox${active ? ' is-active' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onChange();
      }}
    >
      <span className="crm-selection-checkbox-box" aria-hidden>
        {indeterminate ? (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 4h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : checked ? (
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1.5 4.6 3.6 6.5 7.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
    </button>
  );
}
