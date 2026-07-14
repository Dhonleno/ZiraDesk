import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../../components/layout/PageShell';
import { Button } from '../../components/ui/Button';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { Modal } from '../../components/ui/Modal';
import {
  adminApi,
  skillsV2Api,
  type SkillV2,
  type SkillV2Agent,
  type SkillV2BotOption,
  type TenantUser,
} from '../../services/api';
import { useToast } from '../../stores/toast.store';

type SkillLevel = 'junior' | 'intermediate' | 'senior';

const LEVELS: SkillLevel[] = ['junior', 'intermediate', 'senior'];

function SkillModal({
  open,
  skill,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  skill: SkillV2 | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: { name: string; description?: string; is_active: boolean }) => void;
}) {
  const { t } = useTranslation('admin');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(skill?.name ?? '');
    setDescription(skill?.description ?? '');
    setIsActive(skill?.is_active ?? true);
  }, [open, skill]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={skill ? t('tenantAdmin.skillsV2.editTitle') : t('tenantAdmin.skillsV2.newTitle')}
      maxWidth="sm"
    >
      <form
        style={{ display: 'grid', gap: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          const payload: { name: string; description?: string; is_active: boolean } = {
            name: name.trim(),
            is_active: isActive,
          };
          if (description.trim()) payload.description = description.trim();
          onSubmit(payload);
        }}
      >
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>{t('tenantAdmin.skillsV2.fields.name')} *</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="zd-input"
            style={inputStyle}
            maxLength={100}
            required
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>{t('tenantAdmin.skillsV2.fields.description')}</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="zd-textarea"
            style={textareaStyle}
            rows={3}
          />
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--txt)', fontSize: 13 }}>
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          {t('tenantAdmin.skillsV2.fields.isActive')}
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('tenantAdmin.common.cancel')}
          </Button>
          <Button type="submit" loading={loading} disabled={!name.trim()}>
            {loading ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AssignAgentModal({
  open,
  currentAgents,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  currentAgents: SkillV2Agent[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (userId: string, level: SkillLevel) => void;
}) {
  const { t } = useTranslation('admin');
  const [userId, setUserId] = useState('');
  const [level, setLevel] = useState<SkillLevel>('intermediate');

  const { data: usersPage, isLoading } = useQuery({
    queryKey: ['admin', 'skills-v2', 'assignable-users'],
    queryFn: () => adminApi.listUsers({ per_page: 100, status: 'active' }),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    setUserId('');
    setLevel('intermediate');
  }, [open]);

  const assigned = useMemo(() => new Set(currentAgents.map((agent) => agent.user_id)), [currentAgents]);
  const users: TenantUser[] = (usersPage?.data ?? []).filter(
    (user) => user.role === 'agent' && !assigned.has(user.id),
  );

  return (
    <Modal open={open} onClose={onClose} title={t('tenantAdmin.skillsV2.assignAgent')} maxWidth="sm">
      <form
        style={{ display: 'grid', gap: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!userId) return;
          onSubmit(userId, level);
        }}
      >
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>{t('tenantAdmin.skillsV2.fields.agent')}</span>
          <select
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            className="zd-input"
            style={inputStyle}
            required
          >
            <option value="">{isLoading ? t('tenantAdmin.common.loading') : t('tenantAdmin.skillsV2.selectAgent')}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>{t('tenantAdmin.skillsV2.fields.level')}</span>
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value as SkillLevel)}
            className="zd-input"
            style={inputStyle}
          >
            {LEVELS.map((item) => (
              <option key={item} value={item}>
                {t(`tenantAdmin.skillsV2.levels.${item}`)}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('tenantAdmin.common.cancel')}
          </Button>
          <Button type="submit" loading={loading} disabled={!userId}>
            {loading ? t('tenantAdmin.common.saving') : t('tenantAdmin.skillsV2.assign')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function SkillsV2() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingSkill, setEditingSkill] = useState<SkillV2 | null>(null);
  const [isSkillModalOpen, setIsSkillModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SkillV2 | null>(null);

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ['admin', 'skills-v2'],
    queryFn: () => skillsV2Api.list(),
  });

  const selectedSkill = skills.find((skill) => skill.id === selectedId) ?? null;

  const { data: agents = [], isLoading: isLoadingAgents } = useQuery({
    queryKey: ['admin', 'skills-v2', selectedId, 'agents'],
    queryFn: () => skillsV2Api.getAgentsBySkill(selectedId!),
    enabled: !!selectedId,
  });

  const { data: botOptions = [], isLoading: isLoadingBotOptions } = useQuery({
    queryKey: ['admin', 'skills-v2', selectedId, 'bot-options'],
    queryFn: () => skillsV2Api.getBotOptionsBySkill(selectedId!),
    enabled: !!selectedId,
  });

  useEffect(() => {
    if (selectedId && skills.some((skill) => skill.id === selectedId)) return;
    setSelectedId(skills[0]?.id ?? null);
  }, [selectedId, skills]);

  const invalidateSkills = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'skills-v2'] });
  };

  const invalidateSelected = () => {
    invalidateSkills();
    void queryClient.invalidateQueries({ queryKey: ['admin', 'skills-v2', selectedId] });
  };

  const createMutation = useMutation({
    mutationFn: skillsV2Api.create,
    onSuccess: (skill) => {
      invalidateSkills();
      setSelectedId(skill.id);
      setIsSkillModalOpen(false);
      toast.success(t('tenantAdmin.skillsV2.messages.created'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name: string; description?: string; is_active: boolean } }) =>
      skillsV2Api.update(id, payload),
    onSuccess: () => {
      invalidateSkills();
      setIsSkillModalOpen(false);
      setEditingSkill(null);
      toast.success(t('tenantAdmin.skillsV2.messages.updated'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const assignMutation = useMutation({
    mutationFn: ({ userId, level }: { userId: string; level: SkillLevel }) =>
      skillsV2Api.assignAgent(userId, { skill_id: selectedId!, level }),
    onSuccess: () => {
      invalidateSelected();
      setIsAssignModalOpen(false);
      toast.success(t('tenantAdmin.skillsV2.messages.agentAssigned'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const removeAgentMutation = useMutation({
    mutationFn: ({ userId, skillId }: { userId: string; skillId: string }) =>
      skillsV2Api.removeAgent(userId, skillId),
    onSuccess: () => {
      invalidateSelected();
      toast.success(t('tenantAdmin.skillsV2.messages.agentRemoved'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const deleteMutation = useMutation<unknown, unknown, SkillV2>({
    mutationFn: async (skill) => {
      if (skill.agent_count > 0 || skill.bot_option_count > 0) {
        return skillsV2Api.update(skill.id, { is_active: false });
      }
      return skillsV2Api.delete(skill.id);
    },
    onSuccess: () => {
      invalidateSkills();
      setDeleteTarget(null);
      toast.success(t('tenantAdmin.skillsV2.messages.deleted'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const openCreate = () => {
    setEditingSkill(null);
    setIsSkillModalOpen(true);
  };

  const openEdit = (skill: SkillV2) => {
    setEditingSkill(skill);
    setIsSkillModalOpen(true);
  };

  const renderList = () => {
    if (isLoading) {
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} style={skeletonStyle} />
          ))}
        </div>
      );
    }

    if (skills.length === 0) {
      return (
        <div className="zd-empty-state" style={{ minHeight: 220 }}>
          <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 600 }}>
            {t('tenantAdmin.skillsV2.emptyTitle')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>{t('tenantAdmin.skillsV2.emptyBody')}</div>
        </div>
      );
    }

    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {skills.map((skill) => (
          <button
            key={skill.id}
            type="button"
            onClick={() => setSelectedId(skill.id)}
            style={{
              ...skillItemStyle,
              borderColor: selectedId === skill.id ? 'var(--teal)' : 'var(--line-2)',
              background: selectedId === skill.id ? 'var(--teal-dim)' : 'var(--bg-2)',
            }}
          >
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: 'block', color: 'var(--txt)', fontSize: 13 }}>{skill.name}</strong>
              <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>
                {t('tenantAdmin.skillsV2.counts', {
                  agents: skill.agent_count,
                  botOptions: skill.bot_option_count,
                })}
              </span>
            </span>
            <span style={skill.is_active ? activeBadgeStyle : inactiveBadgeStyle}>
              {skill.is_active ? t('tenantAdmin.skillsV2.active') : t('tenantAdmin.skillsV2.inactive')}
            </span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <PageShell padding={0}>
      <div className="admin-page-header">
        <div>
          <h1>{t('tenantAdmin.skillsV2.title')}</h1>
          <p>{t('tenantAdmin.skillsV2.subtitle')}</p>
        </div>
        <Button type="button" onClick={openCreate}>
          {t('tenantAdmin.skillsV2.new')}
        </Button>
      </div>

      <div style={{ padding: 24, display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: 18 }}>
        <section style={panelStyle}>
          <div style={panelHeaderStyle}>
            <h2 style={sectionTitleStyle}>{t('tenantAdmin.skillsV2.listTitle')}</h2>
          </div>
          <div style={{ padding: 14 }}>{renderList()}</div>
        </section>

        <section style={panelStyle}>
          {!selectedSkill ? (
            <div className="zd-empty-state" style={{ minHeight: 360 }}>
              <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 600 }}>
                {t('tenantAdmin.skillsV2.selectTitle')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>{t('tenantAdmin.skillsV2.selectBody')}</div>
            </div>
          ) : (
            <SkillDetail
              skill={selectedSkill}
              agents={agents}
              botOptions={botOptions}
              isLoadingAgents={isLoadingAgents}
              isLoadingBotOptions={isLoadingBotOptions}
              onEdit={() => openEdit(selectedSkill)}
              onDelete={() => setDeleteTarget(selectedSkill)}
              onAssignAgent={() => setIsAssignModalOpen(true)}
              onRemoveAgent={(agent) => removeAgentMutation.mutate({ userId: agent.user_id, skillId: selectedSkill.id })}
              isRemovingAgent={removeAgentMutation.isPending}
            />
          )}
        </section>
      </div>

      <SkillModal
        open={isSkillModalOpen}
        skill={editingSkill}
        loading={createMutation.isPending || updateMutation.isPending}
        onClose={() => {
          setIsSkillModalOpen(false);
          setEditingSkill(null);
        }}
        onSubmit={(payload) => {
          if (editingSkill) {
            updateMutation.mutate({ id: editingSkill.id, payload });
            return;
          }
          createMutation.mutate(payload);
        }}
      />

      <AssignAgentModal
        open={isAssignModalOpen}
        currentAgents={agents}
        loading={assignMutation.isPending}
        onClose={() => setIsAssignModalOpen(false)}
        onSubmit={(userId, level) => assignMutation.mutate({ userId, level })}
      />

      <ConfirmModal
        open={!!deleteTarget}
        title={t('tenantAdmin.skillsV2.deleteTitle')}
        message={
          deleteTarget && (deleteTarget.agent_count > 0 || deleteTarget.bot_option_count > 0)
            ? t('tenantAdmin.skillsV2.softDeleteWarning')
            : t('tenantAdmin.skillsV2.deleteWarning')
        }
        confirmLabel={
          deleteTarget && (deleteTarget.agent_count > 0 || deleteTarget.bot_option_count > 0)
            ? t('tenantAdmin.skillsV2.deactivate')
            : t('tenantAdmin.common.remove')
        }
        confirmVariant="danger"
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
      />
    </PageShell>
  );
}

function SkillDetail({
  skill,
  agents,
  botOptions,
  isLoadingAgents,
  isLoadingBotOptions,
  isRemovingAgent,
  onEdit,
  onDelete,
  onAssignAgent,
  onRemoveAgent,
}: {
  skill: SkillV2;
  agents: SkillV2Agent[];
  botOptions: SkillV2BotOption[];
  isLoadingAgents: boolean;
  isLoadingBotOptions: boolean;
  isRemovingAgent: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAssignAgent: () => void;
  onRemoveAgent: (agent: SkillV2Agent) => void;
}) {
  const { t } = useTranslation('admin');

  return (
    <div style={{ display: 'grid', gap: 18, padding: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start' }}>
        <div>
          <span style={{ color: 'var(--txt-3)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
            {t('tenantAdmin.skillsV2.detailEyebrow')}
          </span>
          <h2 style={{ color: 'var(--txt)', fontSize: 20, margin: '6px 0 4px' }}>{skill.name}</h2>
          <p style={{ color: 'var(--txt-2)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
            {skill.description || t('tenantAdmin.skillsV2.noDescription')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
            {t('tenantAdmin.common.edit')}
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={onDelete}>
            {t('tenantAdmin.common.remove')}
          </Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <Metric label={t('tenantAdmin.skillsV2.assignedAgents')} value={agents.length} />
        <Metric label={t('tenantAdmin.skillsV2.linkedBotOptions')} value={botOptions.length} />
      </div>

      <section style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={sectionTitleStyle}>{t('tenantAdmin.skillsV2.assignedAgents')}</h3>
          <Button type="button" size="sm" variant="secondary" onClick={onAssignAgent}>
            {t('tenantAdmin.skillsV2.assignAgent')}
          </Button>
        </div>
        {isLoadingAgents ? (
          <div style={skeletonStyle} />
        ) : agents.length === 0 ? (
          <p style={emptyLineStyle}>{t('tenantAdmin.skillsV2.noAgents')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {agents.map((agent) => (
              <div key={agent.user_id} style={rowStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={avatarStyle}>{agent.name.charAt(0).toUpperCase()}</span>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', color: 'var(--txt)', fontSize: 13 }}>{agent.name}</strong>
                    <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>
                      {t(`tenantAdmin.skillsV2.levels.${agent.level}`)}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isRemovingAgent}
                  onClick={() => onRemoveAgent(agent)}
                >
                  {t('tenantAdmin.common.remove')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ display: 'grid', gap: 10 }}>
        <h3 style={sectionTitleStyle}>{t('tenantAdmin.skillsV2.linkedBotOptions')}</h3>
        {isLoadingBotOptions ? (
          <div style={skeletonStyle} />
        ) : botOptions.length === 0 ? (
          <p style={emptyLineStyle}>{t('tenantAdmin.skillsV2.noBotOptions')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {botOptions.map((option) => (
              <div key={option.bot_option_id} style={rowStyle}>
                <span style={{ minWidth: 0, color: 'var(--txt)', fontSize: 13, fontWeight: 600 }}>
                  {option.parent_label ? `${option.parent_label} / ` : ''}
                  {option.number}. {option.label}
                </span>
                <span style={option.required ? activeBadgeStyle : inactiveBadgeStyle}>
                  {option.required ? t('tenantAdmin.skillsV2.required') : t('tenantAdmin.skillsV2.optional')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: 12, background: 'var(--bg-1)' }}>
      <strong style={{ display: 'block', color: 'var(--txt)', fontSize: 18 }}>{value}</strong>
      <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>{label}</span>
    </div>
  );
}

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--txt-2)',
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r)',
  background: 'var(--bg-2)',
  color: 'var(--txt)',
  padding: '9px 10px',
  fontSize: 13,
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
};

const panelStyle: CSSProperties = {
  minHeight: 520,
  background: 'var(--bg-2)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r-lg)',
  overflow: 'hidden',
};

const panelHeaderStyle: CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid var(--line)',
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  color: 'var(--txt)',
  fontSize: 15,
  fontWeight: 600,
};

const skillItemStyle: CSSProperties = {
  width: '100%',
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'center',
  gap: 10,
  textAlign: 'left',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r)',
  padding: '10px 12px',
  cursor: 'pointer',
};

const activeBadgeStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--teal)',
  background: 'var(--teal-dim)',
  borderRadius: 'var(--r-pill)',
  padding: '2px 7px',
  whiteSpace: 'nowrap',
};

const inactiveBadgeStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--txt-3)',
  background: 'var(--bg-4)',
  borderRadius: 'var(--r-pill)',
  padding: '2px 7px',
  whiteSpace: 'nowrap',
};

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'center',
  gap: 12,
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r)',
  padding: '10px 12px',
  background: 'var(--bg-1)',
};

const avatarStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  background: 'var(--teal-dim)',
  color: 'var(--teal)',
  fontSize: 12,
  fontWeight: 700,
  flexShrink: 0,
};

const emptyLineStyle: CSSProperties = {
  margin: 0,
  color: 'var(--txt-3)',
  fontSize: 12,
  border: '1px dashed var(--line-2)',
  borderRadius: 'var(--r)',
  padding: 12,
};

const skeletonStyle: CSSProperties = {
  height: 48,
  background: 'var(--bg-3)',
  borderRadius: 'var(--r)',
  opacity: 0.55,
};
