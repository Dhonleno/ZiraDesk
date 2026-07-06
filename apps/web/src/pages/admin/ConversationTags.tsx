import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  contactTags,
  conversationTags,
  type ContactTag,
  type ConversationTag,
} from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { PageShell } from '../../components/layout/PageShell';

const PRESET_COLORS = [
  '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#00C9A7', '#F97316',
  '#6B7280', '#1F2937',
] as const;

type TagTab = 'conversations' | 'contacts';
type EditableTag = ConversationTag | ContactTag;

interface TagFormState {
  name: string;
  color: string;
  sort_order: number;
}

const EMPTY_FORM: TagFormState = {
  name: '',
  color: '#00C9A7',
  sort_order: 0,
};

export function ConversationTags() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TagTab>('conversations');
  const [showModal, setShowModal] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [form, setForm] = useState<TagFormState>(EMPTY_FORM);

  const conversationTagsQuery = useQuery({
    queryKey: ['admin', 'conversation-tags'],
    queryFn: () => conversationTags.list(),
  });

  const contactTagsQuery = useQuery({
    queryKey: ['admin', 'contact-tags'],
    queryFn: () => contactTags.list(),
  });

  const tags: EditableTag[] = activeTab === 'conversations'
    ? (conversationTagsQuery.data ?? [])
    : (contactTagsQuery.data ?? []);
  const isLoading = activeTab === 'conversations'
    ? conversationTagsQuery.isLoading
    : contactTagsQuery.isLoading;

  const editingTag = useMemo(
    () => tags.find((tag) => tag.id === editingTagId) ?? null,
    [editingTagId, tags],
  );

  const resetModal = () => {
    setShowModal(false);
    setEditingTagId(null);
    setForm(EMPTY_FORM);
  };

  const invalidateConversationTags = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'conversation-tags'] });
    await qc.invalidateQueries({ queryKey: ['conversation-tags'] });
  };

  const invalidateContactTags = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'contact-tags'] });
    await qc.invalidateQueries({ queryKey: ['contact-tags'] });
  };

  const createConversationMutation = useMutation({
    mutationFn: (payload: TagFormState) => conversationTags.create(payload),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.tags.messages.created'));
      resetModal();
      await invalidateConversationTags();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const updateConversationMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<TagFormState> }) =>
      conversationTags.update(id, payload),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.tags.messages.updated'));
      resetModal();
      await invalidateConversationTags();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const deleteConversationMutation = useMutation({
    mutationFn: (id: string) => conversationTags.delete(id),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.tags.messages.deleted'));
      await invalidateConversationTags();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const createContactMutation = useMutation({
    mutationFn: (payload: TagFormState) => contactTags.create(payload),
    onSuccess: async () => {
      toast.success(t('contactTags.saved'));
      resetModal();
      await invalidateContactTags();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const updateContactMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<TagFormState> }) =>
      contactTags.update(id, payload),
    onSuccess: async () => {
      toast.success(t('contactTags.saved'));
      resetModal();
      await invalidateContactTags();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const deleteContactMutation = useMutation({
    mutationFn: (id: string) => contactTags.delete(id),
    onSuccess: async () => {
      toast.success(t('contactTags.deleted'));
      await invalidateContactTags();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  function switchTab(tab: TagTab) {
    setActiveTab(tab);
    setEditingTagId(null);
    setForm(EMPTY_FORM);
  }

  function openCreateModal() {
    setEditingTagId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEditModal(tag: EditableTag) {
    setEditingTagId(tag.id);
    setForm({
      name: tag.name,
      color: tag.color,
      sort_order: tag.sort_order ?? 0,
    });
    setShowModal(true);
  }

  function handleSubmit() {
    const payload: TagFormState = {
      name: form.name.trim(),
      color: form.color,
      sort_order: Number(form.sort_order) || 0,
    };

    if (!payload.name) {
      toast.error(t('tenantAdmin.common.errorSave'));
      return;
    }

    if (activeTab === 'contacts') {
      if (editingTagId) {
        updateContactMutation.mutate({ id: editingTagId, payload });
      } else {
        createContactMutation.mutate(payload);
      }
      return;
    }

    if (editingTagId) {
      updateConversationMutation.mutate({ id: editingTagId, payload });
    } else {
      createConversationMutation.mutate(payload);
    }
  }

  function handleDelete(id: string) {
    if (activeTab === 'contacts') {
      deleteContactMutation.mutate(id);
    } else {
      deleteConversationMutation.mutate(id);
    }
  }

  const isSaving = createConversationMutation.isPending
    || updateConversationMutation.isPending
    || createContactMutation.isPending
    || updateContactMutation.isPending;
  const newTagLabel = activeTab === 'contacts'
    ? t('contactTags.new')
    : t('tenantAdmin.tags.new');

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div className="flex h-full flex-col p-6" style={{ overflow: 'hidden' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 style={{ margin: 0, color: 'var(--txt)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px' }}>
              {t('tenantAdmin.tags.title')}
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--txt-2)', fontSize: 12 }}>
              {t('tags.subtitle')}
            </p>
          </div>

          <Button onClick={openCreateModal}>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            {newTagLabel}
          </Button>
        </div>

        <div
          role="tablist"
          aria-label={t('tenantAdmin.tags.title')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            marginTop: 18,
            borderBottom: '1px solid var(--line)',
            flexShrink: 0,
          }}
        >
          {(['conversations', 'contacts'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => switchTab(tab)}
              style={{
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--teal)' : '2px solid transparent',
                background: 'transparent',
                color: activeTab === tab ? 'var(--teal)' : 'var(--txt-2)',
                fontFamily: 'var(--font)',
                fontSize: 13,
                fontWeight: activeTab === tab ? 600 : 400,
                padding: '10px 20px',
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {t(`tags.tabs.${tab}`)}
            </button>
          ))}
        </div>

        <section
          className="min-h-0 flex-1"
          style={{
            marginTop: 12,
            overflow: 'auto',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)',
          }}
        >
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-14 animate-pulse rounded-lg bg-bg-3" />
              ))}
            </div>
          ) : tags.length === 0 ? (
            <div className="zd-empty-state" style={{ minHeight: 320, padding: 24 }}>
              <div className="zd-empty-icon" aria-hidden>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M3 4h7l11 11-6 6L3 9V4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  <circle cx="7" cy="8" r="1.3" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </div>
              <strong style={{ color: 'var(--txt-2)', fontSize: 13, fontWeight: 500 }}>
                {t('tenantAdmin.common.noResults')}
              </strong>
            </div>
          ) : (
            <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {(['name', 'color', 'order', 'actions'] as const).map((column) => (
                    <th
                      key={column}
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                        padding: '10px 14px',
                        borderBottom: '1px solid var(--line)',
                        background: 'var(--bg-2)',
                        color: 'var(--txt-3)',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textAlign: column === 'actions' ? 'right' : 'left',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t(`tags.columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tags.map((tag) => (
                  <tr key={tag.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '12px 14px', color: 'var(--txt)', fontSize: 13, fontWeight: 500 }}>
                      {tag.name}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span
                        className="tag-pill"
                        style={{
                          background: `${tag.color}22`,
                          color: tag.color,
                          border: `1px solid ${tag.color}44`,
                          fontSize: 11,
                        }}
                      >
                        <span
                          aria-hidden
                          style={{ width: 7, height: 7, borderRadius: '50%', background: tag.color }}
                        />
                        {tag.name}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--txt-2)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                      {tag.sort_order ?? 0}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <button type="button" className="tb-btn" onClick={() => openEditModal(tag)}>
                          {t('tenantAdmin.common.edit')}
                        </button>
                        <button type="button" className="tb-btn danger" onClick={() => handleDelete(tag.id)}>
                          {activeTab === 'contacts'
                            ? t('tenantAdmin.common.remove')
                            : t('tenantAdmin.common.deactivate')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {showModal && (
          <div
            role="presentation"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'var(--backdrop)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
              padding: 16,
            }}
            onClick={resetModal}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="tag-modal-title"
              style={{
                width: '100%',
                maxWidth: 420,
                borderRadius: 'var(--r-lg)',
                background: 'var(--bg-2)',
                border: '1px solid var(--line-2)',
                boxShadow: 'var(--shadow-pop)',
                padding: 18,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="tag-modal-title" style={{ fontSize: 16, fontWeight: 600, color: 'var(--txt)', margin: '0 0 12px' }}>
                {editingTag ? t('tenantAdmin.common.edit') : newTagLabel}
              </h2>

              <div style={{ display: 'grid', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.tags.fields.name')}</span>
                  <Input
                    autoFocus
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  />
                </label>

                <fieldset style={{ display: 'grid', gap: 8, margin: 0, padding: 0, border: 0 }}>
                  <legend style={{ marginBottom: 6, fontSize: 12, color: 'var(--txt-2)' }}>
                    {t('tenantAdmin.tags.fields.color')}
                  </legend>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 8 }}>
                    {PRESET_COLORS.map((color) => (
                      <button
                        type="button"
                        key={color}
                        aria-label={color}
                        aria-pressed={form.color === color}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          border: form.color === color ? '2px solid var(--txt)' : '2px solid transparent',
                          outline: form.color === color ? `2px solid ${color}` : 'none',
                          outlineOffset: 2,
                          background: color,
                          cursor: 'pointer',
                          margin: '0 auto',
                        }}
                        onClick={() => setForm((prev) => ({ ...prev, color }))}
                      />
                    ))}
                  </div>
                </fieldset>

                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                    {t('tenantAdmin.conversationTags.columnOrder')}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    value={String(form.sort_order)}
                    onChange={(event) => setForm((prev) => ({
                      ...prev,
                      sort_order: Math.max(0, Number(event.target.value) || 0),
                    }))}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <Button variant="secondary" onClick={resetModal}>
                  {t('tenantAdmin.common.cancel')}
                </Button>
                <Button onClick={handleSubmit} loading={isSaving}>
                  {t('tenantAdmin.common.save')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
