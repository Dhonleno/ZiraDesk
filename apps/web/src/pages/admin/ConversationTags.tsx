import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { conversationTags, type ConversationTag } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { PageShell } from '../../components/layout/PageShell';

const PRESET_COLORS = [
  '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#00C9A7', '#F97316',
  '#6B7280', '#1F2937',
] as const;

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
  const [showModal, setShowModal] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [form, setForm] = useState<TagFormState>(EMPTY_FORM);

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['admin', 'conversation-tags'],
    queryFn: () => conversationTags.list(),
  });

  const editingTag = useMemo(
    () => tags.find((tag) => tag.id === editingTagId) ?? null,
    [editingTagId, tags],
  );

  const createMutation = useMutation({
    mutationFn: (payload: TagFormState) => conversationTags.create(payload),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.tags.messages.created'));
      setShowModal(false);
      setForm(EMPTY_FORM);
      await qc.invalidateQueries({ queryKey: ['admin', 'conversation-tags'] });
      await qc.invalidateQueries({ queryKey: ['conversation-tags'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<TagFormState> }) =>
      conversationTags.update(id, payload),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.tags.messages.updated'));
      setShowModal(false);
      setEditingTagId(null);
      setForm(EMPTY_FORM);
      await qc.invalidateQueries({ queryKey: ['admin', 'conversation-tags'] });
      await qc.invalidateQueries({ queryKey: ['conversation-tags'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => conversationTags.delete(id),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.tags.messages.deleted'));
      await qc.invalidateQueries({ queryKey: ['admin', 'conversation-tags'] });
      await qc.invalidateQueries({ queryKey: ['conversation-tags'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  function openCreateModal() {
    setEditingTagId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEditModal(tag: ConversationTag) {
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

    if (editingTagId) {
      updateMutation.mutate({ id: editingTagId, payload });
      return;
    }

    createMutation.mutate(payload);
  }

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div className="flex h-full flex-col gap-5 p-6" style={{ overflow: 'hidden' }}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>
            {t('tenantAdmin.tags.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.tags.subtitle')}
          </p>
        </div>

        <Button onClick={openCreateModal}>
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {t('tenantAdmin.tags.new')}
        </Button>
      </div>

      <section
        className="min-h-0 flex-1 overflow-y-auto rounded-xl"
        style={{ border: '1px solid var(--line)', background: 'var(--bg-2)' }}
      >
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-xl bg-bg-3" />
            ))}
          </div>
        ) : tags.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-sm" style={{ color: 'var(--txt-3)' }}>
            {t('tenantAdmin.common.noResults')}
          </div>
        ) : (
          <div className="flex flex-col">
            {tags.map((tag) => (
              <div
                key={tag.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: tag.color,
                      boxShadow: '0 0 0 3px rgba(0,0,0,.15)',
                    }}
                  />
                  <span
                    className="conv-tag-chip"
                    style={{
                      background: `${tag.color}22`,
                      color: tag.color,
                      borderColor: `${tag.color}44`,
                      fontSize: 12,
                    }}
                  >
                    {tag.name}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => openEditModal(tag)}
                    style={{
                      border: '1px solid var(--line)',
                      background: 'var(--bg-3)',
                      color: 'var(--txt-2)',
                      borderRadius: 'var(--r)',
                      fontSize: 12,
                      padding: '5px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    {t('tenantAdmin.common.edit')}
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(tag.id)}
                    style={{
                      border: '1px solid rgba(248,113,113,.25)',
                      background: 'var(--red-dim)',
                      color: 'var(--red)',
                      borderRadius: 'var(--r)',
                      fontSize: 12,
                      padding: '5px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    {t('tenantAdmin.common.deactivate')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2,6,23,.64)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 16,
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              borderRadius: 'var(--r-lg)',
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              padding: 18,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--txt)', marginBottom: 12 }}>
              {editingTag ? t('tenantAdmin.common.edit') : t('tenantAdmin.tags.new')}
            </h2>

            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.tags.fields.name')}</span>
                <Input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.tags.fields.color')}</span>
                <div className="color-picker-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 8 }}>
                  {PRESET_COLORS.map((color) => (
                    <button
                      type="button"
                      key={color}
                      className={`color-dot ${form.color === color ? 'active' : ''}`}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        border: form.color === color ? '2px solid #fff' : '2px solid transparent',
                        outline: form.color === color ? `2px solid ${color}` : 'none',
                        background: color,
                        cursor: 'pointer',
                        margin: '0 auto',
                      }}
                      onClick={() => setForm((prev) => ({ ...prev, color }))}
                    />
                  ))}
                </div>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                  {t('tenantAdmin.conversationTags.columnOrder')}
                </span>
                <Input
                  type="number"
                  value={String(form.sort_order)}
                  onChange={(event) => setForm((prev) => ({ ...prev, sort_order: Number(event.target.value) || 0 }))}
                />
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setShowModal(false)}>
                {t('tenantAdmin.common.cancel')}
              </Button>
              <Button
                onClick={handleSubmit}
                loading={createMutation.isPending || updateMutation.isPending}
              >
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
