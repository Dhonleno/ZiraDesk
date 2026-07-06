import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContactTag } from '../../services/api';

interface ContactTagPickerProps {
  tags: ContactTag[];
  selectedTagIds: string[];
  disabled?: boolean;
  onSelect: (tag: ContactTag) => void;
  onClose: () => void;
}

export function ContactTagPicker({
  tags,
  selectedTagIds,
  disabled = false,
  onSelect,
  onClose,
}: ContactTagPickerProps) {
  const { t } = useTranslation('crm');
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const selectedIds = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);
  const availableTags = useMemo(
    () => tags.filter((tag) => !selectedIds.has(tag.id)),
    [selectedIds, tags],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [onClose]);

  return (
    <div className="tag-dropdown" ref={pickerRef}>
      <div className="tag-dropdown-header">
        <span>{t('contacts.tagsSection.picker.title')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('contacts.tagsSection.picker.close')}
        >
          ×
        </button>
      </div>

      <div className="tag-dropdown-list">
        {availableTags.length === 0 ? (
          <div
            style={{
              padding: '12px 10px',
              color: 'var(--txt-3)',
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            {t('contacts.tagsSection.picker.empty')}
          </div>
        ) : (
          availableTags.map((tag) => (
            <button
              type="button"
              key={tag.id}
              className="tag-option"
              onClick={() => onSelect(tag)}
              disabled={disabled}
            >
              <span className="tag-dot" style={{ background: tag.color }} />
              <span className="tag-name">{tag.name}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
