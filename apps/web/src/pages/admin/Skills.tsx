import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import { Modal } from '../../components/ui/Modal';
import { adminApi, type AgentWithSkills, type Skill } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { PageShell } from '../../components/layout/PageShell';

type SkillTreeNode = Omit<Skill, 'children'> & {
  children: SkillTreeNode[];
};

type CheckState = 'checked' | 'indeterminate' | 'unchecked';

interface SkillTreeIndex {
  childrenById: Map<string, string[]>;
  parentById: Map<string, string>;
  leafIds: Set<string>;
}

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

function buildTreeIndex(nodes: SkillTreeNode[]): SkillTreeIndex {
  const childrenById = new Map<string, string[]>();
  const parentById = new Map<string, string>();
  const leafIds = new Set<string>();

  const walk = (node: SkillTreeNode) => {
    const childIds = node.children.map((child) => child.id);
    childrenById.set(node.id, childIds);
    if (childIds.length === 0) {
      leafIds.add(node.id);
    }

    for (const child of node.children) {
      parentById.set(child.id, node.id);
      walk(child);
    }
  };

  for (const root of nodes) walk(root);
  return { childrenById, parentById, leafIds };
}

function selectAllDescendants(nodeId: string, index: SkillTreeIndex): string[] {
  const descendants: string[] = [];
  const stack = [...(index.childrenById.get(nodeId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop()!;
    descendants.push(current);
    const children = index.childrenById.get(current) ?? [];
    for (const childId of children) stack.push(childId);
  }

  return descendants;
}

function getParentState(nodeId: string, selectedIds: Set<string>, index: SkillTreeIndex): CheckState {
  const childIds = index.childrenById.get(nodeId) ?? [];
  if (childIds.length === 0) {
    return selectedIds.has(nodeId) ? 'checked' : 'unchecked';
  }

  const states = childIds.map((childId) => getParentState(childId, selectedIds, index));
  const allChecked = states.every((state) => state === 'checked');
  const allUnchecked = states.every((state) => state === 'unchecked');

  if (allChecked) return 'checked';
  if (allUnchecked) return 'unchecked';
  return 'indeterminate';
}

function BotOptionTree({ options, level = 0, t }: { options: SkillTreeNode[]; level?: number; t: TFunction<'admin'> }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {options.map((opt) => {
        const isParent = opt.children.length > 0;

        return (
          <div key={opt.id} style={{ display: 'grid', gap: 6 }}>
            <div
              className="bot-option-skill-row"
              style={{
                marginLeft: isParent ? level * 12 : level * 12 + 14,
                background: isParent ? 'var(--bg-3)' : undefined,
                borderColor: isParent ? 'var(--line-2)' : undefined,
                fontWeight: isParent ? 700 : 500,
                textTransform: isParent ? 'uppercase' : undefined,
                letterSpacing: isParent ? 0.4 : undefined,
              }}
            >
              <div className="bot-option-info">
                {isParent ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span className="tree-line">└</span>
                )}
                <span className="option-number">{opt.number}.</span>
                <span className="option-label">{opt.label}</span>
                {opt.tag && <span className="tag-chip">tag: {opt.tag}</span>}
                <span className="agents-count">{t('tenantAdmin.skills.agentsCount', { count: opt.agents_count })}</span>
              </div>
            </div>
            {opt.children.length > 0 && <BotOptionTree options={opt.children} level={level + 1} t={t} />}
          </div>
        );
      })}
    </div>
  );
}

function SkillOptionRow({
  option,
  onToggle,
  getNodeState,
  depth = 0,
}: {
  option: SkillTreeNode;
  onToggle: (optionId: string, assigned: boolean) => void;
  getNodeState: (optionId: string) => CheckState;
  depth?: number;
}) {
  const nodeState = getNodeState(option.id);
  const isAssigned = nodeState === 'checked';
  const isParent = option.children.length > 0;
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!checkboxRef.current) return;
    checkboxRef.current.indeterminate = nodeState === 'indeterminate';
  }, [nodeState]);

  return (
    <>
      <div
        className={`skill-option-row ${isAssigned ? 'assigned' : ''}`}
        style={{
          paddingLeft: Math.max(0, depth) * 16 + 12,
          background: isParent ? 'var(--bg-3)' : undefined,
          borderColor: isParent ? 'var(--line-2)' : undefined,
        }}
      >
        <label className="skill-checkbox">
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={isAssigned}
            onChange={(event) => onToggle(option.id, event.target.checked)}
          />
          {isParent ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          ) : depth > 0 ? (
            <span className="tree-line">└</span>
          ) : null}
          <span className="option-label">{option.number}. {option.label}</span>
        </label>
      </div>

      {option.children.map((child) => (
        <SkillOptionRow
          key={child.id}
          option={child}
          onToggle={onToggle}
          getNodeState={getNodeState}
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
  const [agentSearch, setAgentSearch] = useState('');
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [initialSelectedSkillIds, setInitialSelectedSkillIds] = useState<Set<string>>(new Set());
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
  const treeIndex = useMemo(() => buildTreeIndex(tree), [tree]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'skills'] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'skills', 'agents'] });
    await queryClient.invalidateQueries({ queryKey: ['monitor'] });
  };

  const saveAgentSkillsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) return;

      const allOptionIds = new Set<string>([
        ...Array.from(initialSelectedSkillIds),
        ...Array.from(selectedSkillIds),
      ]);

      const ops: Promise<unknown>[] = [];
      for (const optionId of allOptionIds) {
        const before = initialSelectedSkillIds.has(optionId);
        const after = selectedSkillIds.has(optionId);

        if (!before && after) {
          ops.push(adminApi.skills.assignSkill(selectedAgent.id, { bot_option_id: optionId }));
        }

        if (before && !after) {
          ops.push(adminApi.skills.removeSkill(selectedAgent.id, optionId));
        }
      }

      await Promise.all(ops);
    },
    onSuccess: async () => {
      await invalidate();
      setSelectedAgent(null);
      setSelectedSkillIds(new Set());
      setInitialSelectedSkillIds(new Set());
      toast.success(t('tenantAdmin.skills.saved'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const openAgentModal = async (agent: AgentWithSkills) => {
    setSelectedAgent(agent);
    setLoadingAgentSkills(true);
    try {
      const skills = await adminApi.skills.getAgentSkills(agent.id);
      const selectedIds = new Set(skills.map((skill) => skill.bot_option_id));
      setInitialSelectedSkillIds(new Set(selectedIds));
      setSelectedSkillIds(new Set(selectedIds));
    } catch {
      toast.error(t('tenantAdmin.common.errorLoad'));
      setSelectedAgent(null);
    } finally {
      setLoadingAgentSkills(false);
    }
  };

  const syncAncestors = (optionId: string, selectedIds: Set<string>) => {
    let parentId = treeIndex.parentById.get(optionId);
    while (parentId) {
      const state = getParentState(parentId, selectedIds, treeIndex);
      if (state === 'checked') {
        selectedIds.add(parentId);
      } else {
        selectedIds.delete(parentId);
      }
      parentId = treeIndex.parentById.get(parentId);
    }
  };

  const handleToggleSkill = (optionId: string, assigned: boolean) => {
    setSelectedSkillIds((currentSelected) => {
      const nextSelected = new Set(currentSelected);
      const cascadeIds = [optionId, ...selectAllDescendants(optionId, treeIndex)];

      if (assigned) {
        for (const id of cascadeIds) {
          nextSelected.add(id);
        }
      } else {
        for (const id of cascadeIds) {
          nextSelected.delete(id);
        }
      }

      syncAncestors(optionId, nextSelected);
      return nextSelected;
    });
  };

  const getNodeState = (optionId: string): CheckState => {
    return getParentState(optionId, selectedSkillIds, treeIndex);
  };

  const normalizedAgentSearch = agentSearch.trim().toLowerCase();
  const filteredAgents = normalizedAgentSearch
    ? agents.filter((agent) => agent.name.toLowerCase().includes(normalizedAgentSearch))
    : agents;

  return (
    <PageShell padding={0}>
      <div className="space-y-6 p-6">
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, color: 'var(--txt)' }}>
              {t('tenantAdmin.skills.agents')}
            </h2>
            <input
              type="search"
              value={agentSearch}
              onChange={(event) => setAgentSearch(event.target.value)}
              placeholder={t('tenantAdmin.skills.searchAgent')}
              aria-label={t('tenantAdmin.skills.searchAgent')}
              style={{
                width: 220,
                maxWidth: '100%',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r)',
                background: 'var(--bg-3)',
                color: 'var(--txt)',
                padding: '7px 10px',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {loadingAgents ? (
              Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)' }} />
              ))
            ) : filteredAgents.length === 0 ? (
              <div className="empty-state">
                <p>{agentSearch ? t('tenantAdmin.skills.noAgentsFound') : t('tenantAdmin.skills.noAgents')}</p>
              </div>
            ) : (
              filteredAgents.map((agent) => (
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
          setSelectedSkillIds(new Set());
          setInitialSelectedSkillIds(new Set());
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
                onToggle={handleToggleSkill}
                getNodeState={getNodeState}
              />
            ))
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={() => {
              setSelectedAgent(null);
              setSelectedSkillIds(new Set());
              setInitialSelectedSkillIds(new Set());
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
            {t('tenantAdmin.skills.close')}
          </button>
          <button
            type="button"
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
            {saveAgentSkillsMutation.isPending
              ? t('tenantAdmin.skills.saving')
              : t('tenantAdmin.skills.save')}
          </button>
        </div>
      </Modal>
      </div>
    </PageShell>
  );
}
