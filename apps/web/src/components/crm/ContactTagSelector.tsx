import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContactTag } from '../../services/api';
import { ContactTagPicker } from './ContactTagPicker';

interface ContactTagSelectorProps {
  tags: ContactTag[];
  selectedTagIds: string[];
  loading?: boolean;
  error?: boolean;
  disabled?: boolean;
  onChange: (tagIds: string[]) => void;
}

export function ContactTagSelector({
  tags,
  selectedTagIds,
  loading = false,
  error = false,
  disabled = false,
  onChange,
}: ContactTagSelectorProps) {
  const { t } = useTranslation(['crm', 'common']);
  const [pickerOpen, setPickerOpen] = useState(false);
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const selectedTags = selectedTagIds
    .map((tagId) => tagsById.get(tagId))
    .filter((tag): tag is ContactTag => Boolean(tag));

  function addTag(tag: ContactTag) {
    onChange([...selectedTagIds, tag.id]);
  }

  function removeTag(tagId: string) {
    onChange(selectedTagIds.filter((selectedTagId) => selectedTagId !== tagId));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
        {t('contacts.fields.tags')}
      </label>

      <div style={{ position: 'relative' }}>
        {selectedTags.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {selectedTags.map((tag) => (
              <span
                key={tag.id}
                className="tag-pill"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: `${tag.color}26`,
                  color: tag.color,
                  border: `1px solid ${tag.color}40`,
                  fontSize: 11,
                }}
              >
                {tag.name}
                <button
                  type="button"
                  onClick={() => removeTag(tag.id)}
                  disabled={disabled}
                  aria-label={t('contacts.tagsSection.remove', { name: tag.name })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    color: 'inherit',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    lineHeight: 1,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path
                      d="M7.5 2.5l-5 5M2.5 2.5l5 5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ marginBottom: 8, color: 'var(--txt-3)', fontSize: 12 }}>
            {loading
              ? t('loading', { ns: 'common' })
              : error
                ? t('contacts.tagsSection.picker.error')
                : t('contacts.tagsSection.empty')}
          </div>
        )}

        <button
          type="button"
          className="tb-btn"
          onClick={() => setPickerOpen((open) => !open)}
          disabled={disabled || loading || error}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          {t('contacts.tagsSection.add')}
        </button>

        {pickerOpen && (
          <ContactTagPicker
            tags={tags}
            selectedTagIds={selectedTagIds}
            disabled={disabled}
            onSelect={addTag}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
