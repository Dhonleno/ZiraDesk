import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  type BotMenu as BotMenuData,
  type BotOption,
  type BotOptionPayload,
} from '../../services/api';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../stores/toast.store';

interface OptionModalProps {
  open: boolean;
  option?: BotOption | null;
  defaultSortOrder: number;
  onClose: () => void;
  onSubmit: (payload: BotOptionPayload) => void;
  isSaving: boolean;
}

function buildPreview(menu: Pick<BotMenuData, 'greeting' | 'footer' | 'options'>) {
  const optionLines = menu.options
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.number - b.number)
    .map((option) => `${option.number}. ${option.label}`);
  return [menu.greeting, '', ...optionLines, '', menu.footer ?? ''].join('\n').trim();
}

function OptionModal({ open, option, defaultSortOrder, onClose, onSubmit, isSaving }: OptionModalProps) {
  const { t } = useTranslation('admin');
  const [number, setNumber] = useState(1);
  const [label, setLabel] = useState('');
  const [tag, setTag] = useState('');
  const [response, setResponse] = useState('');

  useEffect(() => {
    if (!open) return;
    setNumber(option?.number ?? 1);
    setLabel(option?.label ?? '');
    setTag(option?.tag ?? '');
    setResponse(option?.response ?? '');
  }, [open, option]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.46)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 120,
        padding: 16,
      }}
      onClick={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            number,
            label,
            tag: tag.trim() || null,
            response,
            sort_order: option?.sort_order ?? defaultSortOrder,
          });
        }}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-pop)',
          padding: 20,
          display: 'grid',
          gap: 14,
        }}
      >
        <div>
          <h2 style={{ color: 'var(--txt)', fontSize: 18, fontWeight: 700, margin: 0 }}>
            {option ? t('tenantAdmin.bot.editOption') : t('tenantAdmin.bot.addOption')}
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={labelStyle}>{t('tenantAdmin.bot.option.number')}</span>
            <input
              type="number"
              min={0}
              value={number}
              onChange={(event) => setNumber(Number(event.target.value))}
              style={inputStyle}
              required
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={labelStyle}>{t('tenantAdmin.bot.option.label')}</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              style={inputStyle}
              maxLength={100}
              required
            />
          </label>
        </div>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>{t('tenantAdmin.bot.option.tag')}</span>
          <input value={tag} onChange={(event) => setTag(event.target.value)} style={inputStyle} maxLength={50} />
          <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>{t('tenantAdmin.bot.option.tagHint')}</span>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>{t('tenantAdmin.bot.option.response')}</span>
          <textarea
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            rows={4}
            style={textareaStyle}
            required
          />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('tenantAdmin.common.cancel')}
          </Button>
          <Button type="submit" loading={isSaving}>
            {isSaving ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  color: 'var(--txt-2)',
  fontSize: 13,
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-3)',
  border: '1px solid var(--line-2)',
  color: 'var(--txt)',
  height: 40,
  borderRadius: 'var(--r)',
  padding: '0 12px',
  fontSize: 13,
  width: '100%',
  outline: 'none',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: 'auto',
  minHeight: 96,
  padding: 12,
  resize: 'vertical',
  lineHeight: 1.5,
};

export function BotMenu() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [isActive, setIsActive] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [footer, setFooter] = useState('');
  const [invalidMsg, setInvalidMsg] = useState('');
  const [editingOption, setEditingOption] = useState<BotOption | null>(null);
  const [isOptionModalOpen, setIsOptionModalOpen] = useState(false);

  const { data: menu, isLoading } = useQuery({
    queryKey: ['admin', 'bot'],
    queryFn: adminApi.bot.getMenu,
  });

  useEffect(() => {
    if (!menu) return;
    setIsActive(menu.is_active);
    setGreeting(menu.greeting);
    setFooter(menu.footer ?? '');
    setInvalidMsg(menu.invalid_msg ?? '');
  }, [menu]);

  const invalidateBot = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'bot'] });
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
    mutationFn: adminApi.bot.addOption,
    onSuccess: () => {
      invalidateBot();
      setIsOptionModalOpen(false);
      toast.success(t('tenantAdmin.bot.messages.optionAdded'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const updateOptionMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<BotOptionPayload> }) =>
      adminApi.bot.updateOption(id, payload),
    onSuccess: () => {
      invalidateBot();
      setIsOptionModalOpen(false);
      setEditingOption(null);
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

  const options = menu?.options ?? [];
  const preview = useMemo(
    () => buildPreview({
      greeting,
      footer,
      options,
    }),
    [footer, greeting, options],
  );

  const saveMenu = () => {
    updateMenuMutation.mutate({
      is_active: isActive,
      greeting,
      footer,
      invalid_msg: invalidMsg,
    });
  };

  return (
    <div style={{ padding: 24, maxWidth: 880, overflow: 'auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: 'var(--txt)', fontSize: 24, fontWeight: 700, margin: 0 }}>
          {t('tenantAdmin.bot.title')}
        </h1>
        <p style={{ color: 'var(--txt-2)', fontSize: 14, margin: '6px 0 0' }}>
          {t('tenantAdmin.bot.subtitle')}
        </p>
      </div>

      <div
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
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
                border: `1px solid ${isActive ? 'rgba(0,201,167,.25)' : 'var(--line)'}`,
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
              <textarea value={greeting} onChange={(event) => setGreeting(event.target.value)} rows={4} style={textareaStyle} />
            </label>

            <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
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
                <h2 style={{ color: 'var(--txt)', fontSize: 15, fontWeight: 700, margin: 0 }}>
                  {t('tenantAdmin.bot.options')}
                </h2>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditingOption(null);
                    setIsOptionModalOpen(true);
                  }}
                >
                  {t('tenantAdmin.bot.addOption')}
                </Button>
              </div>

              {options.length === 0 ? (
                <div style={{ padding: 18, color: 'var(--txt-3)', fontSize: 13 }}>
                  {t('tenantAdmin.bot.noOptions')}
                </div>
              ) : (
                options
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order || a.number - b.number)
                  .map((option) => (
                    <div
                      key={option.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 14px',
                        borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ color: 'var(--txt)', fontSize: 13 }}>
                            {option.number}. {option.label}
                          </strong>
                          {option.tag ? (
                            <span style={{ fontSize: 10, color: 'var(--blue)', background: 'var(--blue-dim)', border: '1px solid rgba(96,165,250,.2)', borderRadius: 'var(--r-pill)', padding: '1px 7px' }}>
                              tag: {option.tag}
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: 'var(--txt-3)', background: 'var(--bg-4)', border: '1px solid var(--line)', borderRadius: 'var(--r-pill)', padding: '1px 7px' }}>
                              {t('tenantAdmin.bot.noTag')}
                            </span>
                          )}
                        </div>
                        <p style={{ color: 'var(--txt-3)', fontSize: 12, margin: '5px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {option.response}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          title={t('tenantAdmin.common.edit')}
                          onClick={() => {
                            setEditingOption(option);
                            setIsOptionModalOpen(true);
                          }}
                          style={iconButtonStyle}
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                            <path d="M8.5 2.5l3 3L5 12H2v-3l6.5-6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                            <path d="M7.6 3.4l3 3" stroke="currentColor" strokeWidth="1.3" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          title={t('tenantAdmin.common.remove')}
                          onClick={() => deleteOptionMutation.mutate(option.id)}
                          style={{ ...iconButtonStyle, color: 'var(--red)' }}
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                            <path d="M2.5 4h9M5.5 2.2h3L9.2 4H4.8l.7-1.8zM4 4.8l.5 7h5l.5-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>

            <label style={{ display: 'grid', gap: 8 }}>
              <span style={labelStyle}>{t('tenantAdmin.bot.invalidMsg')}</span>
              <textarea value={invalidMsg} onChange={(event) => setInvalidMsg(event.target.value)} rows={3} style={textareaStyle} />
            </label>

            <label style={{ display: 'grid', gap: 8 }}>
              <span style={labelStyle}>{t('tenantAdmin.bot.footer')}</span>
              <textarea value={footer} onChange={(event) => setFooter(event.target.value)} rows={2} style={textareaStyle} />
            </label>

            <div style={{ display: 'grid', gap: 8 }}>
              <span style={labelStyle}>{t('tenantAdmin.bot.preview')}</span>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  color: 'var(--txt)',
                  background: '#102420',
                  border: '1px solid rgba(37,211,102,.2)',
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
        defaultSortOrder={options.length}
        isSaving={addOptionMutation.isPending || updateOptionMutation.isPending}
        onClose={() => {
          setIsOptionModalOpen(false);
          setEditingOption(null);
        }}
        onSubmit={(payload) => {
          if (editingOption) {
            updateOptionMutation.mutate({ id: editingOption.id, payload });
          } else {
            addOptionMutation.mutate(payload);
          }
        }}
      />
    </div>
  );
}

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r)',
  background: 'var(--bg-3)',
  color: 'var(--txt-2)',
  cursor: 'pointer',
};
