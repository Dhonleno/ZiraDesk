import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/ui/Modal';
import {
  adminApi,
  type Department,
  type DepartmentAgent,
  type TenantUser,
} from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { PageShell } from '../../components/layout/PageShell';

// ─── Create Modal ────────────────────────────────────────────────────────────

function CreateDepartmentModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      adminApi.departments.create({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(t('tenantAdmin.departments.created'));
      setName('');
      setDescription('');
      onCreated();
      onClose();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('tenantAdmin.departments.newTitle')}
      maxWidth="sm"
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--txt-2)', fontWeight: 600 }}>
            {t('tenantAdmin.departments.fields.name')} *
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('tenantAdmin.departments.fields.name')}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--txt-2)', fontWeight: 600 }}>
            {t('tenantAdmin.departments.fields.description')}
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('tenantAdmin.departments.fields.description')}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </label>
      </div>
      <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={onClose} style={btnSecondaryStyle}>
          {t('tenantAdmin.departments.cancel')}
        </button>
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={!name.trim() || createMutation.isPending}
          style={{ ...btnPrimaryStyle, opacity: !name.trim() || createMutation.isPending ? 0.6 : 1 }}
        >
          {createMutation.isPending ? t('tenantAdmin.departments.saving') : t('tenantAdmin.departments.save')}
        </button>
      </div>
    </Modal>
  );
}

// ─── Edit Modal ──────────────────────────────────────────────────────────────

function EditDepartmentModal({
  department,
  onClose,
  onUpdated,
}: {
  department: Department | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const [name, setName] = useState(department?.name ?? '');
  const [description, setDescription] = useState(department?.description ?? '');
  const [isActive, setIsActive] = useState(department?.isActive ?? true);

  const updateMutation = useMutation({
    mutationFn: () =>
      adminApi.departments.update(department!.id, {
        name: name.trim(),
        description: description.trim() || '',
        isActive,
      }),
    onSuccess: () => {
      toast.success(t('tenantAdmin.departments.updated'));
      onUpdated();
      onClose();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  return (
    <Modal
      open={!!department}
      onClose={onClose}
      title={t('tenantAdmin.departments.editTitle')}
      maxWidth="sm"
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--txt-2)', fontWeight: 600 }}>
            {t('tenantAdmin.departments.fields.name')} *
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--txt-2)', fontWeight: 600 }}>
            {t('tenantAdmin.departments.fields.description')}
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            style={{ width: 15, height: 15 }}
          />
          <span style={{ fontSize: 13, color: 'var(--txt-2)' }}>
            {t('tenantAdmin.departments.fields.isActive')}
          </span>
        </label>
      </div>
      <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={onClose} style={btnSecondaryStyle}>
          {t('tenantAdmin.departments.cancel')}
        </button>
        <button
          type="button"
          onClick={() => updateMutation.mutate()}
          disabled={!name.trim() || updateMutation.isPending}
          style={{ ...btnPrimaryStyle, opacity: !name.trim() || updateMutation.isPending ? 0.6 : 1 }}
        >
          {updateMutation.isPending ? t('tenantAdmin.departments.saving') : t('tenantAdmin.departments.save')}
        </button>
      </div>
    </Modal>
  );
}

// ─── Add Agent Modal ─────────────────────────────────────────────────────────

function AddAgentModal({
  departmentId,
  currentAgentIds,
  open,
  onClose,
  onAdded,
}: {
  departmentId: string;
  currentAgentIds: Set<string>;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: usersPage, isLoading } = useQuery({
    queryKey: ['admin', 'users-for-dept'],
    queryFn: () => adminApi.listUsers({ per_page: 200, status: 'active' }),
    enabled: open,
    staleTime: 30_000,
  });

  const users: TenantUser[] = (usersPage?.data ?? []).filter(
    (u) => ['agent', 'admin', 'supervisor', 'owner'].includes(u.role) && !currentAgentIds.has(u.id),
  );

  const filtered = search.trim()
    ? users.filter((u) => u.name.toLowerCase().includes(search.trim().toLowerCase()))
    : users;

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      Promise.all([...selectedIds].map((uid) => adminApi.departments.addAgent(departmentId, uid))),
    onSuccess: () => {
      toast.success(t('tenantAdmin.departments.agentAdded'));
      setSelectedIds(new Set());
      setSearch('');
      onAdded();
      onClose();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  return (
    <Modal
      open={open}
      onClose={() => { setSelectedIds(new Set()); setSearch(''); onClose(); }}
      title={t('tenantAdmin.departments.addAgentTitle')}
      maxWidth="sm"
    >
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('tenantAdmin.departments.searchAgent')}
        style={{ ...inputStyle, marginBottom: 10 }}
      />
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'grid', gap: 6 }}>
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)' }} />
          ))
        ) : filtered.length === 0 ? (
          <p style={{ color: 'var(--txt-3)', fontSize: 13 }}>{t('tenantAdmin.departments.noUsersFound')}</p>
        ) : filtered.map((user) => (
          <label
            key={user.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r)',
              background: selectedIds.has(user.id) ? 'var(--teal-dim)' : 'var(--bg-3)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={selectedIds.has(user.id)}
              onChange={() => toggle(user.id)}
              style={{ width: 14, height: 14 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{user.name}</div>
              <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{user.role}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button type="button" onClick={onClose} style={btnSecondaryStyle}>
          {t('tenantAdmin.departments.cancel')}
        </button>
        <button
          type="button"
          onClick={() => addMutation.mutate()}
          disabled={selectedIds.size === 0 || addMutation.isPending}
          style={{ ...btnPrimaryStyle, opacity: selectedIds.size === 0 || addMutation.isPending ? 0.6 : 1 }}
        >
          {addMutation.isPending
            ? t('tenantAdmin.departments.saving')
            : t('tenantAdmin.departments.addAgentConfirm', { count: selectedIds.size })}
        </button>
      </div>
    </Modal>
  );
}

// ─── Delete Confirmation Modal ────────────────────────────────────────────────

function DeleteDepartmentModal({
  department,
  onClose,
  onDeleted,
}: {
  department: Department | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();

  const deleteMutation = useMutation({
    mutationFn: () => adminApi.departments.delete(department!.id),
    onSuccess: () => {
      toast.success(t('tenantAdmin.departments.deleted'));
      onDeleted();
      onClose();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  return (
    <Modal
      open={!!department}
      onClose={onClose}
      title={t('tenantAdmin.departments.confirmDelete')}
      maxWidth="sm"
    >
      <p style={{ color: 'var(--txt-2)', fontSize: 13, margin: '0 0 4px' }}>
        <strong style={{ color: 'var(--txt)' }}>{department?.name}</strong>
      </p>
      <p style={{ color: 'var(--txt-2)', fontSize: 13, margin: 0 }}>
        {t('tenantAdmin.departments.confirmDeleteBody')}
      </p>
      <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={onClose} style={btnSecondaryStyle}>
          {t('tenantAdmin.departments.cancel')}
        </button>
        <button
          type="button"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          style={{
            border: '1px solid var(--red, #e53e3e)',
            background: 'var(--red, #e53e3e)',
            color: '#fff',
            borderRadius: 'var(--r)',
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: deleteMutation.isPending ? 0.7 : 1,
          }}
        >
          {deleteMutation.isPending ? t('tenantAdmin.departments.deleting') : t('tenantAdmin.departments.delete')}
        </button>
      </div>
    </Modal>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r)',
  background: 'var(--bg-3)',
  color: 'var(--txt)',
  padding: '8px 10px',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

const btnPrimaryStyle: React.CSSProperties = {
  border: '1px solid var(--teal)',
  background: 'var(--teal)',
  color: '#0E1A18',
  borderRadius: 'var(--r)',
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnSecondaryStyle: React.CSSProperties = {
  border: '1px solid var(--line-2)',
  background: 'var(--bg-4)',
  color: 'var(--txt-2)',
  borderRadius: 'var(--r)',
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Departments() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Department | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [showAddAgent, setShowAddAgent] = useState(false);

  const { data: departments = [], isLoading: loadingDepts } = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: adminApi.departments.list,
  });

  const selectedDept = departments.find((d) => d.id === selectedId) ?? null;

  const { data: agents = [], isLoading: loadingAgents } = useQuery({
    queryKey: ['admin', 'department-agents', selectedId],
    queryFn: () => adminApi.departments.listAgents(selectedId!),
    enabled: !!selectedId,
  });

  const currentAgentIds = new Set(agents.map((a: DepartmentAgent) => a.id));

  const invalidateDepts = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] });
  };

  const invalidateAgents = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'department-agents', selectedId] });
    await invalidateDepts();
  };

  const removeAgentMutation = useMutation({
    mutationFn: (userId: string) => adminApi.departments.removeAgent(selectedId!, userId),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.departments.agentRemoved'));
      await invalidateAgents();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  return (
    <PageShell padding={0}>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>
            {t('tenantAdmin.departments.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
            {t('tenantAdmin.departments.subtitle')}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16 }}>

          {/* ── Coluna esquerda: lista de departamentos ── */}
          <section className="rounded-xl p-4" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 15, color: 'var(--txt)' }}>
                {t('tenantAdmin.departments.title')}
              </h2>
              <button type="button" onClick={() => setShowCreate(true)} style={btnPrimaryStyle}>
                + {t('tenantAdmin.departments.new')}
              </button>
            </div>

            {loadingDepts ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-14 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)' }} />
                ))}
              </div>
            ) : departments.length === 0 ? (
              <p style={{ color: 'var(--txt-3)', fontSize: 13 }}>{t('tenantAdmin.departments.empty')}</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {departments.map((dept) => (
                  <div
                    key={dept.id}
                    onClick={() => setSelectedId(dept.id === selectedId ? null : dept.id)}
                    style={{
                      border: `1px solid ${dept.id === selectedId ? 'var(--teal)' : 'var(--line)'}`,
                      borderRadius: 'var(--r)',
                      background: dept.id === selectedId ? 'var(--teal-dim)' : 'var(--bg-3)',
                      padding: '10px 12px',
                      cursor: 'pointer',
                      display: 'grid',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <strong style={{ color: 'var(--txt)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {dept.name}
                          </strong>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: '1px 6px',
                              borderRadius: 10,
                              background: dept.isActive ? 'var(--teal-dim)' : 'var(--bg-4)',
                              color: dept.isActive ? 'var(--teal)' : 'var(--txt-3)',
                              flexShrink: 0,
                            }}
                          >
                            {dept.isActive ? t('tenantAdmin.departments.active') : t('tenantAdmin.departments.inactive')}
                          </span>
                        </div>
                        {dept.description ? (
                          <div style={{ color: 'var(--txt-3)', fontSize: 11, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {dept.description}
                          </div>
                        ) : null}
                        <div style={{ color: 'var(--txt-3)', fontSize: 11 }}>
                          {t('tenantAdmin.departments.agentCount', { count: dept.agentCount })}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setEditTarget(dept)}
                          style={btnSecondaryStyle}
                        >
                          {t('tenantAdmin.departments.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(dept)}
                          disabled={dept.agentCount > 0}
                          title={dept.agentCount > 0 ? t('tenantAdmin.departments.hasAgentsWarning') : undefined}
                          style={{
                            ...btnSecondaryStyle,
                            opacity: dept.agentCount > 0 ? 0.4 : 1,
                            cursor: dept.agentCount > 0 ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {t('tenantAdmin.departments.delete')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Coluna direita: agentes do departamento selecionado ── */}
          <section className="rounded-xl p-4" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
            {!selectedDept ? (
              <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--txt-3)', fontSize: 13 }}>
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
                  <circle cx="12" cy="10" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M4 24c0-4.4 3.6-7.5 8-7.5s8 3.1 8 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M22 11v6M25 14h-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <p style={{ margin: 0 }}>{t('tenantAdmin.departments.noSelection')}</p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 15, color: 'var(--txt)' }}>
                    {t('tenantAdmin.departments.agents')} — <span style={{ color: 'var(--teal)' }}>{selectedDept.name}</span>
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowAddAgent(true)}
                    style={btnPrimaryStyle}
                  >
                    + {t('tenantAdmin.departments.addAgent')}
                  </button>
                </div>

                {loadingAgents ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)' }} />
                    ))}
                  </div>
                ) : agents.length === 0 ? (
                  <p style={{ color: 'var(--txt-3)', fontSize: 13 }}>{t('tenantAdmin.departments.emptyAgents')}</p>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {agents.map((agent: DepartmentAgent) => (
                      <div
                        key={agent.id}
                        style={{
                          border: '1px solid var(--line)',
                          borderRadius: 'var(--r)',
                          background: 'var(--bg-3)',
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            className="history-agent-avatar"
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: '50%',
                              background: 'var(--bg-4)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 13,
                              fontWeight: 600,
                              color: 'var(--teal)',
                              overflow: 'hidden',
                              flexShrink: 0,
                            }}
                            aria-hidden
                          >
                            {agent.avatar_url
                              ? <img src={agent.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : agent.name.slice(0, 1).toUpperCase()}
                          </span>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--txt)', fontSize: 13 }}>{agent.name}</div>
                            <div style={{ color: 'var(--txt-3)', fontSize: 11 }}>{agent.role}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAgentMutation.mutate(agent.id)}
                          disabled={removeAgentMutation.isPending}
                          style={btnSecondaryStyle}
                        >
                          {t('tenantAdmin.departments.removeAgent')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {/* ── Modais ── */}
      <CreateDepartmentModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => void invalidateDepts()}
      />

      <EditDepartmentModal
        key={editTarget?.id}
        department={editTarget}
        onClose={() => setEditTarget(null)}
        onUpdated={() => void invalidateDepts()}
      />

      <DeleteDepartmentModal
        department={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          if (deleteTarget?.id === selectedId) setSelectedId(null);
          void invalidateDepts();
        }}
      />

      {selectedId ? (
        <AddAgentModal
          departmentId={selectedId}
          currentAgentIds={currentAgentIds}
          open={showAddAgent}
          onClose={() => setShowAddAgent(false)}
          onAdded={() => void invalidateAgents()}
        />
      ) : null}
    </PageShell>
  );
}
