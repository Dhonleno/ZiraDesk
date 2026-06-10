import { useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { adminApi, type TicketCategory } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { PageShell } from '../../components/layout/PageShell';

const COLOR_PRESETS = [
  '#00C9A7', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444',
  '#EC4899', '#10B981', '#6B7280', '#14B8A6', '#F97316',
] as const;

interface CategoryFormState {
  name: string;
  description: string;
  color: string;
  sort_order: number;
  is_active: boolean;
}

const EMPTY_FORM: CategoryFormState = {
  name: '',
  description: '',
  color: '#00C9A7',
  sort_order: 0,
  is_active: true,
};

export function TicketCategories() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CategoryFormState>(EMPTY_FORM);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['admin', 'ticket-categories'],
    queryFn: adminApi.ticketCategories.list,
  });

  const sortedCategories = useMemo(
    () => categories.slice().sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name);
    }),
    [categories],
  );

  const editingCategory = useMemo(
    () => categories.find((item) => item.id === editingId) ?? null,
    [editingId, categories],
  );

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'ticket-categories'] });
    await qc.invalidateQueries({ queryKey: ['ticket-categories'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: CategoryFormState) => adminApi.ticketCategories.create(payload),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.ticketCategories.saved'));
      setShowModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await invalidate();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CategoryFormState> }) =>
      adminApi.ticketCategories.update(id, payload),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.ticketCategories.saved'));
      setShowModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await invalidate();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.ticketCategories.delete(id),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.ticketCategories.deleted'));
      await invalidate();
    },
    onError: (err: Error) => {
      const isInUse = err.message?.includes('em uso') || err.message?.includes('in use');
      toast.error(isInUse ? t('tenantAdmin.ticketCategories.deleteError') : t('tenantAdmin.common.errorSave'));
    },
  });

  function openCreateModal() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEditModal(category: TicketCategory) {
    setEditingId(category.id);
    setForm({
      name: category.name,
      description: category.description ?? '',
      color: category.color ?? '#00C9A7',
      sort_order: category.sort_order,
      is_active: category.is_active,
    });
    setShowModal(true);
  }

  function handleSubmit() {
    const name = form.name.trim();
    if (!name) {
      toast.error(t('tenantAdmin.ticketCategories.fields.nameRequired'));
      return;
    }

    const payload: CategoryFormState = {
      name,
      description: form.description.trim(),
      color: form.color,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
      return;
    }

    createMutation.mutate(payload);
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div className="flex h-full flex-col gap-5 p-6" style={{ overflow: 'hidden' }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>
              {t('tenantAdmin.ticketCategories.title')}
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
              {t('tenantAdmin.ticketCategories.subtitle')}
            </p>
          </div>

          <Button onClick={openCreateModal}>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            + {t('tenantAdmin.ticketCategories.new')}
          </Button>
        </div>

        <section
          className="min-h-0 flex-1 overflow-y-auto rounded-xl"
          style={{ border: '1px solid var(--line)', background: 'var(--bg-2)' }}
        >
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-14 animate-pulse rounded-xl bg-bg-3" />
              ))}
            </div>
          ) : sortedCategories.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
                {t('tenantAdmin.ticketCategories.empty.title')}
              </p>
              <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
                {t('tenantAdmin.ticketCategories.empty.subtitle')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              {sortedCategories.map((cat) => (
                <div
                  key={cat.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px minmax(0,1fr) auto',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    borderBottom: '1px solid var(--line)',
                    opacity: cat.is_active ? 1 : 0.6,
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: cat.color ?? 'var(--bg-5)',
                      border: '1px solid var(--line-2)',
                      flexShrink: 0,
                    }}
                  />

                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{cat.name}</span>
                      {cat.sort_order > 0 ? (
                        <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
                          #{cat.sort_order}
                        </span>
                      ) : null}
                      {!cat.is_active ? (
                        <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                          {t('tenantAdmin.ticketCategories.list.inactive')}
                        </span>
                      ) : null}
                    </div>
                    {cat.description ? (
                      <p style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cat.description}
                      </p>
                    ) : null}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button" onClick={() => openEditModal(cat)} style={secondaryBtnStyle}>
                      {t('tenantAdmin.common.edit')}
                    </button>
                    {cat.is_active ? (
                      <button
                        type="button"
                        onClick={() => updateMutation.mutate({ id: cat.id, payload: { is_active: false } })}
                        style={dangerBtnStyle}
                      >
                        {t('tenantAdmin.common.deactivate')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => updateMutation.mutate({ id: cat.id, payload: { is_active: true } })}
                        style={primaryBtnStyle}
                      >
                        {t('tenantAdmin.common.activate')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(cat.id)}
                      style={dangerBtnStyle}
                    >
                      {t('tenantAdmin.common.remove')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {showModal ? (
          <div style={overlayStyle} onClick={() => setShowModal(false)}>
            <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--txt)', marginBottom: 12 }}>
                {t(`tenantAdmin.ticketCategories.modalTitle.${editingCategory ? 'edit' : 'new'}`)}
              </h2>

              <div style={{ display: 'grid', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                    {t('tenantAdmin.ticketCategories.fields.name')} <span style={{ color: 'var(--red)' }}>*</span>
                  </span>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    maxLength={100}
                    autoFocus
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.ticketCategories.fields.description')}</span>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    maxLength={500}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.ticketCategories.fields.color')}</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {COLOR_PRESETS.map((color) => (
                      <button
                        type="button"
                        key={color}
                        onClick={() => setForm((prev) => ({ ...prev, color }))}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          border: form.color === color ? '2px solid #fff' : '2px solid transparent',
                          outline: form.color === color ? `2px solid ${color}` : 'none',
                          background: color,
                          cursor: 'pointer',
                        }}
                        aria-label={color}
                      />
                    ))}
                  </div>
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>{t('tenantAdmin.ticketCategories.list.order')}</span>
                  <Input
                    type="number"
                    value={String(form.sort_order)}
                    onChange={(e) => setForm((prev) => ({ ...prev, sort_order: Number(e.target.value) || 0 }))}
                  />
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--txt-2)' }}>
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  />
                  {t('tenantAdmin.ticketCategories.fields.active')}
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <Button variant="secondary" onClick={() => setShowModal(false)}>
                  {t('tenantAdmin.common.cancel')}
                </Button>
                <Button onClick={handleSubmit} loading={isSaving}>
                  {isSaving ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(2,6,23,.64)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 16,
};

const modalStyle: CSSProperties = {
  width: '100%',
  maxWidth: 430,
  borderRadius: 'var(--r-lg)',
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  padding: 18,
};

const secondaryBtnStyle: CSSProperties = {
  border: '1px solid var(--line)',
  background: 'var(--bg-3)',
  color: 'var(--txt-2)',
  borderRadius: 'var(--r)',
  fontSize: 12,
  padding: '5px 10px',
  cursor: 'pointer',
};

const dangerBtnStyle: CSSProperties = {
  border: '1px solid rgba(248,113,113,.25)',
  background: 'var(--red-dim)',
  color: 'var(--red)',
  borderRadius: 'var(--r)',
  fontSize: 12,
  padding: '5px 10px',
  cursor: 'pointer',
};

const primaryBtnStyle: CSSProperties = {
  border: '1px solid var(--teal)',
  background: 'var(--teal-dim)',
  color: 'var(--teal)',
  borderRadius: 'var(--r)',
  fontSize: 12,
  padding: '5px 10px',
  cursor: 'pointer',
};
