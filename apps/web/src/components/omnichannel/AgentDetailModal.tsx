import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { omnichannelApi, type OmnichannelPerformanceAgent, type HistoryPeriodPreset } from '../../services/api';

interface Props {
  agent: OmnichannelPerformanceAgent;
  period: string;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  onClose: () => void;
}

function toHistoryPeriod(period: string): HistoryPeriodPreset {
  if (period === 'last_week') return '7d';
  if (period === 'last_month') return '30d';
  return period as HistoryPeriodPreset;
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)}h`;
  return `${Math.round(minutes)}min`;
}

function formatCsat(score: number | null): string {
  if (score === null) return '—';
  return score.toFixed(1);
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: 'var(--bg-3)',
      border: '1px solid var(--line)',
      borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{
        fontSize: 10,
        color: 'var(--txt-2)',
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        marginBottom: 6,
        fontWeight: 600,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 20,
        fontWeight: 700,
        color,
        fontFamily: 'var(--mono)',
        lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  );
}

function statusColors(status: string): { bg: string; color: string } {
  if (status === 'closed') return { bg: 'var(--bg-4)', color: 'var(--txt-2)' };
  if (status === 'waiting') return { bg: 'color-mix(in srgb, var(--amber) 15%, transparent)', color: 'var(--amber)' };
  return { bg: 'color-mix(in srgb, var(--teal) 15%, transparent)', color: 'var(--teal)' };
}

export function AgentDetailModal({ agent, period, dateFrom, dateTo, onClose }: Props) {
  const { t, i18n } = useTranslation('omnichannel');
  const navigate = useNavigate();

  const effectivePeriod = toHistoryPeriod(period);

  const { data: historyData, isLoading } = useQuery({
    queryKey: ['agent-detail-history', agent.agent_id, effectivePeriod, dateFrom, dateTo],
    queryFn: () => {
      const params = {
        assigned_to: agent.agent_id,
        period: effectivePeriod,
        per_page: 15,
        sort_by: 'created_at' as const,
        sort_order: 'desc' as const,
        ...(dateFrom !== undefined ? { date_from: dateFrom } : {}),
        ...(dateTo !== undefined ? { date_to: dateTo } : {}),
      };
      return omnichannelApi.listHistory(params);
    },
    staleTime: 30_000,
  });

  const cards = [
    { label: t('performance.columns.volume'), value: String(agent.total_conversations), color: 'var(--txt)' },
    { label: t('performance.columns.tma'),    value: formatMinutes(agent.avg_tma_minutes),  color: 'var(--blue)' },
    { label: t('performance.columns.tme'),    value: formatMinutes(agent.avg_tme_minutes),  color: 'var(--teal)' },
    { label: t('performance.columns.sla'),    value: agent.sla_percent !== null ? `${agent.sla_percent}%` : '—', color: 'var(--green)' },
    { label: t('performance.columns.csat'),   value: formatCsat(agent.avg_csat), color: 'var(--amber)' },
  ];

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  function openConversation(conversationId: string) {
    onClose();
    navigate(`/omnichannel/conversations?conversation=${encodeURIComponent(conversationId)}`);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        width: '100%',
        maxWidth: 680,
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {agent.avatar_url ? (
              <img
                src={agent.avatar_url}
                alt=""
                style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'var(--teal)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 700,
                color: '#fff',
                flexShrink: 0,
              }}>
                {agent.agent_name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--txt)' }}>
                {agent.agent_name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                {t('performance.agentDetail.subtitle')}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--txt-2)',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
            }}
            aria-label={t('performance.agentDetail.close')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* Metric cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 8,
            marginBottom: 24,
          }}>
            {cards.map((card) => (
              <StatCard key={card.label} label={card.label} value={card.value} color={card.color} />
            ))}
          </div>

          {/* Recent conversations */}
          <div style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--txt-2)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            marginBottom: 10,
          }}>
            {t('performance.agentDetail.recentConversations')}
          </div>

          {isLoading && (
            <div style={{ color: 'var(--txt-2)', fontSize: 13, textAlign: 'center', padding: 24 }}>
              {t('performance.agentDetail.loading')}
            </div>
          )}

          {!isLoading && (historyData?.data.length ?? 0) === 0 && (
            <div style={{ color: 'var(--txt-2)', fontSize: 13, textAlign: 'center', padding: 24 }}>
              {t('performance.agentDetail.noConversations')}
            </div>
          )}

          {(historyData?.data.length ?? 0) > 0 && (
            <div style={{ fontSize: 12 }}>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '130px 1fr 80px 70px 70px 90px',
                gap: 8,
                padding: '6px 10px',
                background: 'var(--bg-3)',
                borderRadius: '6px 6px 0 0',
              }}>
                {[
                  t('performance.agentDetail.colProtocol'),
                  t('performance.agentDetail.colContact'),
                  t('performance.agentDetail.colStatus'),
                  t('performance.columns.tma'),
                  t('performance.agentDetail.colWait'),
                  t('performance.agentDetail.colDate'),
                ].map((col) => (
                  <div key={col} style={{
                    fontSize: 10,
                    color: 'var(--txt-2)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    fontWeight: 600,
                  }}>
                    {col}
                  </div>
                ))}
              </div>

              {/* Table rows */}
              {historyData!.data.map((conv, idx) => {
                const sc = statusColors(conv.status);
                return (
                  <div
                    key={conv.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '130px 1fr 80px 70px 70px 90px',
                      gap: 8,
                      padding: '8px 10px',
                      background: idx % 2 === 0 ? 'var(--bg-2)' : 'var(--bg-3)',
                      alignItems: 'center',
                      borderBottom: '1px solid var(--line)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      {conv.protocol_number ? (
                        <button
                          type="button"
                          className="agent-detail-protocol-btn"
                          title={t('performance.agentDetail.openConversation')}
                          aria-label={t('performance.agentDetail.openConversationWithProtocol', {
                            protocol: conv.protocol_number,
                          })}
                          onClick={() => openConversation(conv.id)}
                        >
                          {conv.protocol_number}
                        </button>
                      ) : (
                        <span style={{
                          color: 'var(--txt-3)',
                          fontFamily: 'var(--mono)',
                          fontSize: 11,
                        }}>
                          —
                        </span>
                      )}
                    </div>
                    <div style={{
                      color: 'var(--txt)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {conv.contact_name ?? conv.contact_whatsapp ?? '—'}
                    </div>
                    <div>
                      <span style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: sc.bg,
                        color: sc.color,
                        fontWeight: 600,
                      }}>
                        {conv.status}
                      </span>
                    </div>
                    <div style={{ color: 'var(--txt-2)', fontFamily: 'var(--mono)' }}>
                      {conv.duration_seconds ? formatMinutes(conv.duration_seconds / 60) : '—'}
                    </div>
                    <div style={{ color: 'var(--txt-2)', fontFamily: 'var(--mono)' }}>
                      {conv.wait_seconds !== null ? formatMinutes(conv.wait_seconds / 60) : '—'}
                    </div>
                    <div style={{ color: 'var(--txt-3)', fontSize: 11 }}>
                      {dateFormatter.format(new Date(conv.created_at))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
