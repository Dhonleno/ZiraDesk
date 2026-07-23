import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/layout/PageShell';
import { ConversationPreviewModal } from '../../components/omnichannel/ConversationPreviewModal';
import { omnichannelApi } from '../../services/api';
import { subscribeToEvent } from '../../services/socket';
import { useToast } from '../../stores/toast.store';

interface QueueConversation {
  id: string;
  contact?: { name?: string | null } | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_whatsapp?: string | null;
  contact_email?: string | null;
  organization_name?: string | null;
  protocol_number?: string | null;
  subject?: string | null;
  last_message?: string | null;
  queue_entered_at?: string | null;
  channel_type?: string | null;
  channel_name?: string | null;
  bot_group?: string | null;
  bot_subject?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface QueueResponse {
  data: QueueConversation[];
  meta?: { total?: number };
}

function formatQueueTime(dateStr: string | null | undefined, now = Date.now()): string {
  if (!dateStr) return '—';
  const diff = Math.max(0, now - new Date(dateStr).getTime());
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return 'agora';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h${mins % 60 > 0 ? ` ${mins % 60}min` : ''}`;
}

function queueTimeColor(dateStr: string | null | undefined, now = Date.now()): string {
  if (!dateStr) return 'var(--txt-3)';
  const mins = Math.floor((now - new Date(dateStr).getTime()) / 60000);
  if (mins > 60) return 'var(--red)';
  if (mins > 30) return 'var(--amber)';
  return 'var(--txt-3)';
}

function formatContactPhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (!digits) return null;

  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return value ?? digits;
}

function getContactName(conversation: QueueConversation, fallback: string): string {
  const directName = conversation.contact_name?.trim() || conversation.contact?.name?.trim();
  if (directName) return directName;

  const phone = formatContactPhone(conversation.contact_whatsapp ?? conversation.contact_phone);
  if (phone) return phone;

  return fallback;
}

function getContactInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return 'CT';
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? words[1]?.[0] ?? '' : words[0]?.[1] ?? '';
  return `${first}${second}`.toUpperCase();
}

function getQueueGroup(conversation: QueueConversation, fallback: string): string {
  const metadata = conversation.metadata ?? {};
  const directGroup = conversation.bot_group?.trim() ?? '';
  const group = typeof metadata['bot_group'] === 'string' ? metadata['bot_group'].trim() : '';
  return directGroup || group || fallback;
}

function getQueueSubject(conversation: QueueConversation, fallback: string): string {
  const metadata = conversation.metadata ?? {};
  const directSubject = conversation.bot_subject?.trim() ?? '';
  const subjectMeta = typeof metadata['bot_subject'] === 'string' ? metadata['bot_subject'].trim() : '';
  const tag = typeof metadata['bot_tag'] === 'string' ? metadata['bot_tag'].trim() : '';
  const subject = conversation.subject?.trim() ?? '';
  return directSubject || subjectMeta || tag || subject || fallback;
}

function ChannelBadge({ type }: { type?: string | null }) {
  if (!type) return null;
  const colors: Record<string, string> = {
    whatsapp: '#25D366',
    instagram: '#E1306C',
    email: 'var(--teal)',
  };
  const color = colors[type] ?? 'var(--txt-3)';

  if (type === 'whatsapp') {
    return (
      <span style={{ fontSize: 10, color, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}>
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M4.8 9.3 5.5 8.1c1.7.9 3 .1 3.6-.7.4-.5.5-1 .5-1.1-.5.2-1 .1-1.4-.2-.5-.4-.8-.9-1.2-1.4-.3-.3-.8-.4-1.2-.2-.8.4-1.2 1.5-.7 2.5.3.7.8 1.7 1.6 2.3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        WhatsApp
      </span>
    );
  }

  if (type === 'instagram') {
    return (
      <span style={{ fontSize: 10, color, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}>
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
          <rect x="2" y="2" width="10" height="10" rx="3" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="10.1" cy="3.9" r="0.6" fill="currentColor" />
        </svg>
        Instagram
      </span>
    );
  }

  if (type === 'email') {
    return (
      <span style={{ fontSize: 10, color, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}>
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
          <rect x="1.8" y="3" width="10.4" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
          <path d="m2.4 3.8 4.6 3.4 4.6-3.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        E-mail
      </span>
    );
  }

  return <span style={{ fontSize: 10, color, fontWeight: 500 }}>{type}</span>;
}

export function QueuePage() {
  const { t } = useTranslation('omnichannel');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [channelFilter, setChannelFilter] = useState('');
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [previewConversation, setPreviewConversation] = useState<{ id: string; contactName: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const { data, isLoading } = useQuery<QueueResponse>({
    queryKey: ['queue', channelFilter],
    queryFn: () => omnichannelApi.getQueue(channelFilter ? { channel_type: channelFilter } : {}),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const unsubCreated = subscribeToEvent('conversation:created', () => {
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
      void queryClient.invalidateQueries({ queryKey: ['queue-count'] });
    });
    const unsubAssigned = subscribeToEvent('conversation:assigned', () => {
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
      void queryClient.invalidateQueries({ queryKey: ['queue-count'] });
    });
    const unsubUpdated = subscribeToEvent('conversation:updated', () => {
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
      void queryClient.invalidateQueries({ queryKey: ['queue-count'] });
    });
    return () => {
      unsubCreated();
      unsubAssigned();
      unsubUpdated();
    };
  }, [queryClient]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleAssignMe = async (conversationId: string) => {
    setAssigningId(conversationId);
    try {
      await omnichannelApi.assignMe(conversationId);
      toast.success(t('queue.assignedSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
      void queryClient.invalidateQueries({ queryKey: ['queue-count'] });
      navigate('/omnichannel/conversations', {
        state: { openConversationId: conversationId },
      });
    } catch {
      toast.error(t('queue.assignedError'));
    } finally {
      setAssigningId(null);
    }
  };

  const conversations = data?.data ?? [];
  const total = data?.meta?.total ?? conversations.length;

  return (
    <PageShell padding={0}>
      {/* Page head */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 20px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg-2)',
        flexShrink: 0,
      }}>
        {total > 0 && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--teal)',
            background: 'var(--teal-dim)',
            borderRadius: 20,
            padding: '2px 8px',
          }}>
            {total} {t('queue.waiting', { count: total })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <select
          className="filter-select"
          style={{ width: 140 }}
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
        >
          <option value="">{t('queue.allChannels')}</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
          <option value="email">E-mail</option>
        </select>
      </div>

      {/* List */}
      <div style={{ overflowY: 'auto', flex: 1, height: '100%' }}>
        {isLoading && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--txt-3)', fontSize: 13 }}>
            {t('history.loading')}
          </div>
        )}

        {!isLoading && conversations.length === 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '60px 24px',
            color: 'var(--txt-3)',
          }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
              <circle cx="20" cy="20" r="19" stroke="var(--line-2)" strokeWidth="1.5" />
              <path d="M13 20h14M13 14h14M13 26h8"
                stroke="currentColor" strokeWidth="1.4"
                strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {t('queue.empty')}
            </span>
            <span style={{ fontSize: 11 }}>
              {t('queue.emptyHint')}
            </span>
          </div>
        )}

        {!isLoading && conversations.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(300px, 1fr) minmax(150px, 220px) minmax(160px, 240px) 140px 110px 196px',
              gap: 12,
              alignItems: 'center',
              padding: '10px 20px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--bg)',
              color: 'var(--txt-3)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            <span>{t('queue.columns.contact')}</span>
            <span>{t('queue.columns.group')}</span>
            <span>{t('queue.columns.subject')}</span>
            <span>{t('queue.columns.channel')}</span>
            <span style={{ textAlign: 'right' }}>{t('queue.columns.wait')}</span>
            <span style={{ textAlign: 'right' }}>{t('queue.columns.action')}</span>
          </div>
        )}

        {conversations.map((conv) => {
          const contactName = getContactName(conv, t('queue.unknownContact'));
          const contactMeta = conv.protocol_number
            ?? formatContactPhone(conv.contact_whatsapp ?? conv.contact_phone)
            ?? conv.contact_email
            ?? null;
          const group = getQueueGroup(conv, t('queue.unclassified'));
          const subject = getQueueSubject(conv, t('queue.noSubject'));

          return (
            <div
              key={conv.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(300px, 1fr) minmax(150px, 220px) minmax(160px, 240px) 140px 110px 196px',
                alignItems: 'center',
                gap: 12,
                padding: '14px 20px',
                borderBottom: '1px solid var(--line)',
                background: 'var(--bg-2)',
                transition: 'background .15s',
              }}
              onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--bg-3)'; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'var(--bg-2)'; }}
            >
              {/* Info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #A78BFA, #7C3AED)',
                    color: 'var(--txt)',
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: 'var(--font)',
                  }}
                >
                  {getContactInitials(contactName)}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--txt)',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {contactName}
                    </span>
                    {contactMeta && (
                      <span style={{
                        fontSize: 10,
                        fontFamily: 'var(--mono)',
                        color: 'var(--txt-3)',
                        whiteSpace: 'nowrap',
                      }}>
                        {contactMeta}
                      </span>
                    )}
                  </div>
                  <div style={{
                    marginTop: 2,
                    fontSize: 12,
                    color: 'var(--txt-2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {conv.last_message ?? '—'}
                  </div>
                </div>
              </div>

              <div style={{ minWidth: 0 }}>
                <span
                  title={group}
                  style={{
                    display: 'inline-flex',
                    maxWidth: '100%',
                    padding: '3px 9px',
                    borderRadius: 'var(--r-pill)',
                    border: '1px solid var(--line)',
                    background: 'var(--bg-3)',
                    color: 'var(--txt-2)',
                    fontSize: 11,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {group}
                </span>
              </div>

              <div style={{ minWidth: 0 }}>
                <span
                  title={subject}
                  style={{
                    display: 'inline-flex',
                    maxWidth: '100%',
                    padding: '3px 9px',
                    borderRadius: 'var(--r-pill)',
                    border: '1px solid rgba(96,165,250,.2)',
                    background: 'var(--blue-dim)',
                    color: 'var(--blue)',
                    fontSize: 11,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {subject}
                </span>
              </div>

              <div style={{ minWidth: 0 }}>
                <ChannelBadge type={conv.channel_type ?? null} />
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{
                  fontSize: 12,
                  color: queueTimeColor(conv.queue_entered_at, now),
                  fontFamily: 'var(--mono)',
                  fontWeight: 500,
                }}>
                  {formatQueueTime(conv.queue_entered_at, now)}
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="tb-btn"
                  aria-label={`${t('queue.preview')} — ${contactName}`}
                  onClick={(e) => { e.stopPropagation(); setPreviewConversation({ id: conv.id, contactName }); }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <circle cx="6" cy="6" r="3" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="6" cy="6" r="1" fill="currentColor" />
                  </svg>
                  {t('queue.preview')}
                </button>
                <button
                  type="button"
                  className="tb-btn tb-btn-primary"
                  aria-label={`${t('queue.assignMe')} — ${contactName}`}
                  onClick={(e) => { e.stopPropagation(); void handleAssignMe(conv.id); }}
                  disabled={assigningId === conv.id}
                >
                  {assigningId === conv.id ? (
                    <>
                      <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
                        <path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      {t('queue.assigning')}
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <circle cx="4" cy="3" r="1.6" stroke="currentColor" strokeWidth="1.4" />
                        <path d="M1 9.5c0-1.66 1.343-3 3-3h1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        <path d="M8.5 7.5 11 9.5l-2.5 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M11 9.5H8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                      {t('queue.assignMe')}
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {previewConversation && (
        <ConversationPreviewModal
          conversationId={previewConversation.id}
          contactName={previewConversation.contactName}
          isAssigning={assigningId === previewConversation.id}
          onClose={() => setPreviewConversation(null)}
          onAssign={() => {
            void handleAssignMe(previewConversation.id);
            setPreviewConversation(null);
          }}
        />
      )}
    </PageShell>
  );
}
