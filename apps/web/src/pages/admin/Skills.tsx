import { useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/ui/Modal';
import {
  adminApi,
  type AgentSkill,
  type AgentWithSkills,
  type Skill,
} from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface AgentSkillEditorState {
  enabled: boolean;
  level: 'junior' | 'intermediate' | 'senior';
}

function levelClass(level: string): string {
  if (level === 'junior') return 'skill-level-junior';
  if (level === 'senior') return 'skill-level-senior';
  return 'skill-level-intermediate';
}

export function Skills() {
  const { t } = useTranslation('omnichannel');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: '', tag: '', color: '#00C9A7' });
  const [selectedAgent, setSelectedAgent] = useState<AgentWithSkills | null>(null);
  const [editorState, setEditorState] = useState<Record<string, AgentSkillEditorState>>({});

  const { data: skills = [], isLoading: loadingSkills } = useQuery({
    queryKey: ['admin', 'skills'],
    queryFn: adminApi.skills.list,
  });

  const { data: agents = [], isLoading: loadingAgents } = useQuery({
    queryKey: ['admin', 'skills', 'agents'],
    queryFn: adminApi.skills.listAgents,
  });

  const skillsCountById = useMemo(() => {
    const counter: Record<string, number> = {};
    for (const agent of agents) {
      for (const skill of agent.skills ?? []) {
        counter[skill.id] = (counter[skill.id] ?? 0) + 1;
      }
    }
    return counter;
  }, [agents]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'skills'] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'skills', 'agents'] });
    await queryClient.invalidateQueries({ queryKey: ['monitor'] });
  };

  const createSkillMutation = useMutation({
    mutationFn: () => adminApi.skills.create({
      name: newSkill.name.trim(),
      tag: newSkill.tag.trim() || null,
      color: newSkill.color,
    }),
    onSuccess: async () => {
      setShowCreate(false);
      setNewSkill({ name: '', tag: '', color: '#00C9A7' });
      await invalidate();
      toast.success(t('skills.new'));
    },
    onError: () => toast.error('Erro ao criar habilidade'),
  });

  const saveAgentSkillsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) return;

      const currentBySkill = new Map(selectedAgent.skills.map((skill) => [skill.id, skill]));
      const ops: Promise<unknown>[] = [];

      for (const skill of skills) {
        const state = editorState[skill.id];
        const existing = currentBySkill.get(skill.id);

        if (state?.enabled) {
          if (!existing || existing.level !== state.level) {
            ops.push(adminApi.skills.assignSkill(selectedAgent.id, {
              skill_id: skill.id,
              level: state.level,
            }));
          }
        } else if (existing) {
          ops.push(adminApi.skills.removeSkill(selectedAgent.id, skill.id));
        }
      }

      await Promise.all(ops);
    },
    onSuccess: async () => {
      await invalidate();
      setSelectedAgent(null);
      setEditorState({});
      toast.success(t('skills.assign'));
    },
    onError: () => toast.error('Erro ao salvar habilidades do agente'),
  });

  const openAgentModal = (agent: AgentWithSkills) => {
    const nextState: Record<string, AgentSkillEditorState> = {};

    for (const skill of skills) {
      const current = (agent.skills as AgentSkill[]).find((item) => item.id === skill.id);
      nextState[skill.id] = {
        enabled: !!current,
        level: current?.level ?? 'intermediate',
      };
    }

    setSelectedAgent(agent);
    setEditorState(nextState);
  };

  return (
    <div className="space-y-6 p-6" style={{ overflowY: 'auto', height: '100%' }}>
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>{t('skills.title')}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>{t('skills.subtitle')}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16 }}>
        <section className="rounded-xl p-4" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, color: 'var(--txt)' }}>{t('skills.title')}</h2>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowCreate((current) => !current)}
              style={{
                border: '1px solid var(--teal)',
                background: 'var(--teal)',
                color: '#0E1A18',
                borderRadius: 'var(--r)',
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {t('skills.new')}
            </button>
          </div>

          {showCreate && (
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              <input
                value={newSkill.name}
                onChange={(event) => setNewSkill((current) => ({ ...current, name: event.target.value }))}
                placeholder="Nome"
                style={inputStyle}
              />
              <input
                value={newSkill.tag}
                onChange={(event) => setNewSkill((current) => ({ ...current, tag: event.target.value }))}
                placeholder="Tag"
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="color"
                  value={newSkill.color}
                  onChange={(event) => setNewSkill((current) => ({ ...current, color: event.target.value }))}
                  style={{ width: 44, height: 36, padding: 0, border: '1px solid var(--line)', borderRadius: 'var(--r)' }}
                />
                <button
                  type="button"
                  onClick={() => createSkillMutation.mutate()}
                  disabled={!newSkill.name.trim() || createSkillMutation.isPending}
                  style={saveButtonStyle}
                >
                  Salvar
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            {loadingSkills ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)' }} />
              ))
            ) : skills.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--txt-3)', fontSize: 13 }}>{t('skills.noSkills')}</p>
            ) : (
              skills.map((skill: Skill) => (
                <div
                  key={skill.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r)',
                    padding: '10px 12px',
                    background: 'var(--bg-3)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ color: 'var(--txt)', fontSize: 13 }}>{skill.name}</strong>
                      {skill.tag && (
                        <span style={{ color: 'var(--txt-3)', fontSize: 11, fontFamily: 'var(--mono)' }}>
                          {skill.tag}
                        </span>
                      )}
                    </div>
                    <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>
                      {skillsCountById[skill.id] ?? 0} agentes
                    </span>
                  </div>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: skill.color,
                      border: '1px solid rgba(255,255,255,.2)',
                    }}
                  />
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl p-4" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--txt)' }}>Agentes</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {loadingAgents ? (
              Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--bg-3)' }} />
              ))
            ) : (
              agents.map((agent: AgentWithSkills) => (
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
                      onClick={() => openAgentModal(agent)}
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
                      {t('skills.assign')}
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {agent.skills?.length ? (
                      agent.skills.map((skill) => (
                        <span
                          key={`${agent.id}-${skill.id}`}
                          className={`skill-chip ${levelClass(skill.level)}`}
                          style={{
                            color: skill.color,
                            background: `${skill.color}22`,
                            borderColor: `${skill.color}44`,
                          }}
                        >
                          {skill.name}
                          <small style={{ opacity: 0.9 }}>{t(`skills.levels.${skill.level}`)}</small>
                        </span>
                      ))
                    ) : (
                      <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('skills.agentNoSkills')}</span>
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
          setEditorState({});
        }}
        title={selectedAgent ? `${t('skills.assign')} - ${selectedAgent.name}` : t('skills.assign')}
        maxWidth="md"
      >
        <div style={{ display: 'grid', gap: 8 }}>
          {skills.map((skill) => {
            const state = editorState[skill.id] ?? { enabled: false, level: 'intermediate' as const };
            return (
              <div
                key={skill.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 170px',
                  alignItems: 'center',
                  gap: 8,
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r)',
                  padding: '8px 10px',
                  background: 'var(--bg-3)',
                }}
              >
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--txt)', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={state.enabled}
                    onChange={(event) => setEditorState((current) => ({
                      ...current,
                      [skill.id]: {
                        ...state,
                        enabled: event.target.checked,
                      },
                    }))}
                  />
                  <span>{skill.name}</span>
                </label>

                <select
                  value={state.level}
                  disabled={!state.enabled}
                  onChange={(event) => setEditorState((current) => ({
                    ...current,
                    [skill.id]: {
                      ...state,
                      level: event.target.value as 'junior' | 'intermediate' | 'senior',
                    },
                  }))}
                  style={{
                    ...inputStyle,
                    height: 32,
                    opacity: state.enabled ? 1 : 0.55,
                  }}
                >
                  <option value="junior">{t('skills.levels.junior')}</option>
                  <option value="intermediate">{t('skills.levels.intermediate')}</option>
                  <option value="senior">{t('skills.levels.senior')}</option>
                </select>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button
            type="button"
            onClick={() => {
              setSelectedAgent(null);
              setEditorState({});
            }}
            style={{ ...saveButtonStyle, background: 'var(--bg-4)', color: 'var(--txt-2)', border: '1px solid var(--line-2)' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => saveAgentSkillsMutation.mutate()}
            disabled={saveAgentSkillsMutation.isPending}
            style={saveButtonStyle}
          >
            {saveAgentSkillsMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

const inputStyle: CSSProperties = {
  background: 'var(--bg-3)',
  border: '1px solid var(--line)',
  color: 'var(--txt)',
  borderRadius: 'var(--r)',
  height: 36,
  padding: '0 10px',
  fontSize: 13,
  width: '100%',
};

const saveButtonStyle: CSSProperties = {
  border: '1px solid var(--teal)',
  background: 'var(--teal)',
  color: '#0E1A18',
  borderRadius: 'var(--r)',
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
