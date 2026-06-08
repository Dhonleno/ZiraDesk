import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, type AIAgentConfig, type KnowledgeArticle } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { PageShell } from '../../components/layout/PageShell';

type KnowledgeTab = 'manual' | 'url' | 'file';

function StatusBadge({ status, error }: { status: string; error?: string | null }) {
  const { t } = useTranslation('admin');

  if (status === 'processing') {
    return (
      <span className="ai-status-badge ai-status-processing">
        <span className="ai-spinner" />
        {t('tenantAdmin.aiAgent.statusProcessing')}
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="ai-status-badge ai-status-error" title={error ?? ''}>
        {t('tenantAdmin.aiAgent.statusError')}
      </span>
    );
  }
  return (
    <span className="ai-status-badge ai-status-indexed">
      {t('tenantAdmin.aiAgent.statusIndexed')}
    </span>
  );
}

function SourceBadge({ type }: { type: string }) {
  const { t } = useTranslation('admin');

  return (
    <span className="ai-source-badge">
      {type === 'manual'
        ? t('tenantAdmin.aiAgent.sourceManual')
        : type === 'url'
          ? t('tenantAdmin.aiAgent.sourceUrl')
          : t('tenantAdmin.aiAgent.sourceFile')}
    </span>
  );
}

export function AIAgentPage() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<KnowledgeTab>('manual');
  const [manualTitle, setManualTitle] = useState('');
  const [manualContent, setManualContent] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [fileTitle, setFileTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [configForm, setConfigForm] = useState<Partial<AIAgentConfig>>({});
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [configDirty, setConfigDirty] = useState(false);

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['ai-config'],
    queryFn: () => adminApi.ai.getConfig(),
  });

  const { data: articles = [], isLoading: articlesLoading } = useQuery({
    queryKey: ['ai-articles'],
    queryFn: () => adminApi.ai.listArticles(),
    refetchInterval: (query) => {
      const data = query.state.data as KnowledgeArticle[] | undefined;
      if (data?.some((a) => a.status === 'processing')) return 3000;
      return false;
    },
  });

  useEffect(() => {
    if (config && !configDirty) {
      setConfigForm(config);
    }
  }, [config, configDirty]);

  const saveConfigMutation = useMutation({
    mutationFn: () => {
      const payload: Partial<AIAgentConfig> = { ...configForm };
      if (apiKeyInput.trim()) {
        payload.openai_api_key = apiKeyInput.trim();
      }
      return adminApi.ai.updateConfig(payload);
    },
    onSuccess: () => {
      toast.success(t('tenantAdmin.common.save'));
      setApiKeyInput('');
      setConfigDirty(false);
      queryClient.invalidateQueries({ queryKey: ['ai-config'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const addManualMutation = useMutation({
    mutationFn: () =>
      adminApi.ai.createManualArticle({ title: manualTitle.trim(), content: manualContent.trim() }),
    onSuccess: () => {
      setManualTitle('');
      setManualContent('');
      queryClient.invalidateQueries({ queryKey: ['ai-articles'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const addUrlMutation = useMutation({
    mutationFn: () =>
      adminApi.ai.createUrlArticle({ url: urlValue.trim(), ...(urlTitle.trim() ? { title: urlTitle.trim() } : {}) }),
    onSuccess: () => {
      setUrlValue('');
      setUrlTitle('');
      queryClient.invalidateQueries({ queryKey: ['ai-articles'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const addFileMutation = useMutation({
    mutationFn: () => adminApi.ai.createFileArticle(selectedFile!, fileTitle.trim() || undefined),
    onSuccess: () => {
      setSelectedFile(null);
      setFileTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      queryClient.invalidateQueries({ queryKey: ['ai-articles'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.ai.deleteArticle(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-articles'] }),
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      adminApi.ai.toggleArticle(id, isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-articles'] }),
  });

  const indexedCount = articles.filter((a) => a.status === 'indexed').length;

  const handleConfigChange = (key: keyof AIAgentConfig, value: unknown) => {
    setConfigForm((prev) => ({ ...prev, [key]: value }));
    setConfigDirty(true);
  };

  if (configLoading) {
    return (
      <PageShell padding={0}>
        <div className="ai-loading">{t('tenantAdmin.common.errorLoad')}</div>
      </PageShell>
    );
  }

  return (
    <PageShell padding={0}>
      <div className="ai-page">
        {/* Header */}
        <div className="ai-page-header">
          <div>
            <h1 className="ai-page-title">{t('tenantAdmin.aiAgent.title')}</h1>
          </div>
        </div>

        <div className="ai-page-body">
          {/* Config section */}
          <section className="ai-section">
            <div className="ai-section-head">
              <span>{t('tenantAdmin.aiAgent.title').toUpperCase()}</span>
            </div>

            {!configForm.is_enabled && (
              <div className="ai-banner-info">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M8 7v4M8 5.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <div>
                  <strong>{t('tenantAdmin.aiAgent.disabledNotice')}</strong>
                  <p>{t('tenantAdmin.aiAgent.disabledHint')}</p>
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ai-link"
                  >
                    {t('tenantAdmin.aiAgent.getApiKey')}
                  </a>
                </div>
              </div>
            )}

            <div className="ai-config-grid">
              <label className="ai-toggle-row" style={{ cursor: 'pointer' }}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!configForm.is_enabled}
                  onClick={() => handleConfigChange('is_enabled', !configForm.is_enabled)}
                  style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                >
                  <span style={{
                    width: 36, height: 20, borderRadius: 999,
                    border: '1px solid var(--line)',
                    background: configForm.is_enabled ? 'var(--teal)' : 'var(--bg-4)',
                    display: 'inline-flex', alignItems: 'center', padding: 2,
                    transition: 'all .15s ease',
                  }}>
                    <span style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: '#fff',
                      transform: `translateX(${configForm.is_enabled ? 16 : 0}px)`,
                      transition: 'transform .15s ease',
                    }} />
                  </span>
                </button>
                <span>{t('tenantAdmin.aiAgent.enabled')}</span>
              </label>

              <div className="ai-field">
                <label>{t('tenantAdmin.aiAgent.agentName')}</label>
                <input
                  type="text"
                  value={configForm.agent_name ?? ''}
                  onChange={(e) => handleConfigChange('agent_name', e.target.value)}
                  className="ai-input"
                  placeholder={t('tenantAdmin.aiAgent.assistantLabel')}
                />
              </div>

              <div className="ai-field">
                <label>{t('tenantAdmin.aiAgent.apiKey')}</label>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => { setApiKeyInput(e.target.value); setConfigDirty(true); }}
                  className="ai-input"
                  placeholder={configForm.openai_api_key ? '••••••••' : 'sk-...'}
                  autoComplete="new-password"
                />
              </div>

              <div className="ai-field ai-field-full">
                <label>{t('tenantAdmin.aiAgent.systemPrompt')}</label>
                <textarea
                  value={configForm.system_prompt ?? ''}
                  onChange={(e) => handleConfigChange('system_prompt', e.target.value)}
                  className="ai-textarea"
                  rows={4}
                  placeholder={t('tenantAdmin.aiAgent.systemPromptPlaceholder')}
                />
              </div>

              <div className="ai-field">
                <label>{t('tenantAdmin.aiAgent.maxAttempts')}</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={configForm.max_attempts ?? 3}
                  onChange={(e) => handleConfigChange('max_attempts', Number(e.target.value))}
                  className="ai-input"
                />
              </div>

              <div className="ai-field">
                <label>{t('tenantAdmin.aiAgent.confidenceThreshold')}</label>
                <input
                  type="number"
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  value={configForm.confidence_threshold ?? 0.5}
                  onChange={(e) => handleConfigChange('confidence_threshold', Number(e.target.value))}
                  className="ai-input"
                  placeholder="0.5"
                />
                <small className="ai-field-help">
                  {t('tenantAdmin.aiAgent.recommendationText')}
                </small>
              </div>
            </div>

            <div className="ai-section-actions">
              <button
                className="ai-primary-btn"
                onClick={() => saveConfigMutation.mutate()}
                disabled={saveConfigMutation.isPending || !configDirty}
              >
                {saveConfigMutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
              </button>
            </div>
          </section>

          {/* Knowledge base section */}
          <section className="ai-section">
            <div className="ai-section-head">
              <span>{t('tenantAdmin.aiAgent.knowledge').toUpperCase()}</span>
              <span className="ai-badge">{indexedCount} {t('tenantAdmin.aiAgent.statusIndexed').toLowerCase()}</span>
            </div>

            {/* Add article tabs */}
            <div className="ai-add-card">
              <div className="ai-tabs">
                {(['manual', 'url', 'file'] as KnowledgeTab[]).map((t2) => (
                  <button
                    key={t2}
                    className={`ai-tab${tab === t2 ? ' active' : ''}`}
                    onClick={() => setTab(t2)}
                  >
                    {t2 === 'manual'
                      ? t('tenantAdmin.aiAgent.addManual')
                      : t2 === 'url'
                        ? t('tenantAdmin.aiAgent.addUrl')
                        : t('tenantAdmin.aiAgent.addFile')}
                  </button>
                ))}
              </div>

              {tab === 'manual' && (
                <div className="ai-tab-body">
                  <input
                    type="text"
                    className="ai-input"
                    placeholder={t('tenantAdmin.aiAgent.titlePlaceholder')}
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                  />
                  <textarea
                    className="ai-textarea"
                    rows={5}
                    placeholder={t('tenantAdmin.aiAgent.contentPlaceholder')}
                    value={manualContent}
                    onChange={(e) => setManualContent(e.target.value)}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="ai-primary-btn"
                      disabled={!manualTitle.trim() || !manualContent.trim() || addManualMutation.isPending}
                      onClick={() => addManualMutation.mutate()}
                    >
                      {addManualMutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.aiAgent.addManual')}
                    </button>
                  </div>
                </div>
              )}

              {tab === 'url' && (
                <div className="ai-tab-body">
                  <input
                    type="url"
                    className="ai-input"
                    placeholder="https://..."
                    value={urlValue}
                    onChange={(e) => setUrlValue(e.target.value)}
                  />
                  <input
                    type="text"
                    className="ai-input"
                    placeholder={t('tenantAdmin.aiAgent.titlePlaceholder')}
                    value={urlTitle}
                    onChange={(e) => setUrlTitle(e.target.value)}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="ai-primary-btn"
                      disabled={!urlValue.trim() || addUrlMutation.isPending}
                      onClick={() => addUrlMutation.mutate()}
                    >
                      {addUrlMutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.aiAgent.addUrl')}
                    </button>
                  </div>
                </div>
              )}

              {tab === 'file' && (
                <div className="ai-tab-body">
                  <div
                    className="ai-dropzone"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f) setSelectedFile(f);
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M12 16V8M12 8l-3 3M12 8l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M20 16.7A4 4 0 0 0 18 9h-1A5 5 0 1 0 5 13.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <span>{selectedFile ? selectedFile.name : t('tenantAdmin.aiAgent.dropzone')}</span>
                    <small>{t('tenantAdmin.aiAgent.fileSizeLimit')}</small>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.doc,.txt"
                    style={{ display: 'none' }}
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  />
                  <input
                    type="text"
                    className="ai-input"
                    placeholder={t('tenantAdmin.aiAgent.titlePlaceholder')}
                    value={fileTitle}
                    onChange={(e) => setFileTitle(e.target.value)}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="ai-primary-btn"
                      disabled={!selectedFile || addFileMutation.isPending}
                      onClick={() => addFileMutation.mutate()}
                    >
                      {addFileMutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.aiAgent.addFile')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Articles list */}
            {articlesLoading ? (
              <div className="ai-loading">{t('tenantAdmin.common.errorLoad')}</div>
            ) : articles.length === 0 ? (
              <div className="ai-empty">{t('tenantAdmin.aiAgent.noArticles')}</div>
            ) : (
              <div className="ai-articles-table">
                <div className="ai-articles-header">
                  <span>{t('tenantAdmin.aiAgent.title')}</span>
                  <span>{t('tenantAdmin.aiAgent.sourceType')}</span>
                  <span>{t('tenantAdmin.aiAgent.columnStatus')}</span>
                  <span>{t('tenantAdmin.aiAgent.columnChunks')}</span>
                  <span />
                </div>
                {articles.map((article) => (
                  <div key={article.id} className="ai-article-row">
                    <span className="ai-article-title">{article.title}</span>
                    <SourceBadge type={article.source_type} />
                    <StatusBadge status={article.status} error={article.error_message} />
                    <span className="ai-mono">{article.chunk_count}</span>
                    <div className="ai-article-actions">
                      <button
                        className={`ai-toggle-btn${article.is_active ? ' active' : ''}`}
                        title={article.is_active ? t('tenantAdmin.common.deactivate') : t('tenantAdmin.common.activate')}
                        onClick={() => toggleMutation.mutate({ id: article.id, isActive: !article.is_active })}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
                          {article.is_active && <circle cx="7" cy="7" r="2.5" fill="currentColor" />}
                        </svg>
                      </button>
                      <button
                        className="ai-delete-btn"
                        title={t('tenantAdmin.aiAgent.deleteConfirm')}
                        onClick={() => {
                          if (window.confirm(t('tenantAdmin.aiAgent.deleteConfirm'))) {
                            deleteMutation.mutate(article.id);
                          }
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                          <path d="M2 3.5h10M5.5 3.5V2.5h3v1M6 6v4M8 6v4M3 3.5l.7 7.5h6.6L11 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </PageShell>
  );
}
