import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { conversationTags } from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface TagDropdownProps {
  conversationId: string;
  onClose: () => void;
}

export function TagDropdown({ conversationId, onClose }: TagDropdownProps) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const qc = useQueryClient();
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const { data: allTags = [] } = useQuery({
    queryKey: ['conversation-tags'],
    queryFn: () => conversationTags.listAvailable(),
  });

  const {
    data: convTags = [],
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['conversation-tags', conversationId],
    queryFn: () => conversationTags.getForConversation(conversationId),
    enabled: Boolean(conversationId),
  });

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [onClose]);

  const appliedTagIds = useMemo(() => new Set(convTags.map((tag) => tag.id)), [convTags]);

  async function handleToggleTag(tagId: string) {
    try {
      if (appliedTagIds.has(tagId)) {
        await conversationTags.removeFromConversation(conversationId, tagId);
        toast.success(t('tenantAdmin.tags.messages.removed'));
      } else {
        await conversationTags.addToConversation(conversationId, tagId);
        toast.success(t('tenantAdmin.tags.messages.added'));
      }
      await refetch();
      await qc.invalidateQueries({ queryKey: ['conversations'] });
      await qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      await qc.invalidateQueries({ queryKey: ['conversation-tags', conversationId] });
    } catch {
      toast.error(t('tenantAdmin.common.errorSave'));
    }
  }

  return (
    <div className="tag-dropdown" ref={dropdownRef}>
      <div className="tag-dropdown-header">
        <span>{t('tenantAdmin.tags.title')}</span>
        <button type="button" onClick={onClose} aria-label={t('tenantAdmin.common.close')}>
          ×
        </button>
      </div>

      <div className="tag-dropdown-list">
        {allTags.map((tag) => {
          const isApplied = appliedTagIds.has(tag.id);
          return (
            <button
              type="button"
              key={tag.id}
              className={`tag-option ${isApplied ? 'applied' : ''}`}
              onClick={() => void handleToggleTag(tag.id)}
              disabled={isFetching}
            >
              <span className="tag-dot" style={{ background: tag.color }} />
              <span className="tag-name">{tag.name}</span>
              {isApplied && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
