import { CrmSelectionCheckbox } from './CrmSelectionCheckbox';

interface CrmBulkSelectionBarProps {
  visibleCount: number;
  selectedCount: number;
  allSelected: boolean;
  selectAllLabel: string;
  selectedLabel: string;
  clearLabel: string;
  deleteLabel: string;
  selectAllMatchingLabel?: string;
  showSelectAllMatching?: boolean;
  onToggleAll: () => void;
  onSelectAllMatching?: () => void;
  onClear: () => void;
  onDelete: () => void;
}

export function CrmBulkSelectionBar({
  visibleCount,
  selectedCount,
  allSelected,
  selectAllLabel,
  selectedLabel,
  clearLabel,
  deleteLabel,
  selectAllMatchingLabel,
  showSelectAllMatching = false,
  onToggleAll,
  onSelectAllMatching,
  onClear,
  onDelete,
}: CrmBulkSelectionBarProps) {
  if (visibleCount === 0) return null;

  return (
    <div
      style={{
        minHeight: 38,
        padding: '6px 12px',
        borderBottom: '1px solid var(--line)',
        background: selectedCount > 0 ? 'var(--teal-dim)' : 'var(--bg-2)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          minWidth: 0,
          color: selectedCount > 0 ? 'var(--teal)' : 'var(--txt-2)',
          fontSize: 11,
          cursor: 'pointer',
          flex: 1,
        }}
      >
        <CrmSelectionCheckbox
          checked={allSelected}
          indeterminate={selectedCount > 0 && !allSelected}
          label={selectAllLabel}
          onChange={onToggleAll}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedCount > 0 ? selectedLabel : selectAllLabel}
        </span>
      </label>

      {selectedCount > 0 ? (
        <>
          <button type="button" className="tb-btn" onClick={onClear}>
            {clearLabel}
          </button>
          <button
            type="button"
            className="tb-btn danger"
            onClick={onDelete}
          >
            {deleteLabel}
          </button>
        </>
      ) : null}

      {showSelectAllMatching && selectAllMatchingLabel && onSelectAllMatching ? (
        <button
          type="button"
          onClick={onSelectAllMatching}
          style={{
            width: '100%',
            border: '1px dashed var(--teal)',
            borderRadius: 'var(--r)',
            background: 'var(--teal-dim)',
            color: 'var(--teal)',
            fontFamily: 'var(--font)',
            fontSize: 11,
            fontWeight: 600,
            padding: '6px 10px',
            cursor: 'pointer',
          }}
        >
          {selectAllMatchingLabel}
        </button>
      ) : null}
    </div>
  );
}
