import { useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { adminApi, type TicketType } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { PageShell } from '../../components/layout/PageShell';

const COLOR_PRESETS = [
  '#00C9A7', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444',
  '#EC4899', '#10B981', '#6B7280', '#14B8A6', '#F97316',
] as const;

const EMOJI_PRESETS = ['🎫', '🛠️', '💳', '📦', '🐞', '📞', '📧', '🔒', '⚙️', '📌'] as const;

interface TypeFormState {
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  require_due_date_for_urgent: boolean;
  require_category_for_waiting: boolean;
}

const EMPTY_FORM: TypeFormState = {
  name: '',
  icon: '🎫',
  color: '#00C9A7',
  sort_order: 0,
  require_due_date_for_urgent: true,
  require_category_for_waiting: true,
};

export function TicketTypes() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [form, setForm] = useState<TypeFormState>(EMPTY_FORM);

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['admin', 'ticket-types'],
    queryFn: adminApi.ticketTypes.list,
  });

  const sortedTypes = useMemo(
    () => types.slice().sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name);
    }),
    [types],
  );

  const editingType = useMemo(
    () => types.find((item) => item.id === editingTypeId) ?? null,
    [editingTypeId, types],
  );

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'ticket-types'] });
    await qc.invalidateQueries({ queryKey: ['ticket-types'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: TypeFormState) => adminApi.ticketTypes.create(payload),
    onSuccess: async () => {
      toast.success('Tipo de ticket criado');
      setShowModal(false);
      setEditingTypeId(null);
      setForm(EMPTY_FORM);
      await invalidate();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<TypeFormState & { is_active: boolean }> }) =>
      adminApi.ticketTypes.update(id, payload),
    onSuccess: async () => {
      toast.success('Tipo de ticket atualizado');
      setShowModal(false);
      setEditingTypeId(null);
      setForm(EMPTY_FORM);
      await invalidate();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => adminApi.ticketTypes.delete(id),
    onSuccess: async () => {
      toast.success('Tipo de ticket desativado');
      await invalidate();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  function openCreateModal() {
    setEditingTypeId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEditModal(type: TicketType) {
    setEditingTypeId(type.id);
    setForm({
      name: type.name,
      icon: type.icon,
      color: type.color,
      sort_order: type.sort_order,
      require_due_date_for_urgent: type.require_due_date_for_urgent,
      require_category_for_waiting: type.require_category_for_waiting,
    });
    setShowModal(true);
  }

  function handleSubmit() {
    const payload: TypeFormState = {
      name: form.name.trim(),
      icon: form.icon.trim() || '🎫',
      color: form.color,
      sort_order: Number(form.sort_order) || 0,
      require_due_date_for_urgent: form.require_due_date_for_urgent,
      require_category_for_waiting: form.require_category_for_waiting,
    };

    if (!payload.name) {
      toast.error(t('tenantAdmin.common.errorSave'));
      return;
    }

    if (editingTypeId) {
      updateMutation.mutate({ id: editingTypeId, payload });
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
            Tipos de Ticket
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
            Configure os tipos usados na criação de tickets.
          </p>
        </div>

        <Button onClick={openCreateModal}>
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          + Novo tipo
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
        ) : sortedTypes.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-sm" style={{ color: 'var(--txt-3)' }}>
            {t('tenantAdmin.common.noResults')}
          </div>
        ) : (
          <div className="flex flex-col">
            {sortedTypes.map((type) => (
              <div
                key={type.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--line)',
                  opacity: type.is_active ? 1 : 0.7,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{type.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{type.name}</span>
                  <span
                    className="ticket-type-badge"
                    style={{
                      background: `${type.color}22`,
                      color: type.color,
                      borderColor: `${type.color}44`,
                    }}
                  >
                    {type.color.toUpperCase()}
                  </span>
                  {!type.is_active ? (
                    <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                      Inativo
                    </span>
                  ) : null}
                  <span
                    style={{
                      fontSize: 10,
                      color: type.require_due_date_for_urgent ? 'var(--amber)' : 'var(--txt-3)',
                      border: '1px solid var(--line-2)',
                      borderRadius: 'var(--r-pill)',
                      padding: '2px 6px',
                    }}
                  >
                    Urgente exige prazo: {type.require_due_date_for_urgent ? 'Sim' : 'Não'}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: type.require_category_for_waiting ? 'var(--amber)' : 'var(--txt-3)',
                      border: '1px solid var(--line-2)',
                      borderRadius: 'var(--r-pill)',
                      padding: '2px 6px',
                    }}
                  >
                    Aguardando exige categoria: {type.require_category_for_waiting ? 'Sim' : 'Não'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => openEditModal(type)}
                    style={secondaryBtnStyle}
                  >
                    {t('tenantAdmin.common.edit')}
                  </button>

                  {type.is_active ? (
                    <button
                      type="button"
                      onClick={() => deactivateMutation.mutate(type.id)}
                      style={dangerBtnStyle}
                    >
                      {t('tenantAdmin.common.deactivate')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => updateMutation.mutate({ id: type.id, payload: { is_active: true } })}
                      style={primaryBtnStyle}
                    >
                      {t('tenantAdmin.common.activate')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showModal ? (
        <div style={overlayStyle} onClick={() => setShowModal(false)}>
          <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--txt)', marginBottom: 12 }}>
              {editingType ? 'Editar tipo de ticket' : 'Novo tipo de ticket'}
            </h2>

            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>Nome</span>
                <Input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>Ícone</span>
                <Input
                  value={form.icon}
                  onChange={(event) => setForm((prev) => ({ ...prev, icon: event.target.value.slice(0, 20) }))}
                  placeholder="🎫"
                  maxLength={20}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {EMOJI_PRESETS.map((emoji) => (
                    <button
                      type="button"
                      key={emoji}
                      onClick={() => setForm((prev) => ({ ...prev, icon: emoji }))}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 'var(--r)',
                        border: form.icon === emoji ? '1px solid var(--teal)' : '1px solid var(--line-2)',
                        background: form.icon === emoji ? 'var(--teal-dim)' : 'var(--bg-3)',
                        cursor: 'pointer',
                        fontSize: 16,
                        lineHeight: 1,
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>Cor</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 8 }}>
                  {COLOR_PRESETS.map((color) => (
                    <button
                      type="button"
                      key={color}
                      onClick={() => setForm((prev) => ({ ...prev, color }))}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        border: form.color === color ? '2px solid #fff' : '2px solid transparent',
                        outline: form.color === color ? `2px solid ${color}` : 'none',
                        background: color,
                        cursor: 'pointer',
                        margin: '0 auto',
                      }}
                    />
                  ))}
                </div>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>Ordem</span>
                <Input
                  type="number"
                  value={String(form.sort_order)}
                  onChange={(event) => setForm((prev) => ({ ...prev, sort_order: Number(event.target.value) || 0 }))}
                />
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--txt-2)' }}>
                <input
                  type="checkbox"
                  checked={form.require_due_date_for_urgent}
                  onChange={(event) => setForm((prev) => ({ ...prev, require_due_date_for_urgent: event.target.checked }))}
                />
                Exigir prazo quando prioridade for urgente
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--txt-2)' }}>
                <input
                  type="checkbox"
                  checked={form.require_category_for_waiting}
                  onChange={(event) => setForm((prev) => ({ ...prev, require_category_for_waiting: event.target.checked }))}
                />
                Exigir categoria quando status for aguardando
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setShowModal(false)}>
                {t('tenantAdmin.common.cancel')}
              </Button>
              <Button onClick={handleSubmit} loading={createMutation.isPending || updateMutation.isPending}>
                {t('tenantAdmin.common.save')}
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
