import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import { Modal } from '../../components/ui/Modal';
import { adminApi, type AgentWithSkills, type Skill } from '../../services/api';
import { useToast } from '../../stores/toast.store';

type SkillLevel = 'junior' | 'intermediate' | 'senior';

type SkillTreeNode = Omit<Skill, 'children'> & {
  children: SkillTreeNode[];
};

function buildOptionTree(options: Skill[]): SkillTreeNode[] {
  const byId = new Map<string, SkillTreeNode>();
  for (const option of options) {
    byId.set(option.id, { ...option, children: [] });
  }

  const roots: SkillTreeNode[] = [];
  for (const option of byId.values()) {
    if (option.parent_option_id && byId.has(option.parent_option_id)) {
      byId.get(option.parent_option_id)!.children.push(option);
    } else {
      roots.push(option);
    }
  }

  const sortNodes = (nodes: SkillTreeNode[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.number - b.number);
    for (const node of nodes) sortNodes(node.children);
  };
  sortNodes(roots);

  return roots;
}

function BotOptionTree({ options, level = 0, t }: { options: SkillTreeNode[]; level?: number; t: TFunction<'admin'> }) {
  return (
    <div style={{ marginLeft: level * 16 }}>
      {options.map((opt) => (
        <div key={opt.id}>
          <div className="bot-option-skill-row">
            <div className="bot-option-info">
              {level > 0 && <span className="tree-line">└</span>}
              <span className="option-number">{opt.number}.</span>
              <span className="option-label">{opt.label}</span>
              {opt.tag && <span className="tag-chip">tag: {opt.tag}</span>}
              <span className="agents-count">{t('tenantAdmin.skills.agentsCount', { count: opt.agents_count })}</span>
            </div>
          </div>
          {opt.children.length > 0 && <BotOptionTree options={opt.children} level={level + 1} t={t} />}
        </div>
      ))}
    </div>
  );
}

function SkillOptionRow({
  option,
  assignedLevels,
  onChange,
  t,
  depth = 0,
}: {
  option: SkillTreeNode;
  assignedLevels: Record<string, SkillLevel>;
  onChange: (optionId: string, assigned: boolean, level: SkillLevel) => void;
  t: TFunction<'admin'>;
  depth?: number;
}) {
  const currentLevel = assignedLevels[option.id];
  const isAssigned = !!currentLevel;

  return (
    <>
      <div className={`skill-option-row ${isAssigned ? 'assigned' : ''}`} style={{ paddingLeft: depth * 20 }}>
        <label className="skill-checkbox">
          <input
            type="checkbox"
            checked={isAssigned}
            onChange={(event) => onChange(option.id, event.target.checked, currentLevel ?? 'intermediate')}
          />
          <span className="option-label">{option.number}. {option.label}</span>
        </label>

        {isAssigned && (
          <select
            value={currentLevel ?? 'intermediate'}
            onChange={(event) => onChange(option.id, true, event.target.value as SkillLevel)}
            className="level-select"
          >
            <option value="junior">{t('tenantAdmin.skills.levels.junior')}</option>
            <option value="intermediate">{t('tenantAdmin.skills.levels.intermediate')}</option>
            <option value="senior">{t('tenantAdmin.skills.levels.senior')}</option>
          </select>
        )}
      </div>

      {option.children.map((child) => (
        <SkillOptionRow
          key={child.id}
          option={child}
          assignedLevels={assignedLevels}
          onChange={onChange}
          t={t}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

export function Skills() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedAgent, setSelectedAgent] = useState<AgentWithSkills | null>(null);
  const [assignedLevels, setAssignedLevels] = useState<Record<string, SkillLevel>>({});
  const [initialLevels, setInitialLevels] = useState<Record<string, SkillLevel>>({});
  const [loadingAgentSkills, setLoadingAgentSkills] = useState(false);

  const { data: botOptions = [], isLoading: loadingOptions } = useQuery({
    queryKey: ['admin', 'skills'],
    queryFn: adminApi.skills.list,
  });

  const { data: agents = [], isLoading: loadingAgents } = useQuery({
    queryKey: ['admin', 'skills', 'agents'],
    queryFn: adminApi.skills.listAgents,
  });

  const tree = useMemo(() => buildOptionTree(botOptions), [botOptions]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'skills'] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'skills', 'agents'] });
    await queryClient.invalidateQueries({ queryKey: ['monitor'] });
  };

  const saveAgentSkillsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) return;

      const allOptionIds = new Set<string>([
        ...Object.keys(initialLevels),
        ...Object.keys(assignedLevels),
      ]);

      const ops: Promise<unknown>[] = [];
      for (const optionId of allOptionIds) {
        const before = initialLevels[optionId];
        const after = assignedLevels[optionId];

        if (!before && after) {
          ops.push(
            adminApi.skills.assignSkill(selectedAgent.id, {
              bot_option_id: optionId,
              level: after,
            }),
          );
          continue;
        }

        if (before && !after) {
          ops.push(adminApi.skills.removeSkill(selectedAgent.id, optionId));
          continue;
        }

        if (before && after && before !== after) {
          ops.push(
            adminApi.skills.assignSkill(selectedAgent.id, {
              bot_option_id: optionId,
              level: after,
            }),
          );
        }
      }

      await Promise.all(ops);
    },
    onSuccess: async () => {
      await invalidate();
      setSelectedAgent(null);
      setAssignedLevels({});
      setInitialLevels({});
      toast.success(t('tenantAdmin.skills.assign'));
    },
    onError: () => toast.error('Erro ao salvar habilidades do agente'),
  });

  const openAgentModal = async (agent: AgentWithSkills) => {
    setSelectedAgent(agent);
    setLoadingAgentSkills(true);
    try {
      const skills = await adminApi.skills.getAgentSkills(agent.id);
      const nextLevels = skills.reduce<Record<string, SkillLevel>>((acc, skill) => {
        acc[skill.bot_option_id] = skill.level;
        return acc;
      }, {});
      setInitialLevels(nextLevels);
      setAssignedLevels(nextLevels);
    } catch {
      toast.error('Erro ao carregar habilidades do agente');
      setSelectedAgent(null);
    } finally {
      setLoadingAgentSkills(false);
    }
  };

  const handleToggleSkill = (optionId: string, assigned: boolean, level: SkillLevel) => {
    setAssignedLevels((current) => {
      if (!assigned) {
        const { [optionId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [optionId]: level };
    });
  };

  return (
    <div className="space-y-6 p-6" style={{ overflowY: 'auto', height: '100%' }}>
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>{t('tenantAdmin.skills.title')}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>{t('tenantAdmin.skills.subtitle')}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16 }}>
        <section className="rounded-xl p-4" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--txt)' }}>{t('tenantAdmin.skills.title')}</h2>
          {loadingOptions ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-10 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)' }} />
              ))}
            </div>
          ) : botOptions.length === 0 ? (
            <div className="empty-state">
              <p>{t('tenantAdmin.skills.noBotOptions')}</p>
              <p>{t('tenantAdmin.skills.noBotOptionsHint')}</p>
              <Link to="/admin/bot">{t('tenantAdmin.skills.goToBot')}</Link>
            </div>
          ) : (
            <BotOptionTree options={tree} t={t} />
          )}
        </section>

        <section className="rounded-xl p-4" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--txt)' }}>Agentes</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {loadingAgents ? (
              Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)' }} />
              ))
            ) : (
              agents.map((agent) => (
                <div
                  key={agent.id}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r)',
                    background: 'var(--bg-3)',
                    padding: '10px 12px',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <strong style={{ color: 'var(--txt)', fontSize: 13 }}>{agent.name}</strong>
                      <div style={{ color: 'var(--txt-3)', fontSize: 11 }}>{agent.role}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openAgentModal(agent)}
                      style={{
                        border: '1px solid var(--line-2)',
                        background: 'var(--bg-4)',
                        color: 'var(--txt-2)',
                        borderRadius: 'var(--r)',
                        padding: '5px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {t('tenantAdmin.skills.assign')}
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {agent.skills?.length ? (
                      agent.skills.map((skill) => (
                        <span key={`${agent.id}-${skill.bot_option_id}`} className="skill-chip-agent">
                          {skill.parent_label && <span className="skill-parent">{skill.parent_label} {'›'} </span>}
                          {skill.label}
                          <span className={`skill-level ${skill.level}`}>
                            {skill.level === 'junior' ? 'J' : skill.level === 'senior' ? 'S' : 'I'}
                          </span>
                        </span>
                      ))
                    ) : (
                      <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('tenantAdmin.skills.agentNoSkills')}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <Modal
        open={!!selectedAgent}
        onClose={() => {
          setSelectedAgent(null);
          setAssignedLevels({});
          setInitialLevels({});
        }}
        title={selectedAgent ? t('tenantAdmin.skills.assignTitle', { name: selectedAgent.name }) : t('tenantAdmin.skills.assign')}
        maxWidth="md"
      >
        <p style={{ color: 'var(--txt-2)', fontSize: 13 }}>
          {t('tenantAdmin.skills.assignHint')}
        </p>

        <div className="skills-tree">
          {loadingAgentSkills ? (
            Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-9 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)', marginTop: 6 }} />
            ))
          ) : (
            tree.map((option) => (
              <SkillOptionRow
                key={option.id}
                option={option}
                assignedLevels={assignedLevels}
                onChange={handleToggleSkill}
                t={t}
              />
            ))
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button
            onClick={() => {
              setSelectedAgent(null);
              setAssignedLevels({});
              setInitialLevels({});
            }}
            style={{
              border: '1px solid var(--line-2)',
              background: 'var(--bg-4)',
              color: 'var(--txt-2)',
              borderRadius: 'var(--r)',
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            Fechar
          </button>
          <button
            onClick={() => saveAgentSkillsMutation.mutate()}
            disabled={saveAgentSkillsMutation.isPending || loadingAgentSkills}
            style={{
              border: '1px solid var(--teal)',
              background: 'var(--teal)',
              color: '#0E1A18',
              borderRadius: 'var(--r)',
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: saveAgentSkillsMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: saveAgentSkillsMutation.isPending ? 0.7 : 1,
            }}
          >
            {saveAgentSkillsMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
