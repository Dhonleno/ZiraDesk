import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/layout/PageShell';
import {
  omnichannelApi,
  type HistoryFiltersParams,
  type HistoryPeriodPreset,
  type OmnichannelHistoryConversation,
} from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { GoalsConfig } from './GoalsConfig';

const PERIOD_PRESETS: Array<{ labelKey: string; value: HistoryPeriodPreset }> = [
  { labelKey: 'history.periods.today', value: 'today' },
  { labelKey: 'history.periods.yesterday', value: 'yesterday' },
  { labelKey: 'history.periods.7d', value: '7d' },
  { labelKey: 'history.periods.30d', value: '30d' },
  { labelKey: 'history.periods.month', value: 'month' },
  { labelKey: 'history.periods.custom', value: 'custom' },
];

const STATUS_BADGE_CLASS: Record<string, string> = {
  open: 'status-open',
  waiting: 'status-waiting',
  closed: 'status-closed',
};

function channelIcon(channelType: string) {
  if (channelType === 'whatsapp') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4.8 9.3 5.5 8.1c1.7.9 3 .1 3.6-.7.4-.5.5-1 .5-1.1-.5.2-1 .1-1.4-.2-.5-.4-.8-.9-1.2-1.4-.3-.3-.8-.4-1.2-.2-.8.4-1.2 1.5-.7 2.5.3.7.8 1.7 1.6 2.3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (channelType === 'instagram') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="2" y="2" width="10" height="10" rx="3" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="10.1" cy="3.9" r="0.6" fill="currentColor" />
      </svg>
    );
  }

  if (channelType === 'email') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="1.8" y="3" width="10.4" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="m2.4 3.8 4.6 3.4 4.6-3.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2 4h10a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 12 10H7l-2.5 2V10H2A1.5 1.5 0 0 1 .5 8.5v-3A1.5 1.5 0 0 1 2 4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}

function toNonEmpty(value: string | null): string {
  return value && value.trim() ? value : '';
}

function formatRelativeDate(isoDate: string, locale: string): string {
  const target = new Date(isoDate).getTime();
  const now = Date.now();
  const diffInSeconds = Math.round((target - now) / 1000);
  const abs = Math.abs(diffInSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (abs < 60) return rtf.format(diffInSeconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffInSeconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffInSeconds / 3600), 'hour');
  if (abs < 604800) return rtf.format(Math.round(diffInSeconds / 86400), 'day');
  return new Date(isoDate).toLocaleDateString(locale);
}

function parseFilters(searchParams: URLSearchParams): HistoryFiltersParams {
  const filters: HistoryFiltersParams = {
    page: Math.max(1, Number(searchParams.get('page') || '1') || 1),
    per_page: Math.max(1, Number(searchParams.get('per_page') || '25') || 25),
    period: (toNonEmpty(searchParams.get('period')) || '7d') as HistoryPeriodPreset,
  };

  const search = toNonEmpty(searchParams.get('search'));
  if (search) filters.search = search;
  const status = toNonEmpty(searchParams.get('status'));
  if (status) filters.status = status;
  const assignedTo = toNonEmpty(searchParams.get('assigned_to'));
  if (assignedTo) filters.assigned_to = assignedTo;
  const channelType = toNonEmpty(searchParams.get('channel_type'));
  if (channelType) filters.channel_type = channelType;
  const botOptionId = toNonEmpty(searchParams.get('bot_option_id'));
  if (botOptionId) filters.bot_option_id = botOptionId;
  const csatRating = toNonEmpty(searchParams.get('csat_rating')) as HistoryFiltersParams['csat_rating'] | '';
  if (csatRating) filters.csat_rating = csatRating;
  const dateFrom = toNonEmpty(searchParams.get('date_from'));
  if (dateFrom) filters.date_from = dateFrom;
  const dateTo = toNonEmpty(searchParams.get('date_to'));
  if (dateTo) filters.date_to = dateTo;

  return filters;
}

function ContactCell({ conversation }: { conversation: OmnichannelHistoryConversation }) {
  const name = conversation.contact_name || '—';
  const contact = conversation.contact_whatsapp || conversation.contact_phone || '—';
  return (
    <div className="history-contact-cell">
      <span className="history-contact-name">{name}</span>
      <span className="history-contact-meta">{contact}</span>
    </div>
  );
}

function AgentCell({ conversation }: { conversation: OmnichannelHistoryConversation }) {
  const agentName = conversation.assigned_name?.trim();
  if (!agentName) {
    return <span style={{ color: 'var(--txt-3)' }}>—</span>;
  }

  const initial = agentName.slice(0, 1).toUpperCase();
  return (
    <div className="history-agent-cell">
      <span className="history-agent-avatar" aria-hidden>
        {conversation.assigned_avatar ? (
          <img src={conversation.assigned_avatar} alt="" />
        ) : (
          initial
        )}
      </span>
      <span className="history-agent-name">{agentName}</span>
    </div>
  );
}

function CSATCell({ score }: { score: number | null }) {
  if (!score) return <span className="history-csat-empty">—</span>;
  return (
    <span className="history-csat-stars" aria-label={`${score}/5`}>
      {'★'.repeat(score)}
      <span className="history-csat-muted">{'☆'.repeat(5 - score)}</span>
    </span>
  );
}

function HistoryDetailEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="history-detail-empty">
      <div className="history-detail-empty-icon" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M5 5.5h12M5 10.5h8M5 15.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </div>
      <div className="history-detail-empty-copy">
        <strong>{title}</strong>
        <p>{hint}</p>
      </div>
    </div>
  );
}

export function HistoryPage() {
  const { t, i18n } = useTranslation('omnichannel');
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'history' | 'goals'>('history');
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');

  useEffect(() => {
    setSearchDraft(filters.search ?? '');
  }, [filters.search]);

  const { data: historyResult, isLoading } = useQuery({
    queryKey: ['omnichannel-history', filters],
    queryFn: () => omnichannelApi.listHistory(filters),
  });

  const { data: detailData, isLoading: isDetailLoading } = useQuery({
    queryKey: ['omnichannel-history-detail', selectedConversationId],
    queryFn: () => omnichannelApi.getHistoryDetail(selectedConversationId ?? ''),
    enabled: Boolean(selectedConversationId),
  });

  const { data: monitorData } = useQuery({
    queryKey: ['monitor'],
    queryFn: omnichannelApi.monitor,
    staleTime: 30_000,
  });

  const closeDetail = useCallback(() => {
    setSelectedConversationId(null);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!selectedConversationId) return undefined;

    detailPanelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeDetail, selectedConversationId]);

  const groupOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const row of historyResult?.data ?? []) {
      if (!row.bot_option_id) continue;
      values.set(row.bot_option_id, row.bot_department ?? row.bot_option_id);
    }
    return Array.from(values.entries()).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [historyResult?.data]);

  const updateFilterParams = useCallback((values: Partial<Record<string, string | null>>, resetPage = true) => {
    const next = new URLSearchParams(searchParams);

    for (const [key, value] of Object.entries(values)) {
      const normalized = typeof value === 'string' ? value.trim() : '';
      if (normalized) {
        next.set(key, normalized);
      } else {
        next.delete(key);
      }
    }

    if (resetPage) {
      next.set('page', '1');
    }

    if (!next.get('per_page')) {
      next.set('per_page', String(filters.per_page ?? 25));
    }

    setSearchParams(next);
  }, [filters.per_page, searchParams, setSearchParams]);

  useEffect(() => {
    const normalizedSearch = searchDraft.trim();
    const currentSearch = filters.search ?? '';

    if (normalizedSearch === currentSearch) return;

    const timeoutId = window.setTimeout(() => {
      updateFilterParams({ search: normalizedSearch || null });
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [filters.search, searchDraft, updateFilterParams]);

  const handleExport = async () => {
    try {
      const blob = await omnichannelApi.exportHistoryCsv(filters);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `historico-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Não foi possível exportar o CSV agora.');
    }
  };

  const currentPage = filters.page ?? 1;
  const totalPages = historyResult?.meta.totalPages ?? 0;

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div className="monitor-page history-page">
        <div className="monitor-header history-header">
          <div>
            <h1>{t('history.title')}</h1>
            <p>{t('history.subtitle')}</p>
          </div>
          {activeTab === 'history' ? (
            <button className="zd-btn zd-btn-primary" type="button" onClick={handleExport}>
              {t('history.exportCsv')}
            </button>
          ) : null}
        </div>

        <div className="history-tabs">
          <button
            type="button"
            className={activeTab === 'history' ? 'active' : ''}
            onClick={() => setActiveTab('history')}
          >
            {t('history.tabs.history')}
          </button>
          <button
            type="button"
            className={activeTab === 'goals' ? 'active' : ''}
            onClick={() => {
              setSelectedConversationId(null);
              setActiveTab('goals');
            }}
          >
            {t('history.tabs.goals')}
          </button>
        </div>

        <div className={`history-tab-content ${activeTab === 'goals' ? 'is-goals' : 'is-history'}`}>
          {activeTab === 'history' ? (
            <>
            <div className="history-filters-grid">
              <div className="history-search-box">
                <input
                  className="zd-input"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder={t('history.search')}
                  aria-label={t('history.search')}
                />
              </div>

              <select
                className="filter-select"
                value={filters.period ?? '7d'}
                onChange={(event) => updateFilterParams({ period: event.target.value })}
                aria-label={t('history.filters.period')}
              >
                {PERIOD_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{t(preset.labelKey)}</option>
                ))}
              </select>

              <select
                className="filter-select"
                value={filters.status ?? ''}
                onChange={(event) => updateFilterParams({ status: event.target.value || null })}
                aria-label={t('history.filters.status')}
              >
                <option value="">{t('history.filters.status')}</option>
                <option value="open">{t('status.open')}</option>
                <option value="waiting">{t('status.waiting')}</option>
                <option value="closed">{t('status.closed')}</option>
              </select>

              <select
                className="filter-select"
                value={filters.assigned_to ?? ''}
                onChange={(event) => updateFilterParams({ assigned_to: event.target.value || null })}
                aria-label={t('history.filters.agent')}
              >
                <option value="">{t('history.filters.agent')}</option>
                {(monitorData?.agents ?? []).filter((a) => a.role === 'agent').map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>

              <select
                className="filter-select"
                value={filters.channel_type ?? ''}
                onChange={(event) => updateFilterParams({ channel_type: event.target.value || null })}
                aria-label={t('history.filters.channel')}
              >
                <option value="">{t('history.filters.channel')}</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="instagram">Instagram</option>
                <option value="email">E-mail</option>
                <option value="webchat">Web Chat</option>
                <option value="live_chat">Chat</option>
              </select>

              <select
                className="filter-select"
                value={filters.csat_rating ?? ''}
                onChange={(event) => updateFilterParams({ csat_rating: event.target.value || null })}
                aria-label={t('history.filters.csat')}
              >
                <option value="">{t('history.filters.csat')}</option>
                <option value="5">5 ★</option>
                <option value="4">4 ★</option>
                <option value="3">3 ★</option>
                <option value="2">2 ★</option>
                <option value="1">1 ★</option>
                <option value="none">—</option>
              </select>

              <select
                className="filter-select"
                value={filters.bot_option_id ?? ''}
                onChange={(event) => updateFilterParams({ bot_option_id: event.target.value || null })}
                aria-label={t('history.filters.group')}
              >
                <option value="">{t('history.filters.group')}</option>
                {groupOptions.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>

              {filters.period === 'custom' ? (
                <>
                  <input
                    className="filter-select"
                    type="date"
                    value={filters.date_from ?? ''}
                    onChange={(event) => updateFilterParams({ date_from: event.target.value || null })}
                    aria-label={t('history.filters.startDate')}
                  />
                  <input
                    className="filter-select"
                    type="date"
                    value={filters.date_to ?? ''}
                    onChange={(event) => updateFilterParams({ date_to: event.target.value || null })}
                    aria-label={t('history.filters.endDate')}
                  />
                </>
              ) : null}
            </div>

            <div className="history-result-count">{t('history.found', { count: historyResult?.meta.total ?? 0 })}</div>

            <div className="history-table-wrap">
              <table className="history-table" role="grid">
                <thead>
                  <tr>
                    <th>{t('history.columns.protocol')}</th>
                    <th>{t('history.columns.contact')}</th>
                    <th>{t('history.columns.agent')}</th>
                    <th>{t('history.columns.channel')}</th>
                    <th>{t('history.columns.group')}</th>
                    <th>{t('history.columns.status')}</th>
                    <th>{t('history.columns.duration')}</th>
                    <th>{t('history.columns.waitTime')}</th>
                    <th>{t('history.columns.csat')}</th>
                    <th>{t('history.columns.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(historyResult?.data ?? []).map((conversation) => (
                    <tr key={conversation.id}>
                      <td>
                        <button
                          type="button"
                          className="history-protocol-btn"
                          onClick={(event) => {
                            returnFocusRef.current = event.currentTarget;
                            setSelectedConversationId(conversation.id);
                          }}
                        >
                          {conversation.protocol_number ?? '—'}
                        </button>
                      </td>
                      <td><ContactCell conversation={conversation} /></td>
                      <td><AgentCell conversation={conversation} /></td>
                      <td>
                        <span className="history-channel-chip">
                          {channelIcon(conversation.channel_type)}
                          <span>{conversation.channel_type}</span>
                        </span>
                      </td>
                      <td>{conversation.bot_department ?? '—'}</td>
                      <td>
                        <span className={`status-badge ${STATUS_BADGE_CLASS[conversation.status] ?? 'status-open'}`}>
                          {t(`status.${conversation.status}`)}
                        </span>
                      </td>
                      <td>{formatDuration(conversation.duration_seconds)}</td>
                      <td>{formatDuration(conversation.wait_seconds)}</td>
                      <td><CSATCell score={conversation.csat_score} /></td>
                      <td>{formatRelativeDate(conversation.created_at, i18n.language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!isLoading && (historyResult?.data.length ?? 0) === 0 ? (
                <div className="zd-empty-state history-empty">
                  <div className="zd-empty-icon" aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                      <path d="M5 4.5h12v10H9l-4 3v-3H5v-10Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>{t('history.noResults')}</div>
                  <div className="history-empty-hint">{t('history.noResultsHint')}</div>
                </div>
              ) : null}
            </div>

            <div className="history-pagination">
              <button
                type="button"
                className="zd-btn"
                disabled={currentPage <= 1}
                onClick={() => updateFilterParams({ page: String(Math.max(1, currentPage - 1)) }, false)}
              >
                ‹
              </button>
              <span>
                {currentPage} / {Math.max(totalPages, 1)}
              </span>
              <button
                type="button"
                className="zd-btn"
                disabled={totalPages === 0 || currentPage >= totalPages}
                onClick={() => updateFilterParams({ page: String(currentPage + 1) }, false)}
              >
                ›
              </button>
            </div>

            {selectedConversationId ? (
              <div className="history-detail-overlay" role="dialog" aria-modal="true" aria-labelledby="history-detail-title">
                <div className="history-detail-panel" ref={detailPanelRef} tabIndex={-1}>
                  <div className="history-detail-header">
                    <div>
                      <h2 id="history-detail-title">{t('history.detail.title')}</h2>
                      <p>{detailData?.conversation.protocol_number ?? '—'}</p>
                    </div>
                    <button
                      className="zd-btn"
                      type="button"
                      onClick={closeDetail}
                      aria-label={t('history.detail.close')}
                    >
                      {t('tenantAdmin.common.close', { ns: 'admin' })}
                    </button>
                  </div>

                  {isDetailLoading ? (
                    <div className="history-detail-loading">{t('history.loading')}</div>
                  ) : detailData ? (
                    <div className="history-detail-content">
                      <section className="history-detail-section">
                        <h3>{t('history.columns.contact')}</h3>
                        <div className="history-detail-grid">
                          <div>
                            <strong>{detailData.conversation.contact_name || '—'}</strong>
                            <span>{detailData.conversation.contact_whatsapp || detailData.conversation.contact_phone || '—'}</span>
                          </div>
                          <div>
                            <strong>{t('history.columns.agent')}</strong>
                            <span>{detailData.conversation.assigned_name || '—'}</span>
                          </div>
                          <div>
                            <strong>{t('history.columns.status')}</strong>
                            <span>{t(`status.${detailData.conversation.status}`)}</span>
                          </div>
                          <div>
                            <strong>{t('history.columns.group')}</strong>
                            <span>{(detailData.conversation.metadata?.bot_department as string | undefined) ?? '—'}</span>
                          </div>
                        </div>
                      </section>

                      <section className="history-detail-section">
                        <h3>{t('history.detail.timeline')}</h3>
                        {detailData.timeline.length > 0 ? (
                          <div className="history-timeline-list">
                            {detailData.timeline.map((event) => (
                              <div key={event.id} className="history-timeline-item">
                                <div className="history-timeline-dot" aria-hidden />
                                <div className="history-timeline-content">
                                  <div className="history-timeline-head">
                                    <strong>{event.title}</strong>
                                    <span>{new Date(event.created_at).toLocaleString(i18n.language)}</span>
                                  </div>
                                  {event.description ? <p>{event.description}</p> : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <HistoryDetailEmpty title={t('history.detail.emptyTimelineTitle')} hint={t('history.detail.emptyTimelineHint')} />
                        )}
                      </section>

                      <section className="history-detail-section">
                        <h3>{t('history.detail.transcript')}</h3>
                        {detailData.transcript.length > 0 ? (
                          <div className="history-transcript-list">
                            {detailData.transcript.map((message) => (
                              <article key={message.id} className="history-transcript-item">
                                <header>
                                  <strong>{message.sender_name || message.sender_type}</strong>
                                  <span>{new Date(message.created_at).toLocaleString(i18n.language)}</span>
                                </header>
                                <p>{message.content || `(${message.content_type})`}</p>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <HistoryDetailEmpty title={t('history.detail.emptyTranscriptTitle')} hint={t('history.detail.emptyTranscriptHint')} />
                        )}
                      </section>

                      <section className="history-detail-section">
                        <h3>{t('history.detail.csat')}</h3>
                        {detailData.conversation.csat_score || detailData.conversation.csat_comment ? (
                          <div className="history-csat-block">
                            <CSATCell score={detailData.conversation.csat_score} />
                            <p>{detailData.conversation.csat_comment || '—'}</p>
                          </div>
                        ) : (
                          <HistoryDetailEmpty title={t('history.detail.emptyCsatTitle')} hint={t('history.detail.emptyCsatHint')} />
                        )}
                      </section>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            </>
          ) : (
            <GoalsConfig />
          )}
        </div>
      </div>
    </PageShell>
  );
}
