import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import axios from 'axios';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { useAuth } from '../../hooks/useAuth';
import {
  adminApi,
  omnichannelApi,
  type ConversationCloseConfigItem,
  type ConversationCloseConfigPreview,
} from '../../services/api';
import { useToast } from '../../stores/toast.store';

type CloseConfigKind = 'types' | 'outcomes';

type FormValues = {
  label: string;
};

const formSchema = z.object({
  label: z.string().trim().min(1).max(60),
});

type SortableRowProps = {
  item: ConversationCloseConfigItem;
  kind: CloseConfigKind;
  isUpdating: boolean;
  isDeleting: boolean;
  isBlocked: boolean;
  canManage: boolean;
  t: TFunction<'admin'>;
  onToggle: (item: ConversationCloseConfigItem) => void;
  onEdit: (item: ConversationCloseConfigItem, kind: CloseConfigKind) => void;
  onDelete: (item: ConversationCloseConfigItem, kind: CloseConfigKind) => void;
};

function SortableRow({
  item,
  kind,
  isUpdating,
  isDeleting,
  isBlocked,
  canManage,
  t,
  onToggle,
  onEdit,
  onDelete,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const rowStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    borderBottom: '1px solid var(--line)',
    padding: '12px 14px',
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    gap: 10,
    alignItems: 'center',
    background: isDragging ? 'var(--bg-3)' : 'transparent',
  };

  const switchActive = item.isActive;
  const deleteDisabled = isDeleting || isBlocked;

  return (
    <div ref={setNodeRef} style={rowStyle} className="close-config-row">
      <button
        type="button"
        className="drag-handle-btn"
        aria-label={t('tenantAdmin.closeConfig.dragHandle')}
        title={t('tenantAdmin.closeConfig.dragHandle')}
        {...attributes}
        {...listeners}
      >
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden>
          <circle cx="6" cy="5" r="1.1" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="6" cy="10" r="1.1" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="6" cy="15" r="1.1" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="14" cy="5" r="1.1" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="14" cy="10" r="1.1" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="14" cy="15" r="1.1" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>

      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            color: 'var(--txt)',
            fontSize: 13,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {item.label}
        </span>

        {item.isDefault ? (
          <span className="default-badge">
            {t('tenantAdmin.closeConfig.defaultBadge')}
          </span>
        ) : null}
      </div>

      <div className="row-actions">
        <button
          type="button"
          onClick={() => onToggle(item)}
          disabled={isUpdating || !canManage}
          className="toggle-btn"
          role="switch"
          aria-checked={switchActive}
          aria-label={switchActive ? t('tenantAdmin.closeConfig.active') : t('tenantAdmin.closeConfig.inactive')}
          title={switchActive ? t('tenantAdmin.closeConfig.active') : t('tenantAdmin.closeConfig.inactive')}
        >
          <span
            style={{
              width: 36,
              height: 20,
              borderRadius: 999,
              border: `1px solid ${switchActive ? 'rgba(0,201,167,.45)' : 'var(--line-2)'}`,
              background: switchActive ? 'var(--teal-dim)' : 'var(--bg-4)',
              display: 'inline-flex',
              alignItems: 'center',
              padding: 2,
              transition: 'all .15s ease',
              opacity: isUpdating ? 0.6 : 1,
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: switchActive ? 'var(--teal)' : 'var(--txt-3)',
                transform: `translateX(${switchActive ? 16 : 0}px)`,
                transition: 'transform .15s ease, background .15s ease',
              }}
            />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onEdit(item, kind)}
          className="icon-action-btn"
          disabled={!canManage}
          title={t('tenantAdmin.common.edit')}
          aria-label={t('tenantAdmin.common.edit')}
        >
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden>
            <path
              d="M4.5 15.5l2.8-.6 7-7a1.5 1.5 0 0 0 0-2.1l-.2-.2a1.5 1.5 0 0 0-2.1 0l-7 7-.6 2.9z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <path d="M10.9 5.8l3.3 3.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => onDelete(item, kind)}
          className="icon-action-btn"
          title={isBlocked ? t('tenantAdmin.closeConfig.deleteBlocked') : t('tenantAdmin.common.remove')}
          aria-label={isBlocked ? t('tenantAdmin.closeConfig.deleteBlocked') : t('tenantAdmin.common.remove')}
          disabled={deleteDisabled || !canManage}
        >
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden>
            <path d="M3.8 5h12.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M7.6 5V3.8h4.8V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path
              d="M6.2 5l.8 10h6l.8-10"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M8.7 8.2v4.9M11.3 8.2v4.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

type SectionCardProps = {
  title: string;
  eyebrow: string;
  addLabel: string;
  kind: CloseConfigKind;
  items: ConversationCloseConfigItem[];
  isLoading: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  blockedIds: Set<string>;
  canManage: boolean;
  t: TFunction<'admin'>;
  onAdd: (kind: CloseConfigKind) => void;
  onToggle: (item: ConversationCloseConfigItem) => void;
  onEdit: (item: ConversationCloseConfigItem, kind: CloseConfigKind) => void;
  onDelete: (item: ConversationCloseConfigItem, kind: CloseConfigKind) => void;
  onReorder: (event: DragEndEvent, kind: CloseConfigKind) => void;
  sensors: ReturnType<typeof useSensors>;
};

function SectionCard({
  title,
  eyebrow,
  addLabel,
  kind,
  items,
  isLoading,
  isUpdating,
  isDeleting,
  blockedIds,
  canManage,
  t,
  onAdd,
  onToggle,
  onEdit,
  onDelete,
  onReorder,
  sensors,
}: SectionCardProps) {
  return (
    <section className="close-config-card">
      <header className="section-head">
        <div>
          <div className="section-eyebrow">{eyebrow}</div>
          <h2 className="section-title">{title}</h2>
        </div>

        <button type="button" className="tb-btn-primary" onClick={() => onAdd(kind)} disabled={!canManage}>
          <svg viewBox="0 0 20 20" width="13" height="13" fill="none" aria-hidden>
            <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {addLabel}
        </button>
      </header>

      <div className="section-list-wrap">
        {isLoading ? (
          <div className="section-loading">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="section-loading-row" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <p className="empty-text">{t('tenantAdmin.closeConfig.empty')}</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => onReorder(event, kind)}>
            <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              <div>
                {items.map((item) => (
                  <SortableRow
                    key={item.id}
                    kind={kind}
                    item={item}
                    isUpdating={isUpdating}
                    isDeleting={isDeleting}
                    isBlocked={blockedIds.has(item.id)}
                    canManage={canManage}
                    t={t}
                    onToggle={onToggle}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </section>
  );
}

export function CloseConfig() {
  const { t } = useTranslation('admin');
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManageCloseConfig = user?.role === 'owner' || user?.role === 'admin';

  const [typeItems, setTypeItems] = useState<ConversationCloseConfigItem[]>([]);
  const [outcomeItems, setOutcomeItems] = useState<ConversationCloseConfigItem[]>([]);
  const [blockedTypeIds, setBlockedTypeIds] = useState<Set<string>>(new Set());
  const [blockedOutcomeIds, setBlockedOutcomeIds] = useState<Set<string>>(new Set());
  const [editingState, setEditingState] = useState<{ kind: CloseConfigKind; item: ConversationCloseConfigItem | null } | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      label: '',
    },
  });

  const typesQuery = useQuery({
    queryKey: ['admin', 'close-config', 'types'],
    queryFn: adminApi.closeConfig.listTypes,
    enabled: canManageCloseConfig,
  });

  const outcomesQuery = useQuery({
    queryKey: ['admin', 'close-config', 'outcomes'],
    queryFn: adminApi.closeConfig.listOutcomes,
    enabled: canManageCloseConfig,
  });

  const previewQuery = useQuery({
    queryKey: ['omnichannel', 'close-config'],
    queryFn: omnichannelApi.getCloseConfig,
  });

  useEffect(() => {
    if (typesQuery.data) {
      setTypeItems(typesQuery.data);
    }
  }, [typesQuery.data]);

  useEffect(() => {
    if (outcomesQuery.data) {
      setOutcomeItems(outcomesQuery.data);
    }
  }, [outcomesQuery.data]);

  useEffect(() => {
    if (!editingState) {
      form.reset({ label: '' });
      return;
    }

    form.reset({
      label: editingState.item?.label ?? '',
    });
  }, [editingState, form]);

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'close-config', 'types'] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'close-config', 'outcomes'] });
    await queryClient.invalidateQueries({ queryKey: ['omnichannel', 'close-config'] });
  };

  const createTypeMutation = useMutation({
    mutationFn: (payload: FormValues) => adminApi.closeConfig.createType({ label: payload.label }),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.closeConfig.messages.created'));
      setEditingState(null);
      await invalidateAll();
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const createOutcomeMutation = useMutation({
    mutationFn: (payload: FormValues) => adminApi.closeConfig.createOutcome({ label: payload.label }),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.closeConfig.messages.created'));
      setEditingState(null);
      await invalidateAll();
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const updateTypeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ label: string; isActive: boolean; order: number }> }) =>
      adminApi.closeConfig.updateType(id, data),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.closeConfig.messages.updated'));
      setEditingState(null);
      await invalidateAll();
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const updateOutcomeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ label: string; isActive: boolean; order: number }> }) =>
      adminApi.closeConfig.updateOutcome(id, data),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.closeConfig.messages.updated'));
      setEditingState(null);
      await invalidateAll();
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const deleteTypeMutation = useMutation({
    mutationFn: (id: string) => adminApi.closeConfig.deleteType(id),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.closeConfig.messages.deleted'));
      await invalidateAll();
    },
    onError: (error, id) => {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        setBlockedTypeIds((prev) => new Set(prev).add(id));
        toast.error(t('tenantAdmin.closeConfig.deleteBlocked'));
        return;
      }
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const deleteOutcomeMutation = useMutation({
    mutationFn: (id: string) => adminApi.closeConfig.deleteOutcome(id),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.closeConfig.messages.deleted'));
      await invalidateAll();
    },
    onError: (error, id) => {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        setBlockedOutcomeIds((prev) => new Set(prev).add(id));
        toast.error(t('tenantAdmin.closeConfig.deleteBlocked'));
        return;
      }
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  const reorderTypesMutation = useMutation({
    mutationFn: (ids: string[]) => adminApi.closeConfig.reorderTypes(ids),
    onSuccess: async (data) => {
      setTypeItems(data);
      await invalidateAll();
    },
    onError: async () => {
      toast.error(t('tenantAdmin.common.errorSave'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'close-config', 'types'] });
    },
  });

  const reorderOutcomesMutation = useMutation({
    mutationFn: (ids: string[]) => adminApi.closeConfig.reorderOutcomes(ids),
    onSuccess: async (data) => {
      setOutcomeItems(data);
      await invalidateAll();
    },
    onError: async () => {
      toast.error(t('tenantAdmin.common.errorSave'));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'close-config', 'outcomes'] });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const isModalSaving = createTypeMutation.isPending
    || createOutcomeMutation.isPending
    || updateTypeMutation.isPending
    || updateOutcomeMutation.isPending;

  const isRowUpdating = updateTypeMutation.isPending || updateOutcomeMutation.isPending;
  const isRowDeleting = deleteTypeMutation.isPending || deleteOutcomeMutation.isPending;

  const previewData = useMemo<ConversationCloseConfigPreview | null>(
    () => previewQuery.data ?? null,
    [previewQuery.data],
  );

  const previewCounts = useMemo(
    () => ({
      types: previewData?.types.length ?? 0,
      outcomes: previewData?.outcomes.length ?? 0,
    }),
    [previewData],
  );

  const modalTitle = useMemo(() => {
    if (!editingState) return '';
    if (editingState.kind === 'types') {
      return editingState.item
        ? t('tenantAdmin.closeConfig.editType')
        : t('tenantAdmin.closeConfig.addType');
    }
    return editingState.item
      ? t('tenantAdmin.closeConfig.editOutcome')
      : t('tenantAdmin.closeConfig.addOutcome');
  }, [editingState, t]);

  const openCreateModal = (kind: CloseConfigKind) => {
    if (!canManageCloseConfig) return;
    setEditingState({ kind, item: null });
  };

  const openEditModal = (item: ConversationCloseConfigItem, kind: CloseConfigKind) => {
    if (!canManageCloseConfig) return;
    setEditingState({ kind, item });
  };

  const closeModal = () => {
    setEditingState(null);
  };

  const submitModal = form.handleSubmit(async (values) => {
    if (!editingState) return;
    const normalizedLabel = values.label.trim();

    try {
      if (editingState.kind === 'types') {
        if (editingState.item) {
          await updateTypeMutation.mutateAsync({
            id: editingState.item.id,
            data: { label: normalizedLabel },
          });
          return;
        }
        await createTypeMutation.mutateAsync({ label: normalizedLabel });
        return;
      }

      if (editingState.item) {
        await updateOutcomeMutation.mutateAsync({
          id: editingState.item.id,
          data: { label: normalizedLabel },
        });
        return;
      }
      await createOutcomeMutation.mutateAsync({ label: normalizedLabel });
    } catch {
      // handled by mutation onError; prevents unhandled promise rejection in UI
    }
  });

  const handleToggle = (item: ConversationCloseConfigItem, kind: CloseConfigKind) => {
    if (!canManageCloseConfig) return;
    const nextValue = !item.isActive;
    if (kind === 'types') {
      updateTypeMutation.mutate({ id: item.id, data: { isActive: nextValue } });
      return;
    }
    updateOutcomeMutation.mutate({ id: item.id, data: { isActive: nextValue } });
  };

  const handleDelete = (item: ConversationCloseConfigItem, kind: CloseConfigKind) => {
    if (!canManageCloseConfig) return;
    if (kind === 'types') {
      if (blockedTypeIds.has(item.id)) {
        toast.error(t('tenantAdmin.closeConfig.deleteBlocked'));
        return;
      }
      deleteTypeMutation.mutate(item.id);
      return;
    }

    if (blockedOutcomeIds.has(item.id)) {
      toast.error(t('tenantAdmin.closeConfig.deleteBlocked'));
      return;
    }
    deleteOutcomeMutation.mutate(item.id);
  };

  const handleReorder = (event: DragEndEvent, kind: CloseConfigKind) => {
    if (!canManageCloseConfig) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    if (kind === 'types') {
      setTypeItems((prev) => {
        const oldIndex = prev.findIndex((item) => item.id === active.id);
        const newIndex = prev.findIndex((item) => item.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return prev;
        const next = arrayMove(prev, oldIndex, newIndex);
        reorderTypesMutation.mutate(next.map((item) => item.id));
        return next;
      });
      return;
    }

    setOutcomeItems((prev) => {
      const oldIndex = prev.findIndex((item) => item.id === active.id);
      const newIndex = prev.findIndex((item) => item.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      reorderOutcomesMutation.mutate(next.map((item) => item.id));
      return next;
    });
  };

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div className="close-config-page">
        <style>
          {`
            .close-config-page {
              height: 100%;
              overflow: hidden;
              display: flex;
              flex-direction: column;
              padding: 18px 20px;
              gap: 14px;
              font-family: var(--font);
            }

            .close-config-head {
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 12px;
            }

            .close-config-title {
              margin: 0;
              font-size: 22px;
              font-weight: 600;
              letter-spacing: -0.4px;
              color: var(--txt);
            }

            .close-config-sub {
              margin-top: 3px;
              font-size: 12px;
              color: var(--txt-2);
            }

            .close-config-preview {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              padding: 5px 9px;
              border-radius: var(--r-pill);
              border: 1px solid var(--line);
              background: var(--bg-3);
              color: var(--txt-2);
              font-size: 11px;
              font-family: var(--mono);
            }

            .close-config-grid {
              flex: 1;
              min-height: 0;
              overflow: hidden;
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 24px;
            }

            .close-config-card {
              min-height: 0;
              display: flex;
              flex-direction: column;
              border: 1px solid var(--line);
              border-radius: var(--r-lg);
              background: var(--bg-2);
              overflow: hidden;
            }

            .section-head {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
              padding: 14px 14px 12px;
              border-bottom: 1px solid var(--line);
            }

            .section-eyebrow {
              font-size: 11px;
              font-weight: 600;
              letter-spacing: 0.1em;
              text-transform: uppercase;
              color: var(--txt-3);
            }

            .section-title {
              margin: 3px 0 0;
              font-size: 15px;
              color: var(--txt);
              font-weight: 500;
            }

            .tb-btn-primary {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              height: 30px;
              padding: 0 11px;
              border-radius: var(--r);
              border: 1px solid var(--teal);
              background: var(--teal);
              color: var(--on-teal);
              font-size: 12px;
              font-weight: 600;
              font-family: var(--font);
              cursor: pointer;
              transition: filter .16s ease;
            }

            .tb-btn-primary:hover {
              filter: brightness(1.08);
            }

            .tb-btn-primary:disabled {
              opacity: .55;
              cursor: not-allowed;
            }

            .section-list-wrap {
              flex: 1;
              min-height: 0;
              overflow-y: auto;
            }

            .section-loading {
              display: grid;
              gap: 8px;
              padding: 10px;
            }

            .section-loading-row {
              height: 48px;
              border-radius: var(--r);
              background: var(--bg-3);
              border: 1px solid var(--line);
              opacity: .75;
              animation: closeConfigPulse 1.1s ease-in-out infinite alternate;
            }

            @keyframes closeConfigPulse {
              from { opacity: .45; }
              to { opacity: .9; }
            }

            .empty-state {
              height: 100%;
              min-height: 220px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 8px;
              text-align: center;
              padding: 20px;
            }

            .empty-icon {
              width: 52px;
              height: 52px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              background: var(--blue-dim);
              border: 1px solid rgba(96,165,250,.25);
              color: var(--blue);
            }

            .empty-text {
              margin: 0;
              font-size: 12px;
              color: var(--txt-3);
            }

            .drag-handle-btn {
              width: 24px;
              height: 24px;
              border-radius: 6px;
              border: 1px solid transparent;
              background: transparent;
              color: var(--txt-3);
              display: inline-flex;
              align-items: center;
              justify-content: center;
              cursor: grab;
            }

            .drag-handle-btn:active {
              cursor: grabbing;
            }

            .drag-handle-btn:hover {
              background: var(--bg-4);
              border-color: var(--line-2);
              color: var(--txt-2);
            }

            .default-badge {
              display: inline-flex;
              align-items: center;
              height: 19px;
              padding: 0 8px;
              border-radius: 999px;
              border: 1px solid rgba(0,201,167,.3);
              background: var(--teal-dim);
              color: var(--teal);
              font-size: 10px;
              letter-spacing: .05em;
              text-transform: uppercase;
              font-weight: 600;
            }

            .row-actions {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              opacity: 0;
              transition: opacity .16s ease;
            }

            .close-config-row:hover .row-actions {
              opacity: 1;
            }

            .toggle-btn {
              border: none;
              background: transparent;
              padding: 0;
              cursor: pointer;
            }

            .toggle-btn:disabled {
              cursor: not-allowed;
            }

            .icon-action-btn {
              width: 28px;
              height: 28px;
              border-radius: var(--r);
              border: 1px solid var(--line-2);
              background: var(--bg-3);
              color: var(--txt-2);
              display: inline-flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              transition: all .16s ease;
            }

            .icon-action-btn:hover:not(:disabled) {
              background: var(--bg-4);
              color: var(--txt);
            }

            .icon-action-btn:disabled {
              opacity: .45;
              cursor: not-allowed;
            }

            .modal-overlay {
              position: fixed;
              inset: 0;
              z-index: 1200;
              background: var(--backdrop);
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 16px;
            }

            .modal-card {
              width: 100%;
              max-width: 420px;
              background: var(--bg-2);
              border: 1px solid var(--line-2);
              border-radius: var(--r-lg);
              box-shadow: var(--shadow-pop);
              padding: 18px;
            }

            .modal-title {
              margin: 0;
              font-size: 16px;
              font-weight: 600;
              color: var(--txt);
            }

            .modal-field {
              margin-top: 12px;
              display: grid;
              gap: 6px;
            }

            .modal-label {
              font-size: 11px;
              letter-spacing: .06em;
              text-transform: uppercase;
              color: var(--txt-2);
              font-weight: 600;
            }

            .modal-input {
              height: 34px;
              border-radius: var(--r);
              border: 1px solid var(--line-2);
              background: var(--bg-3);
              color: var(--txt);
              font-size: 13px;
              padding: 0 10px;
              font-family: var(--font);
              outline: none;
            }

            .modal-input:focus {
              border-color: var(--teal);
              box-shadow: 0 0 0 3px var(--teal-dim);
            }

            .modal-error {
              font-size: 11px;
              color: var(--red);
            }

            .modal-actions {
              margin-top: 16px;
              display: flex;
              justify-content: flex-end;
              gap: 8px;
            }

            .modal-btn {
              height: 32px;
              border-radius: var(--r);
              padding: 0 12px;
              border: 1px solid var(--line-2);
              background: var(--bg-4);
              color: var(--txt-2);
              font-size: 12px;
              font-weight: 500;
              cursor: pointer;
              font-family: var(--font);
            }

            .modal-btn:hover {
              background: var(--bg-5);
              color: var(--txt);
            }

            .modal-btn.primary {
              border-color: var(--teal);
              background: var(--teal);
              color: var(--on-teal);
              font-weight: 600;
            }

            .modal-btn.primary:hover {
              filter: brightness(1.08);
            }

            .modal-btn:disabled {
              opacity: .55;
              cursor: not-allowed;
              filter: none;
            }

            @media (max-width: 1080px) {
              .close-config-grid {
                grid-template-columns: 1fr;
              }
            }
          `}
        </style>

        <header className="close-config-head">
          <div>
            <h1 className="close-config-title">{t('tenantAdmin.closeConfig.title')}</h1>
            <p className="close-config-sub">{t('tenantAdmin.closeConfig.subtitle')}</p>
          </div>

          <div className="close-config-preview" aria-live="polite">
            <span>{t('tenantAdmin.closeConfig.previewLabel')}</span>
            <strong>
              {t('tenantAdmin.closeConfig.previewTypes', { count: previewCounts.types })}
            </strong>
            <span>•</span>
            <strong>
              {t('tenantAdmin.closeConfig.previewOutcomes', { count: previewCounts.outcomes })}
            </strong>
          </div>
        </header>

        <div className="close-config-grid">
          <SectionCard
            kind="types"
            title={t('tenantAdmin.closeConfig.types')}
            eyebrow={t('tenantAdmin.closeConfig.eyebrowTypes')}
            addLabel={t('tenantAdmin.closeConfig.addType')}
            items={typeItems}
            isLoading={typesQuery.isLoading}
            isUpdating={isRowUpdating}
            isDeleting={isRowDeleting}
            blockedIds={blockedTypeIds}
            canManage={canManageCloseConfig}
            t={t}
            onAdd={openCreateModal}
            onToggle={(item) => handleToggle(item, 'types')}
            onEdit={openEditModal}
            onDelete={handleDelete}
            onReorder={handleReorder}
            sensors={sensors}
          />

          <SectionCard
            kind="outcomes"
            title={t('tenantAdmin.closeConfig.outcomes')}
            eyebrow={t('tenantAdmin.closeConfig.eyebrowOutcomes')}
            addLabel={t('tenantAdmin.closeConfig.addOutcome')}
            items={outcomeItems}
            isLoading={outcomesQuery.isLoading}
            isUpdating={isRowUpdating}
            isDeleting={isRowDeleting}
            blockedIds={blockedOutcomeIds}
            canManage={canManageCloseConfig}
            t={t}
            onAdd={openCreateModal}
            onToggle={(item) => handleToggle(item, 'outcomes')}
            onEdit={openEditModal}
            onDelete={handleDelete}
            onReorder={handleReorder}
            sensors={sensors}
          />
        </div>
      </div>

      {editingState ? (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3 className="modal-title">{modalTitle}</h3>

            <form onSubmit={submitModal}>
              <label className="modal-field">
                <span className="modal-label">{t('tenantAdmin.closeConfig.label')}</span>
                <input
                  className="modal-input"
                  placeholder={t('tenantAdmin.closeConfig.labelPlaceholder')}
                  maxLength={60}
                  {...form.register('label')}
                />
              </label>

              {form.formState.errors.label ? (
                <div className="modal-error">{form.formState.errors.label.message}</div>
              ) : null}

              <div className="modal-actions">
                <button type="button" className="modal-btn" onClick={closeModal} disabled={isModalSaving}>
                  {t('tenantAdmin.common.cancel')}
                </button>
                <button type="submit" className="modal-btn primary" disabled={isModalSaving}>
                  {isModalSaving ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
