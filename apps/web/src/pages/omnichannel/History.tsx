import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/layout/PageShell';
import { AudioPlayer } from '../../components/omnichannel/AudioPlayer';
import {
  omnichannelApi,
  type HistoryFiltersParams,
  type HistoryPeriodPreset,
  type OmnichannelHistoryConversation,
  type OmnichannelHistoryMessage,
} from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { GoalsConfig } from './GoalsConfig';

type SortBy =
  | 'created_at' | 'protocol_number' | 'contact_name' | 'assigned_name'
  | 'channel_type' | 'status' | 'duration_seconds' | 'wait_seconds' | 'csat_score';
type SortOrder = 'asc' | 'desc';

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
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(isoDate))
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
    return <span className="history-muted">—</span>;
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

function HistoryMediaLoading() {
  const { t } = useTranslation('omnichannel');

  return (
    <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>
      {t('queue.previewLoadingMedia')}
    </span>
  );
}

function HistoryMedia({
  message,
  conversationId,
}: {
  message: OmnichannelHistoryMessage;
  conversationId: string;
}) {
  const { t } = useTranslation('omnichannel');
  const resolvedUrl = useMediaUrl(message.media_url, conversationId);

  if (message.content_type === 'audio' && message.media_url) {
    if (!resolvedUrl) return <HistoryMediaLoading />;
    return <AudioPlayer src={resolvedUrl} />;
  }

  if (message.content_type === 'image' && message.media_url) {
    if (!resolvedUrl) return <HistoryMediaLoading />;
    return (
      <img
        src={resolvedUrl}
        alt={message.content ?? 'imagem'}
        style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8, display: 'block' }}
      />
    );
  }

  if (message.content_type === 'video' && message.media_url) {
    if (!resolvedUrl) return <HistoryMediaLoading />;
    return (
      <video
        src={resolvedUrl}
        controls
        style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8, display: 'block' }}
      />
    );
  }

  if (message.content_type === 'document' && message.media_url) {
    if (!resolvedUrl) return <HistoryMediaLoading />;
    return (
      <a
        href={resolvedUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--teal)', fontSize: 13 }}
      >
        {message.content ?? t('history.downloadDocument', 'Baixar documento')}
      </a>
    );
  }

  return <p>{message.content || `(${message.content_type})`}</p>;
}

function getTranscriptItemClass(message: OmnichannelHistoryMessage): string {
  const senderType = message.sender_type.toLowerCase();
  let variant = 'is-client';

  if (senderType === 'agent') {
    variant = 'is-agent';
  } else if (senderType === 'bot') {
    variant = 'is-bot';
  } else if (senderType === 'system') {
    variant = 'is-system';
  }

  return [
    'history-transcript-item',
    variant,
    message.is_internal ? 'is-internal' : '',
  ].filter(Boolean).join(' ');
}

function SortableHeader({
  column,
  label,
  currentSort,
  currentOrder,
  onSort,
}: {
  column: SortBy;
  label: string;
  currentSort: SortBy;
  currentOrder: SortOrder;
  onSort: (col: SortBy) => void;
}) {
  const isActive = currentSort === column;
  return (
    <th
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      onClick={() => onSort(column)}
      aria-sort={isActive ? (currentOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden
          style={{ opacity: isActive ? 1 : 0.3, flexShrink: 0 }}
        >
          {isActive && currentOrder === 'asc' ? (
            <path d="M5 2L8.5 7H1.5L5 2Z" fill="currentColor" />
          ) : (
            <path d="M5 8L1.5 3H8.5L5 8Z" fill="currentColor" />
          )}
        </svg>
      </span>
    </th>
  );
}

export function HistoryPage() {
  const { t, i18n } = useTranslation('omnichannel');
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'history' | 'goals'>('history');
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');
  const [sortBy, setSortBy] = useState<SortBy>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  useEffect(() => {
    setSearchDraft(filters.search ?? '');
  }, [filters.search]);

  const { data: historyResult, isLoading } = useQuery({
    queryKey: ['omnichannel-history', filters, sortBy, sortOrder],
    queryFn: () => omnichannelApi.listHistory({ ...filters, sort_by: sortBy, sort_order: sortOrder }),
    placeholderData: keepPreviousData,
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
      values.set(row.bot_option_id, row.department_name ?? row.bot_option_id);
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

  const handleSort = useCallback((column: SortBy) => {
    setSortBy((prev) => {
      if (prev === column) {
        setSortOrder((prevOrder) => (prevOrder === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortOrder('desc');
      return column;
    });
    updateFilterParams({ page: '1' }, false);
  }, [updateFilterParams]);

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
      toast.error(t('history.exportError'));
    }
  };

  const currentPage = filters.page ?? 1;
  const totalPages = historyResult?.meta.totalPages ?? 0;

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div className="monitor-page history-page">
        {activeTab === 'history' ? (
          <div className="monitor-header history-header" style={{ justifyContent: 'flex-end' }}>
            <button className="zd-btn zd-btn-primary" type="button" onClick={handleExport}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                <path d="M6.5 1.5v6M4 5l2.5 2.5L9 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2.5 8.5v2h8v-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('history.exportCsv')}
            </button>
          </div>
        ) : null}

        <div className="history-tabs" role="tablist" aria-label={t('history.tabs.label')}>
          <button
            type="button"
            className={activeTab === 'history' ? 'active' : ''}
            onClick={() => setActiveTab('history')}
            role="tab"
            aria-selected={activeTab === 'history'}
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
            role="tab"
            aria-selected={activeTab === 'goals'}
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
              {isLoading ? (
                <div className="history-loading-state" role="status" aria-live="polite">
                  <div className="history-loading-spinner" aria-hidden />
                  <span>{t('history.loading')}</span>
                </div>
              ) : (historyResult?.data.length ?? 0) === 0 ? (
                <div className="zd-empty-state history-empty">
                  <div className="zd-empty-icon" aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                      <path d="M5 4.5h12v10H9l-4 3v-3H5v-10Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>{t('history.noResults')}</div>
                  <div className="history-empty-hint">{t('history.noResultsHint')}</div>
                </div>
              ) : (
                <table className="history-table" role="grid">
                  <thead>
                    <tr>
                      <SortableHeader column="protocol_number"  label={t('history.columns.protocol')}  currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                      <SortableHeader column="contact_name"     label={t('history.columns.contact')}    currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                      <SortableHeader column="assigned_name"    label={t('history.columns.agent')}      currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                      <SortableHeader column="channel_type"     label={t('history.columns.channel')}    currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                      <th>{t('history.columns.group')}</th>
                      <SortableHeader column="status"           label={t('history.columns.status')}     currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                      <SortableHeader column="duration_seconds" label={t('history.columns.duration')}   currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                      <SortableHeader column="wait_seconds"     label={t('history.columns.waitTime')}   currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                      <SortableHeader column="csat_score"       label={t('history.columns.csat')}       currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                      <SortableHeader column="created_at"       label={t('history.columns.date')}       currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {(historyResult?.data ?? []).map((conversation) => (
                      <tr
                        key={conversation.id}
                        style={{ cursor: 'pointer' }}
                        onClick={(event) => {
                          returnFocusRef.current = event.currentTarget;
                          setSelectedConversationId(conversation.id);
                        }}
                      >
                        <td>
                          <span className="history-protocol-btn">
                            {conversation.protocol_number ?? '—'}
                          </span>
                        </td>
                        <td><ContactCell conversation={conversation} /></td>
                        <td><AgentCell conversation={conversation} /></td>
                        <td>
                          <span className="history-channel-chip">
                            {channelIcon(conversation.channel_type)}
                            <span>{conversation.channel_type}</span>
                          </span>
                        </td>
                        <td>{conversation.department_name ?? '—'}</td>
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
              )}
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
                            <span>{detailData.conversation.department_name ?? '—'}</span>
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

                      <section className="history-detail-section is-transcript">
                        <h3>{t('history.detail.transcript')}</h3>
                        {detailData.transcript.length > 0 ? (
                          <div className="history-transcript-list">
                            {detailData.transcript.map((message) => (
                              <article key={message.id} className={getTranscriptItemClass(message)}>
                                <header>
                                  <strong>{message.sender_name || message.sender_type}</strong>
                                  <span>{new Date(message.created_at).toLocaleString(i18n.language)}</span>
                                </header>
                                <HistoryMedia
                                  message={message}
                                  conversationId={selectedConversationId!}
                                />
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
