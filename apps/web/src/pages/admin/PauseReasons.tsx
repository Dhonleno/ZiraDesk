import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, type PauseReason } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../stores/toast.store';

interface DraftReason {
  label: string;
  icon: string;
  sort_order: number;
}

function toDraft(reason: PauseReason): DraftReason {
  return {
    label: reason.label,
    icon: reason.icon,
    sort_order: reason.sort_order,
  };
}

export function PauseReasons() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [newReason, setNewReason] = useState<DraftReason>({
    label: '',
    icon: '⏸️',
    sort_order: 0,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<DraftReason | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'pause-reasons'],
    queryFn: adminApi.pauseReasons.list,
  });

  const reasons = useMemo(
    () => data.slice().sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)),
    [data],
  );

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'pause-reasons'] });
    await queryClient.invalidateQueries({ queryKey: ['pause-reasons'] });
  };

  const createMutation = useMutation({
    mutationFn: adminApi.pauseReasons.create,
    onSuccess: async () => {
      setNewReason({ label: '', icon: '⏸️', sort_order: 0 });
      await invalidate();
      toast.success(t('tenantAdmin.pauseReasons.messages.created'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<DraftReason & { is_active: boolean }> }) =>
      adminApi.pauseReasons.update(id, payload),
    onSuccess: async () => {
      setEditingId(null);
      setEditingDraft(null);
      await invalidate();
      toast.success(t('tenantAdmin.pauseReasons.messages.updated'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const deleteMutation = useMutation({
    mutationFn: adminApi.pauseReasons.delete,
    onSuccess: async () => {
      await invalidate();
      toast.success(t('tenantAdmin.pauseReasons.messages.deactivated'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  return (
    <div className="admin-page space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>
          {t('tenantAdmin.pauseReasons.title')}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
          {t('tenantAdmin.pauseReasons.subtitle')}
        </p>
      </div>

      <div className="admin-two-col">
        <section className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
          <h2 style={{ margin: 0, color: 'var(--txt)', fontSize: 15, fontWeight: 700 }}>
            {t('tenantAdmin.pauseReasons.new')}
          </h2>

          <div style={{ display: 'grid', gap: 8 }}>
            <input
              value={newReason.label}
              onChange={(event) => setNewReason((cur) => ({ ...cur, label: event.target.value }))}
              placeholder={t('tenantAdmin.pauseReasons.fields.label')}
              style={inputStyle}
              maxLength={100}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '120px 120px', gap: 8 }}>
              <input
                value={newReason.icon}
                onChange={(event) => setNewReason((cur) => ({ ...cur, icon: event.target.value }))}
                placeholder={t('tenantAdmin.pauseReasons.fields.icon')}
                style={inputStyle}
                maxLength={10}
              />
              <input
                type="number"
                min={0}
                value={newReason.sort_order}
                onChange={(event) => setNewReason((cur) => ({ ...cur, sort_order: Number(event.target.value) || 0 }))}
                placeholder={t('tenantAdmin.pauseReasons.fields.sort')}
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                type="button"
                onClick={() =>
                  createMutation.mutate({
                    label: newReason.label.trim(),
                    icon: newReason.icon.trim() || '⏸️',
                    sort_order: newReason.sort_order,
                  })
                }
                disabled={!newReason.label.trim() || createMutation.isPending}
                loading={createMutation.isPending}
              >
                {t('tenantAdmin.common.save')}
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-xl p-3 space-y-2" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)' }} />
            ))
          ) : reasons.length === 0 ? (
            <p style={{ margin: 0, padding: 12, color: 'var(--txt-3)', fontSize: 13 }}>
              {t('tenantAdmin.common.noResults')}
            </p>
          ) : (
            reasons.map((reason) => {
            const isEditing = editingId === reason.id;
            const draft = isEditing ? editingDraft : null;

            return (
              <div
                key={reason.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 8,
                  alignItems: 'center',
                  padding: 10,
                  borderRadius: 'var(--r)',
                  border: '1px solid var(--line)',
                  background: reason.is_active ? 'var(--bg-3)' : 'var(--bg-4)',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 120px', gap: 8 }}>
                  {isEditing && draft ? (
                    <>
                      <input
                        value={draft.icon}
                        onChange={(event) =>
                          setEditingDraft((current) => (current ? { ...current, icon: event.target.value } : current))
                        }
                        style={inputStyle}
                        maxLength={10}
                      />
                      <input
                        value={draft.label}
                        onChange={(event) =>
                          setEditingDraft((current) => (current ? { ...current, label: event.target.value } : current))
                        }
                        style={inputStyle}
                        maxLength={100}
                      />
                      <input
                        type="number"
                        min={0}
                        value={draft.sort_order}
                        onChange={(event) =>
                          setEditingDraft((current) => (
                            current ? { ...current, sort_order: Number(event.target.value) || 0 } : current
                          ))
                        }
                        style={inputStyle}
                      />
                    </>
                  ) : (
                    <>
                      <span style={{ color: 'var(--txt)', fontSize: 22, display: 'inline-flex', alignItems: 'center' }}>{reason.icon}</span>
                      <div>
                        <p style={{ margin: 0, color: 'var(--txt)', fontSize: 13, fontWeight: 600 }}>{reason.label}</p>
                        <p style={{ margin: '3px 0 0', color: 'var(--txt-3)', fontSize: 11 }}>
                          {t('tenantAdmin.pauseReasons.fields.sort')}: {reason.sort_order}
                          {' - '}
                          {reason.is_active ? t('tenantAdmin.pauseReasons.active') : t('tenantAdmin.pauseReasons.inactive')}
                        </p>
                      </div>
                      <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>
                        {reason.is_active ? t('tenantAdmin.pauseReasons.active') : t('tenantAdmin.pauseReasons.inactive')}
                      </span>
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  {isEditing && draft ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditingId(null);
                          setEditingDraft(null);
                        }}
                      >
                        {t('tenantAdmin.common.cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          updateMutation.mutate({
                            id: reason.id,
                            payload: {
                              label: draft.label.trim(),
                              icon: draft.icon.trim() || '⏸️',
                              sort_order: draft.sort_order,
                            },
                          })
                        }
                        loading={updateMutation.isPending}
                        disabled={!draft.label.trim() || updateMutation.isPending}
                      >
                        {t('tenantAdmin.common.save')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditingId(reason.id);
                          setEditingDraft(toDraft(reason));
                        }}
                      >
                        {t('tenantAdmin.common.edit')}
                      </Button>
                      {reason.is_active ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => deleteMutation.mutate(reason.id)}
                          loading={deleteMutation.isPending}
                        >
                          {t('tenantAdmin.common.deactivate')}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            updateMutation.mutate({
                              id: reason.id,
                              payload: { is_active: true },
                            })
                          }
                          loading={updateMutation.isPending}
                        >
                          {t('tenantAdmin.common.activate')}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
            })
          )}
        </section>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-3)',
  border: '1px solid var(--line)',
  color: 'var(--txt)',
  borderRadius: 'var(--r)',
  height: 36,
  padding: '0 10px',
  fontSize: 13,
  width: '100%',
};
