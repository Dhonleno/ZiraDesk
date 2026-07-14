import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  skillsV2Api,
  type BotMenu as BotMenuData,
  type BotOption,
  type BotOptionPayload,
  type BotOptionSkill,
  type SkillV2,
} from '../../services/api';
import { PageShell } from '../../components/layout/PageShell';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../stores/toast.store';

interface OptionModalProps {
  open: boolean;
  option?: BotOption | null;
  parentOption?: BotOption | null;
  defaultSortOrder: number;
  onClose: () => void;
  onSubmit: (payload: BotOptionPayload) => void;
  isSaving: boolean;
  availableSkills: SkillV2[];
  selectedSkills: BotOptionSkill[];
  onSkillsChange: (skills: BotOptionSkill[]) => void;
  isLoadingSkills: boolean;
}

function buildPreview(menu: Pick<BotMenuData, 'greeting' | 'footer' | 'options'>) {
  const optionLines = menu.options
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((option) => `${option.number}. ${option.label}`);

  return [menu.greeting, '', ...optionLines, '', menu.footer ?? ''].join('\n').trim();
}

function flattenOptions(options: BotOption[]): BotOption[] {
  const list: BotOption[] = [];

  const visit = (nodes: BotOption[]) => {
    nodes
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.number - b.number)
      .forEach((node) => {
        list.push(node);
        if (node.children?.length) visit(node.children);
      });
  };

  visit(options);
  return list;
}

function OptionModal({
  open,
  option,
  parentOption,
  defaultSortOrder,
  onClose,
  onSubmit,
  isSaving,
  availableSkills,
  selectedSkills,
  onSkillsChange,
  isLoadingSkills,
}: OptionModalProps) {
  const { t } = useTranslation('admin');
  const [number, setNumber] = useState(1);
  const [label, setLabel] = useState('');
  const [tag, setTag] = useState('');
  const [response, setResponse] = useState('');
  const [hasSubmenu, setHasSubmenu] = useState(false);
  const [submenuGreeting, setSubmenuGreeting] = useState('');
  const activeSkills = availableSkills.filter((skill) => skill.is_active);

  useEffect(() => {
    if (!open) return;
    setNumber(option?.number ?? 1);
    setLabel(option?.label ?? '');
    setTag(option?.tag ?? '');
    setResponse(option?.response ?? 'Transferindo para um atendente. Aguarde...');
    setHasSubmenu(option?.has_submenu ?? false);
    setSubmenuGreeting(option?.submenu_greeting ?? '');
  }, [open, option]);

  const selectedSkillMap = useMemo(
    () => new Map(selectedSkills.map((skill) => [skill.skill_id, skill])),
    [selectedSkills],
  );

  const toggleSkill = (skill: SkillV2) => {
    const existing = selectedSkillMap.get(skill.id);
    if (existing) {
      onSkillsChange(selectedSkills.filter((item) => item.skill_id !== skill.id));
      return;
    }

    onSkillsChange([
      ...selectedSkills,
      {
        skill_id: skill.id,
        skill_name: skill.name,
        required: true,
      },
    ]);
  };

  const toggleRequired = (skillId: string) => {
    onSkillsChange(
      selectedSkills.map((item) =>
        item.skill_id === skillId ? { ...item, required: !item.required } : item,
      ),
    );
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={option ? t('tenantAdmin.bot.editOption') : t('tenantAdmin.bot.addOption')}
      maxWidth="md"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const payload: BotOptionPayload = {
            number,
            label,
            tag: tag.trim() || null,
            has_submenu: hasSubmenu,
            submenu_greeting: hasSubmenu ? submenuGreeting : null,
            response: hasSubmenu ? response || null : response,
            sort_order: option?.sort_order ?? defaultSortOrder,
          };

          onSubmit(payload);
        }}
        style={{ display: 'grid', gap: 14 }}
      >
        {parentOption ? (
          <p style={{ margin: 0, color: 'var(--txt-2)', fontSize: 12 }}>
            {t('tenantAdmin.bot.parentOption')}: <strong style={{ color: 'var(--txt)' }}>{parentOption.label}</strong>
          </p>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={labelStyle}>{t('tenantAdmin.bot.option.number')}</span>
            <input
              type="number"
              min={0}
              value={number}
              aria-label={t('tenantAdmin.bot.option.number')}
              className="zd-input"
              onChange={(event) => setNumber(Number(event.target.value))}
              style={inputStyle}
              required
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={labelStyle}>{t('tenantAdmin.bot.option.label')}</span>
            <input
              value={label}
              aria-label={t('tenantAdmin.bot.option.label')}
              className="zd-input"
              onChange={(event) => setLabel(event.target.value)}
              style={inputStyle}
              maxLength={100}
              required
            />
          </label>
        </div>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>{t('tenantAdmin.bot.option.tag')}</span>
          <input
            value={tag}
            aria-label={t('tenantAdmin.bot.option.tag')}
            className="zd-input"
            onChange={(event) => setTag(event.target.value)}
            style={inputStyle}
            maxLength={50}
          />
          <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>{t('tenantAdmin.bot.option.tagHint')}</span>
        </label>

        <section style={{ display: 'grid', gap: 8 }}>
          <div>
            <span style={labelStyle}>{t('tenantAdmin.bot.requiredSkills')}</span>
            <p style={{ color: 'var(--txt-3)', fontSize: 11, margin: '4px 0 0' }}>
              {t('tenantAdmin.bot.requiredSkillsHint')}
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gap: 6,
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r)',
              padding: 10,
              background: 'var(--bg-1)',
              maxHeight: 180,
              overflow: 'auto',
            }}
          >
            {isLoadingSkills ? (
              <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>
                {t('tenantAdmin.common.loading')}
              </span>
            ) : activeSkills.length === 0 ? (
              <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>
                {t('tenantAdmin.bot.noSkillsAvailable')}
              </span>
            ) : (
              activeSkills.map((skill) => {
                const selected = selectedSkillMap.get(skill.id);
                return (
                  <div
                    key={skill.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 8px',
                      borderRadius: 'var(--r-sm)',
                      background: selected ? 'var(--bg-2)' : 'transparent',
                    }}
                  >
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        color: 'var(--txt)',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!selected}
                        disabled={isSaving}
                        onChange={() => toggleSkill(skill)}
                      />
                      {skill.name}
                    </label>

                    {selected ? (
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          color: 'var(--txt-2)',
                          fontSize: 12,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected.required}
                          disabled={isSaving}
                          onChange={() => toggleRequired(skill.id)}
                        />
                        {t('tenantAdmin.bot.skillRequired')}
                      </label>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--txt)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <input
            type="checkbox"
            checked={hasSubmenu}
            aria-label={t('tenantAdmin.bot.submenu')}
            onChange={(event) => setHasSubmenu(event.target.checked)}
          />
          {t('tenantAdmin.bot.submenu')}
        </label>

        {hasSubmenu ? (
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={labelStyle}>{t('tenantAdmin.bot.submenuGreeting')}</span>
            <textarea
              value={submenuGreeting}
              aria-label={t('tenantAdmin.bot.submenuGreeting')}
              className="zd-textarea"
              onChange={(event) => setSubmenuGreeting(event.target.value)}
              rows={3}
              style={textareaStyle}
              required
            />
          </label>
        ) : (
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={labelStyle}>{t('tenantAdmin.bot.option.response')}</span>
            <textarea
              value={response}
              aria-label={t('tenantAdmin.bot.option.response')}
              className="zd-textarea"
              onChange={(event) => setResponse(event.target.value)}
              rows={4}
              style={textareaStyle}
              required
            />
          </label>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('tenantAdmin.common.cancel')}
          </Button>
          <Button type="submit" loading={isSaving}>
            {isSaving ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface OptionNodeProps {
  option: BotOption;
  level: number;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onAddSub: (option: BotOption) => void;
  onEdit: (option: BotOption) => void;
  onDelete: (option: BotOption) => void;
  onEnableSubmenu: (option: BotOption) => void;
}

function OptionNode({
  option,
  level,
  expandedIds,
  onToggleExpanded,
  onAddSub,
  onEdit,
  onDelete,
  onEnableSubmenu,
}: OptionNodeProps) {
  const { t } = useTranslation('admin');
  const hasChildren = (option.children?.length ?? 0) > 0;
  const isExpanded = expandedIds.has(option.id);
  const indent = level * 18;

  return (
    <div style={{ marginLeft: indent }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--bg-2)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ color: 'var(--txt)', fontSize: 13 }}>
              {option.number}. {option.label}
            </strong>

            <span
              style={{
                fontSize: 10,
                color: option.has_submenu ? 'var(--amber)' : 'var(--txt-3)',
                background: option.has_submenu ? 'var(--amber-dim)' : 'var(--bg-4)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r-pill)',
                padding: '1px 7px',
              }}
            >
              {option.has_submenu
                ? `${t('tenantAdmin.bot.submenu')} (${option.children?.length ?? 0})`
                : t('tenantAdmin.bot.leaf')}
            </span>

            <span
              style={{
                fontSize: 10,
                color: 'var(--txt-3)',
                background: 'var(--bg-4)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r-pill)',
                padding: '1px 7px',
              }}
            >
              {t('tenantAdmin.bot.depth', { n: level + 1 })}
            </span>

            {option.tag ? (
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--blue)',
                  background: 'var(--blue-dim)',
                  border: '1px solid rgba(96,165,250,.2)',
                  borderRadius: 'var(--r-pill)',
                  padding: '1px 7px',
                }}
              >
                tag: {option.tag}
              </span>
            ) : null}

          </div>

          {option.has_submenu ? (
            <p style={{ color: 'var(--txt-3)', fontSize: 12, margin: '5px 0 0' }}>
              {option.submenu_greeting || t('tenantAdmin.bot.noSubmenuGreeting')}
            </p>
          ) : (
            <p
              style={{
                color: 'var(--txt-3)',
                fontSize: 12,
                margin: '5px 0 0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {option.response || '-'}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {option.has_submenu || hasChildren ? (
            <button type="button" onClick={() => onToggleExpanded(option.id)} style={iconButtonStyle}>
              {isExpanded ? t('tenantAdmin.bot.collapse') : t('tenantAdmin.bot.expand')}
            </button>
          ) : (
            <button type="button" onClick={() => onEnableSubmenu(option)} style={iconButtonStyle}>
              {t('tenantAdmin.bot.enableSubmenu')}
            </button>
          )}
          <button type="button" onClick={() => onAddSub(option)} style={iconButtonStyle}>
            {t('tenantAdmin.bot.addSubOption')}
          </button>
          <button type="button" onClick={() => onEdit(option)} style={iconButtonStyle}>
            {t('tenantAdmin.common.edit')}
          </button>
          <button type="button" onClick={() => onDelete(option)} style={{ ...iconButtonStyle, color: 'var(--red)' }}>
            {t('tenantAdmin.common.remove')}
          </button>
        </div>
      </div>

      {isExpanded && hasChildren ? (
        <div style={{ borderLeft: '1px dashed var(--line-2)' }}>
          {option.children!
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order || a.number - b.number)
            .map((child) => (
              <OptionNode
                key={child.id}
                option={child}
                level={level + 1}
                expandedIds={expandedIds}
                onToggleExpanded={onToggleExpanded}
                onAddSub={onAddSub}
                onEdit={onEdit}
                onDelete={onDelete}
                onEnableSubmenu={onEnableSubmenu}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}

export function BotMenu() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [isActive, setIsActive] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [footer, setFooter] = useState('');
  const [invalidMsg, setInvalidMsg] = useState('');
  const [editingOption, setEditingOption] = useState<BotOption | null>(null);
  const [parentForNewOption, setParentForNewOption] = useState<BotOption | null>(null);
  const [isOptionModalOpen, setIsOptionModalOpen] = useState(false);
  const [selectedOptionSkills, setSelectedOptionSkills] = useState<BotOptionSkill[]>([]);
  const [initialOptionSkills, setInitialOptionSkills] = useState<BotOptionSkill[]>([]);
  const [isLoadingOptionSkills, setIsLoadingOptionSkills] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data: menu, isLoading } = useQuery({
    queryKey: ['admin', 'bot'],
    queryFn: adminApi.bot.getMenu,
  });

  const { data: skillsV2 = [], isLoading: isLoadingSkillsV2 } = useQuery({
    queryKey: ['admin', 'skills-v2', 'active'],
    queryFn: () => skillsV2Api.list({ is_active: true }),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!menu) return;
    setIsActive(menu.is_active);
    setGreeting(menu.greeting);
    setFooter(menu.footer ?? '');
    setInvalidMsg(menu.invalid_msg ?? '');
  }, [menu]);

  const options = menu?.options ?? [];
  const flattened = useMemo(() => flattenOptions(options), [options]);
  const preview = useMemo(
    () => buildPreview({ greeting, footer, options }),
    [footer, greeting, options],
  );

  const invalidateBot = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'bot'] });
  };

  const resetOptionModalState = () => {
    setIsOptionModalOpen(false);
    setEditingOption(null);
    setParentForNewOption(null);
    setSelectedOptionSkills([]);
    setInitialOptionSkills([]);
    setIsLoadingOptionSkills(false);
  };

  const syncBotOptionSkills = async (
    botOptionId: string,
    before: BotOptionSkill[],
    after: BotOptionSkill[],
  ): Promise<void> => {
    const beforeMap = new Map(before.map((item) => [item.skill_id, item]));
    const afterMap = new Map(after.map((item) => [item.skill_id, item]));

    await Promise.all([
      ...after
        .filter((item) => beforeMap.get(item.skill_id)?.required !== item.required)
        .map((item) =>
          skillsV2Api.assignBotOption(botOptionId, {
            skill_id: item.skill_id,
            required: item.required,
          }),
        ),
      ...before
        .filter((item) => !afterMap.has(item.skill_id))
        .map((item) => skillsV2Api.removeBotOption(botOptionId, item.skill_id)),
    ]);
  };

  const updateMenuMutation = useMutation({
    mutationFn: (payload: Partial<Pick<BotMenuData, 'is_active' | 'greeting' | 'footer' | 'invalid_msg'>>) =>
      adminApi.bot.updateMenu(payload),
    onSuccess: () => {
      invalidateBot();
      toast.success(t('tenantAdmin.bot.messages.saved'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const addOptionMutation = useMutation({
    mutationFn: async (payload: BotOptionPayload) => {
      const option = await adminApi.bot.addOption(payload);
      await syncBotOptionSkills(option.id, [], selectedOptionSkills);
      return option;
    },
    onSuccess: () => {
      invalidateBot();
      resetOptionModalState();
      toast.success(t('tenantAdmin.bot.messages.optionAdded'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const addSubOptionMutation = useMutation({
    mutationFn: async ({ parent, payload }: { parent: BotOption; payload: BotOptionPayload }) => {
      if (!parent.has_submenu) {
        await adminApi.bot.updateOption(parent.id, {
          has_submenu: true,
          submenu_greeting: parent.submenu_greeting || `Você selecionou *${parent.label}*. Escolha uma opção:`,
        });
      }

      const option = await adminApi.bot.addSubOption(parent.id, payload);
      await syncBotOptionSkills(option.id, [], selectedOptionSkills);
      return { option, parentId: parent.id };
    },
    onSuccess: (data) => {
      invalidateBot();
      setExpandedIds((current) => {
        const next = new Set(current);
        next.add(data.parentId);
        return next;
      });
      resetOptionModalState();
      toast.success(t('tenantAdmin.bot.messages.optionAdded'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const updateOptionMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
      syncSkills = true,
    }: {
      id: string;
      payload: Partial<BotOptionPayload>;
      syncSkills?: boolean;
    }) => {
      const option = await adminApi.bot.updateOption(id, payload);
      if (syncSkills) {
        await syncBotOptionSkills(id, initialOptionSkills, selectedOptionSkills);
      }
      return option;
    },
    onSuccess: () => {
      invalidateBot();
      resetOptionModalState();
      toast.success(t('tenantAdmin.bot.messages.optionUpdated'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const deleteOptionMutation = useMutation({
    mutationFn: adminApi.bot.deleteOption,
    onSuccess: () => {
      invalidateBot();
      toast.success(t('tenantAdmin.bot.messages.optionDeleted'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const saveMenu = () => {
    updateMenuMutation.mutate({
      is_active: isActive,
      greeting,
      footer,
      invalid_msg: invalidMsg,
    });
  };

  const handleOpenNewRoot = () => {
    setEditingOption(null);
    setParentForNewOption(null);
    setSelectedOptionSkills([]);
    setInitialOptionSkills([]);
    setIsOptionModalOpen(true);
  };

  const handleOpenNewSub = (parent: BotOption) => {
    setEditingOption(null);
    setParentForNewOption(parent);
    setSelectedOptionSkills([]);
    setInitialOptionSkills([]);
    setIsOptionModalOpen(true);
    setExpandedIds((current) => {
      const next = new Set(current);
      next.add(parent.id);
      return next;
    });
  };

  const handleOpenEdit = async (option: BotOption) => {
    setEditingOption(option);
    setParentForNewOption(null);
    setSelectedOptionSkills([]);
    setInitialOptionSkills([]);
    setIsLoadingOptionSkills(true);
    setIsOptionModalOpen(true);

    try {
      const skills = await skillsV2Api.getBotOption(option.id);
      setSelectedOptionSkills(skills);
      setInitialOptionSkills(skills);
    } catch {
      toast.error(t('tenantAdmin.common.errorLoad'));
    } finally {
      setIsLoadingOptionSkills(false);
    }
  };

  const handleEnableSubmenu = (option: BotOption) => {
    updateOptionMutation.mutate({
      id: option.id,
      payload: {
        has_submenu: true,
        submenu_greeting: option.submenu_greeting || `Você selecionou *${option.label}*. Escolha uma opção:`,
      },
      syncSkills: false,
    });
  };

  const isSavingOption =
    addOptionMutation.isPending || addSubOptionMutation.isPending || updateOptionMutation.isPending;

  return (
    <PageShell>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ color: 'var(--txt)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', margin: 0 }}>
            {t('tenantAdmin.bot.title')}
          </h1>
          <p style={{ color: 'var(--txt-2)', fontSize: 12, margin: '6px 0 0' }}>
            {t('tenantAdmin.bot.subtitle')}
          </p>
        </div>

        <div
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-lg)',
            padding: 20,
          }}
        >
          {isLoading ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} style={{ height: 42, background: 'var(--bg-3)', borderRadius: 'var(--r)', opacity: 0.55 }} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 18 }}>
            <button
              type="button"
              onClick={() => {
                const next = !isActive;
                setIsActive(next);
                updateMenuMutation.mutate({ is_active: next });
              }}
              style={{
                width: 'fit-content',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: isActive ? 'var(--teal-dim)' : 'var(--bg-3)',
                border: `1px solid ${isActive ? 'rgba(0,201,167,.25)' : 'var(--line-2)'}`,
                borderRadius: 'var(--r-pill)',
                padding: '8px 12px',
                cursor: 'pointer',
                color: isActive ? 'var(--teal)' : 'var(--txt-2)',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 17,
                  borderRadius: 999,
                  background: isActive ? 'var(--teal)' : 'var(--bg-5)',
                  position: 'relative',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: isActive ? 15 : 2,
                    width: 13,
                    height: 13,
                    borderRadius: '50%',
                    background: isActive ? '#0E1A18' : 'var(--txt-3)',
                    transition: 'left .15s',
                  }}
                />
              </span>
              {t('tenantAdmin.bot.active')}
            </button>

            {isActive && (
              <div style={{ color: 'var(--teal)', background: 'var(--teal-dim)', border: '1px solid rgba(0,201,167,.22)', borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 13 }}>
                {t('tenantAdmin.bot.activeHint')}
              </div>
            )}

            <label style={{ display: 'grid', gap: 8 }}>
              <span style={labelStyle}>{t('tenantAdmin.bot.greeting')}</span>
              <textarea
                value={greeting}
                onChange={(event) => setGreeting(event.target.value)}
                rows={4}
                className="zd-textarea"
                aria-label={t('tenantAdmin.bot.greeting')}
                style={textareaStyle}
              />
            </label>

            <div style={{ border: '1px solid var(--line-2)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <h2 style={{ color: 'var(--txt)', fontSize: 15, fontWeight: 600, margin: 0 }}>
                  {t('tenantAdmin.bot.options')}
                </h2>
                <Button type="button" size="sm" variant="secondary" onClick={handleOpenNewRoot}>
                  {t('tenantAdmin.bot.addOption')}
                </Button>
              </div>

              {options.length === 0 ? (
                <div style={{ padding: 16, minHeight: 180 }}>
                  <div className="zd-empty-state">
                    <div className="zd-empty-icon" aria-hidden>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M3.5 10h13M10 3.5v13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>{t('tenantAdmin.bot.noOptions')}</div>
                    <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                      {t('tenantAdmin.botMenu.emptyOptions')}
                    </div>
                  </div>
                </div>
              ) : (
                options
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order || a.number - b.number)
                  .map((option) => (
                    <OptionNode
                      key={option.id}
                      option={option}
                      level={0}
                      expandedIds={expandedIds}
                      onToggleExpanded={(id) =>
                        setExpandedIds((current) => {
                          const next = new Set(current);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                      onAddSub={handleOpenNewSub}
                      onEdit={(target) => {
                        void handleOpenEdit(target);
                      }}
                      onDelete={(target) => deleteOptionMutation.mutate(target.id)}
                      onEnableSubmenu={handleEnableSubmenu}
                    />
                  ))
              )}
            </div>

            <label style={{ display: 'grid', gap: 8 }}>
              <span style={labelStyle}>{t('tenantAdmin.bot.invalidMsg')}</span>
              <textarea
                value={invalidMsg}
                onChange={(event) => setInvalidMsg(event.target.value)}
                rows={3}
                className="zd-textarea"
                aria-label={t('tenantAdmin.bot.invalidMsg')}
                style={textareaStyle}
              />
            </label>

            <label style={{ display: 'grid', gap: 8 }}>
              <span style={labelStyle}>{t('tenantAdmin.bot.footer')}</span>
              <textarea
                value={footer}
                onChange={(event) => setFooter(event.target.value)}
                rows={2}
                className="zd-textarea"
                aria-label={t('tenantAdmin.bot.footer')}
                style={textareaStyle}
              />
            </label>

            <div style={{ display: 'grid', gap: 8 }}>
              <span style={labelStyle}>{t('tenantAdmin.bot.preview')}</span>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  color: 'var(--txt)',
                  background: 'var(--bg-3)',
                  border: '1px solid rgba(0,201,167,.25)',
                  borderRadius: 'var(--r-lg)',
                  padding: 16,
                  fontSize: 13,
                  lineHeight: 1.5,
                  fontFamily: 'var(--font)',
                }}
              >
                {preview || t('tenantAdmin.bot.emptyPreview')}
              </pre>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="button" onClick={saveMenu} loading={updateMenuMutation.isPending}>
                {updateMenuMutation.isPending
                  ? t('tenantAdmin.common.saving')
                  : t('tenantAdmin.settings.saveSettings')}
              </Button>
            </div>
            </div>
          )}
        </div>

      <OptionModal
        open={isOptionModalOpen}
        option={editingOption}
        parentOption={parentForNewOption}
        defaultSortOrder={flattened.length}
        isSaving={isSavingOption}
        availableSkills={skillsV2}
        selectedSkills={selectedOptionSkills}
        onSkillsChange={setSelectedOptionSkills}
        isLoadingSkills={isLoadingSkillsV2 || isLoadingOptionSkills}
        onClose={resetOptionModalState}
        onSubmit={(payload) => {
          if (editingOption) {
            updateOptionMutation.mutate({ id: editingOption.id, payload });
            return;
          }

          if (parentForNewOption) {
            addSubOptionMutation.mutate({ parent: parentForNewOption, payload });
            return;
          }

          addOptionMutation.mutate(payload);
        }}
      />
    </PageShell>
  );
}

const labelStyle: CSSProperties = {
  color: 'var(--txt-2)',
  fontSize: 13,
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  height: 40,
  fontSize: 13,
  width: '100%',
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  height: 'auto',
  minHeight: 96,
  padding: 12,
  resize: 'vertical',
  lineHeight: 1.5,
};

const iconButtonStyle: CSSProperties = {
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r)',
  background: 'var(--bg-3)',
  color: 'var(--txt-2)',
  cursor: 'pointer',
  padding: '0 8px',
  fontSize: 12,
  fontFamily: 'var(--font)',
};

