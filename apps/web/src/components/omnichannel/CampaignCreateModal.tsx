import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, campaignsApi, omnichannelApi, type ActiveOutboundTemplate, type Campaign } from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface Props {
  onClose: () => void;
  onCreated: (campaign: Campaign) => void;
}

type VarMode = 'contact_name' | 'contact_phone' | 'fixed';
type MediaHeaderType = 'IMAGE' | 'VIDEO' | 'DOCUMENT';

function isMediaHeaderType(value: string | null | undefined): value is MediaHeaderType {
  return value === 'IMAGE' || value === 'VIDEO' || value === 'DOCUMENT';
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractVariableIds(body: string): string[] {
  const ids = new Set<string>();
  const regex = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(body)) !== null) {
    if (m[1]) ids.add(m[1]);
  }
  return Array.from(ids).sort((a, b) => Number(a) - Number(b));
}

function renderPreview(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_all, id: string) => {
    const v = values[id]?.trim();
    if (!v) return `{{${id}}}`;
    if (v === '{{contact.name}}') return '[Nome do contato]';
    if (v === '{{contact.phone}}') return '[Telefone do contato]';
    return v;
  });
}

export function CampaignCreateModal({ onClose, onCreated }: Props) {
  const { t } = useTranslation('campaigns');
  const toast = useToast();
  const queryClient = useQueryClient();
  const overlayRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [varModes, setVarModes] = useState<Record<string, VarMode>>({});
  const [fixedValues, setFixedValues] = useState<Record<string, string>>({});
  const [headerMediaUrl, setHeaderMediaUrl] = useState('');
  const [headerMediaFilename, setHeaderMediaFilename] = useState('documento.pdf');
  const [dailyLimit, setDailyLimit] = useState(500);
  const [notes, setNotes] = useState('');
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    setTimeout(() => firstInputRef.current?.focus(), 60);
  }, []);

  const { data: channels = [] } = useQuery({
    queryKey: ['campaign-channels'],
    queryFn: () => adminApi.listChannelsByTypes(['whatsapp']),
    staleTime: 60_000,
  });

  const whatsappChannels = useMemo(
    () => channels.filter((ch) => ch.type === 'whatsapp' && ch.status === 'active'),
    [channels],
  );

  const { data: templates = [] } = useQuery({
    queryKey: ['campaign-templates', channelId],
    queryFn: () => omnichannelApi.listActiveOutboundTemplates(channelId),
    enabled: Boolean(channelId),
    staleTime: 60_000,
  });

  const selectedTemplate = useMemo<ActiveOutboundTemplate | null>(
    () => templates.find((tp) => tp.id === templateId) ?? null,
    [templates, templateId],
  );

  const variableIds = useMemo(
    () => (selectedTemplate?.body ? extractVariableIds(selectedTemplate.body) : []),
    [selectedTemplate],
  );

  const selectedHeaderType = selectedTemplate?.header_type ?? 'NONE';
  const requiresHeaderMedia = isMediaHeaderType(selectedHeaderType);
  const headerMediaUrlValid = !requiresHeaderMedia || isValidHttpUrl(headerMediaUrl.trim());

  useEffect(() => {
    setTemplateId('');
    setVarModes({});
    setFixedValues({});
    setHeaderMediaUrl('');
    setHeaderMediaFilename('documento.pdf');
  }, [channelId]);

  useEffect(() => {
    setVarModes({});
    setFixedValues({});
    setHeaderMediaUrl('');
    setHeaderMediaFilename('documento.pdf');
  }, [templateId]);

  const templateVariables = useMemo<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    for (const id of variableIds) {
      const mode = varModes[id] ?? 'contact_name';
      if (mode === 'contact_name') result[id] = '{{contact.name}}';
      else if (mode === 'contact_phone') result[id] = '{{contact.phone}}';
      else result[id] = fixedValues[id] ?? '';
    }
    return result;
  }, [variableIds, varModes, fixedValues]);

  const preview = useMemo(
    () => (selectedTemplate?.body ? renderPreview(selectedTemplate.body, templateVariables) : ''),
    [selectedTemplate, templateVariables],
  );

  const createMutation = useMutation({
    mutationFn: () => campaignsApi.create({
      name: name.trim(),
      channel_id: channelId,
      template_id: templateId,
      template_variables: templateVariables,
      template_header_media_url: requiresHeaderMedia ? headerMediaUrl.trim() : null,
      template_header_media_filename: selectedHeaderType === 'DOCUMENT'
        ? (headerMediaFilename.trim() || 'documento.pdf')
        : null,
      scheduled_at: schedule && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      daily_limit: dailyLimit,
      notes: notes.trim() || null,
    }),
    onSuccess: (campaign) => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campanha criada com sucesso!');
      onCreated(campaign);
    },
    onError: () => {
      toast.error('Erro ao criar campanha. Verifique os dados e tente novamente.');
    },
  });

  const step1Valid = Boolean(name.trim() && channelId && templateId && headerMediaUrlValid);
  const step2Valid = !schedule || Boolean(scheduledAt);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 32,
    background: 'var(--bg-3)',
    border: '1px solid var(--line-2)',
    borderRadius: 'var(--r)',
    color: 'var(--txt)',
    fontSize: 12,
    padding: '0 10px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'var(--font)',
  };

  const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--txt-2)',
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  };

  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 0 };
  const headerTypeLabel = selectedHeaderType === 'NONE' ? 'Sem header' : `Header ${selectedHeaderType}`;
  const mediaUrlPlaceholder = selectedTemplate?.header_example_url
    || (selectedHeaderType === 'VIDEO'
      ? 'https://example.com/video.mp4'
      : selectedHeaderType === 'DOCUMENT'
        ? 'https://example.com/documento.pdf'
        : 'https://example.com/imagem.jpg');

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('create.title')}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'var(--backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{
        width: '100%',
        maxWidth: 560,
        background: 'var(--bg-2)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-pop)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 40px)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('create.title')}</div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 2 }}>
              {t(`create.step${step}.title` as any)} — {t('common:step', { defaultValue: `Passo ${step} de 3` })}
            </div>
          </div>
          {/* Step indicators */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[1, 2, 3].map((s) => (
              <div key={s} style={{
                width: s === step ? 20 : 8,
                height: 6,
                borderRadius: 3,
                background: s === step ? 'var(--teal)' : s < step ? 'rgba(0,201,167,.35)' : 'var(--bg-5)',
                transition: 'all .2s',
              }} />
            ))}
          </div>
          <button
            onClick={onClose}
            className="tb-icon-btn"
            aria-label="Fechar"
            style={{ marginLeft: 8, flexShrink: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>

          {/* ── Step 1: Settings ── */}
          {step === 1 && (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>{t('create.step1.name')}</label>
                <input
                  ref={firstInputRef}
                  style={inputStyle}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('create.step1.namePlaceholder')}
                  maxLength={255}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>{t('create.step1.channel')}</label>
                <select style={selectStyle} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                  <option value="">{t('create.step1.channelPlaceholder')}</option>
                  {whatsappChannels.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              </div>

              {channelId && (
                <div style={fieldStyle}>
                  <label style={labelStyle}>{t('create.step1.template')}</label>
                  <select style={selectStyle} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    <option value="">{t('create.step1.templatePlaceholder')}</option>
                    {templates.map((tp) => (
                      <option key={tp.id} value={tp.id}>{tp.display_name || tp.name} ({tp.language})</option>
                    ))}
                  </select>
                </div>
              )}

              {selectedTemplate && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={labelStyle}>Header do template</span>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      minHeight: 22,
                      padding: '0 8px',
                      borderRadius: 'var(--r)',
                      border: '1px solid var(--line-2)',
                      background: requiresHeaderMedia ? 'rgba(0,201,167,.10)' : 'var(--bg-3)',
                      color: requiresHeaderMedia ? 'var(--teal)' : 'var(--txt-2)',
                      fontSize: 11,
                      fontWeight: 600,
                    }}>
                      {headerTypeLabel}
                    </span>
                  </div>

                  {requiresHeaderMedia && (
                    <div style={{ display: 'grid', gridTemplateColumns: selectedHeaderType === 'DOCUMENT' ? '1fr 160px' : '1fr', gap: 12 }}>
                      <div style={fieldStyle}>
                        <label style={labelStyle}>URL da mídia</label>
                        <input
                          style={{
                            ...inputStyle,
                            borderColor: headerMediaUrl.trim() && !headerMediaUrlValid ? 'var(--red)' : 'var(--line-2)',
                          }}
                          value={headerMediaUrl}
                          onChange={(e) => setHeaderMediaUrl(e.target.value)}
                          placeholder={mediaUrlPlaceholder}
                          inputMode="url"
                        />
                        {headerMediaUrl.trim() && !headerMediaUrlValid && (
                          <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>
                            Informe uma URL http ou https válida.
                          </div>
                        )}
                      </div>
                      {selectedHeaderType === 'DOCUMENT' && (
                        <div style={fieldStyle}>
                          <label style={labelStyle}>Arquivo</label>
                          <input
                            style={inputStyle}
                            value={headerMediaFilename}
                            onChange={(e) => setHeaderMediaFilename(e.target.value)}
                            placeholder="documento.pdf"
                            maxLength={255}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Template preview */}
                  {preview && (
                    <div style={fieldStyle}>
                      <label style={labelStyle}>{t('create.step1.preview')}</label>
                      <div style={{
                        background: 'var(--bg-4)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r)',
                        padding: '10px 12px',
                        fontSize: 12,
                        color: 'var(--txt-2)',
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.6,
                        fontFamily: 'var(--font)',
                      }}>
                        {preview}
                      </div>
                    </div>
                  )}

                  {/* Variable configuration */}
                  {variableIds.length > 0 && (
                    <div style={fieldStyle}>
                      <label style={labelStyle}>{t('create.step1.variables')}</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {variableIds.map((id) => {
                          const mode = varModes[id] ?? 'contact_name';
                          return (
                            <div key={id} style={{ background: 'var(--bg-3)', borderRadius: 'var(--r)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt-2)' }}>
                                {t('create.step1.variable', { n: id })}
                              </div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <select
                                  style={{ ...selectStyle, flex: 1 }}
                                  value={mode}
                                  onChange={(e) => setVarModes((prev) => ({ ...prev, [id]: e.target.value as VarMode }))}
                                >
                                  <option value="contact_name">{t('create.step1.varContactName')}</option>
                                  <option value="contact_phone">{t('create.step1.varContactPhone')}</option>
                                  <option value="fixed">{t('create.step1.varFixed')}</option>
                                </select>
                                {mode === 'fixed' && (
                                  <input
                                    style={{ ...inputStyle, flex: 1 }}
                                    value={fixedValues[id] ?? ''}
                                    onChange={(e) => setFixedValues((prev) => ({ ...prev, [id]: e.target.value }))}
                                    placeholder={t('create.step1.varFixedPlaceholder')}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldStyle}>
                  <label style={labelStyle}>{t('create.step1.dailyLimit')}</label>
                  <input
                    style={inputStyle}
                    type="number"
                    min={1}
                    max={10000}
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(Math.max(1, parseInt(e.target.value, 10) || 500))}
                  />
                </div>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>{t('create.step1.notes')}</label>
                <textarea
                  style={{
                    ...inputStyle,
                    height: 72,
                    resize: 'vertical',
                    padding: '8px 10px',
                    lineHeight: 1.5,
                  }}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('create.step1.notesPlaceholder')}
                  maxLength={2000}
                />
              </div>
            </div>
          )}

          {/* ── Step 2: Scheduling ── */}
          {step === 2 && (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-3)', borderRadius: 'var(--r)' }}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={schedule}
                  onClick={() => setSchedule((s) => !s)}
                  style={{
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    border: 'none',
                    background: schedule ? 'var(--teal)' : 'var(--bg-5)',
                    cursor: 'pointer',
                    position: 'relative',
                    flexShrink: 0,
                    transition: 'background .15s',
                  }}
                >
                  <span style={{
                    position: 'absolute',
                    top: 3,
                    left: schedule ? 19 : 3,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: 'white',
                    transition: 'left .15s',
                  }} />
                </button>
                <span style={{ fontSize: 12, color: 'var(--txt)' }}>{t('create.step2.scheduleToggle')}</span>
              </div>

              {schedule ? (
                <div style={fieldStyle}>
                  <label style={labelStyle}>{t('create.step2.scheduleDate')}</label>
                  <input
                    style={inputStyle}
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                  />
                  {scheduledAt && (
                    <div style={{ fontSize: 11, color: 'var(--teal)', marginTop: 6 }}>
                      {t('create.step2.scheduledHint', { date: new Date(scheduledAt).toLocaleString('pt-BR') })}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--txt-2)', padding: '8px 0' }}>
                  {t('create.step2.immediateHint')}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Review ── */}
          {step === 3 && (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {t('create.step3.summary')}
              </div>
              {[
                { label: t('create.step1.name'), value: name },
                { label: t('create.step3.channel'), value: whatsappChannels.find((c) => c.id === channelId)?.name ?? '—' },
                { label: t('create.step3.template'), value: selectedTemplate ? (selectedTemplate.display_name || selectedTemplate.name) : '—' },
                { label: 'Header', value: requiresHeaderMedia ? `${selectedHeaderType} · ${headerMediaUrl.trim()}` : headerTypeLabel },
                { label: t('create.step3.scheduling'), value: schedule && scheduledAt ? new Date(scheduledAt).toLocaleString('pt-BR') : t('create.step3.immediate') },
                { label: t('create.step1.dailyLimit'), value: String(dailyLimit) },
                { label: t('create.step3.notes'), value: notes.trim() || t('create.step3.noNotes') },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--txt-3)', fontWeight: 500 }}>{label}</span>
                  <span style={{ fontSize: 12, color: 'var(--txt)', wordBreak: 'break-word' }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 8, flexShrink: 0, background: 'var(--bg-2)' }}>
          <button
            type="button"
            className="tb-btn"
            onClick={() => (step > 1 ? setStep((s) => s - 1) : onClose())}
          >
            {step > 1 ? t('create.back') : 'Cancelar'}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {step < 3 && (
              <button
                type="button"
                className="tb-btn tb-btn-primary"
                disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
                onClick={() => setStep((s) => s + 1)}
              >
                {t('create.next')}
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                className="tb-btn tb-btn-primary"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? t('create.saving') : t('create.step3.confirm')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
