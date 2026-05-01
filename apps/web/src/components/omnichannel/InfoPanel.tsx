import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, contactsApi, conversationTags } from '../../services/api';
import { LinkOrganizationModal } from '../crm/LinkOrganizationModal';
import { TagDropdown } from './TagDropdown';

interface Conversation {
  id: string;
  status: string;
  channel_type: string;
  client_id: string | null;
  contact_id?: string | null;
  organization_id?: string | null;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_whatsapp?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_whatsapp?: string | null;
  organization_name?: string | null;
  assigned_name: string | null;
  channel_name: string | null;
  subject: string | null;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface ClientStats {
  total_conversations: number;
  total_messages: number;
  open_tickets: number;
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#667eea,#764ba2)',
  'linear-gradient(135deg,#f093fb,#f5576c)',
  'linear-gradient(135deg,#4facfe,#00f2fe)',
  'linear-gradient(135deg,#43e97b,#38f9d7)',
  'linear-gradient(135deg,#fa709a,#fee140)',
  'linear-gradient(135deg,#a18cd1,#fbc2eb)',
];

function avatarGradient(name: string | null) {
  const idx = (name?.charCodeAt(0) ?? 0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx] ?? AVATAR_GRADIENTS[0];
}

const CH_BADGE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  whatsapp: { bg: 'rgba(37,211,102,.15)', color: '#25D366', border: 'rgba(37,211,102,.25)', label: 'WhatsApp' },
  instagram:{ bg: 'rgba(244,114,182,.15)', color: '#F472B6', border: 'rgba(244,114,182,.25)', label: 'Instagram' },
  email:    { bg: 'var(--blue-dim)',      color: 'var(--blue)', border: 'rgba(96,165,250,.25)', label: 'E-mail' },
  live_chat:{ bg: 'var(--bg-5)',          color: 'var(--txt-2)', border: 'var(--line-2)', label: 'Chat' },
  chat:     { bg: 'var(--bg-5)',          color: 'var(--txt-2)', border: 'var(--line-2)', label: 'Chat' },
};

const TABS = ['contact', 'channels', 'history'] as const;
type Tab = typeof TABS[number];

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: '0.08em', color: 'var(--txt-3)',
      marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      {children}
      {action}
    </div>
  );
}

function Skeleton({ height = 20 }: { height?: number }) {
  return (
    <div
      style={{
        height,
        borderRadius: 'var(--r)',
        background: 'linear-gradient(90deg, var(--bg-3), var(--bg-5), var(--bg-3))',
        border: '1px solid var(--line)',
      }}
    />
  );
}

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function channelIcon(type: string | undefined) {
  const color = CH_BADGE[type ?? '']?.color ?? 'var(--txt-3)';
  if (type === 'whatsapp') {
    return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 10C2.5 12 4.5 13.5 7 13c3-.5 5-3 5-6a5 5 0 10-10 0c0 1.2.4 2.3 1 3.2L2 10z" stroke={color} strokeWidth="1.2" strokeLinejoin="round"/></svg>;
  }
  if (type === 'instagram') {
    return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="3" stroke={color} strokeWidth="1.2"/><circle cx="7" cy="7" r="2.5" stroke={color} strokeWidth="1.2"/><circle cx="10" cy="4" r=".8" fill={color}/></svg>;
  }
  if (type === 'email') {
    return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="3" width="11" height="8.5" rx="1.5" stroke={color} strokeWidth="1.2"/><path d="M1.5 5.5l5.5 3.5 5.5-3.5" stroke={color} strokeWidth="1.2"/></svg>;
  }
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 9V4a2 2 0 012-2h6a2 2 0 012 2v3.5a2 2 0 01-2 2H6l-4 2V9z" stroke={color} strokeWidth="1.2" strokeLinejoin="round"/></svg>;
}

function InfoField({
  icon,
  label,
  value,
  empty,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  empty?: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '7px 0', borderBottom: '1px solid var(--line)',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: 'var(--bg-4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, color: 'var(--txt-3)',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--txt-3)', marginBottom: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: value ? 'var(--txt)' : 'var(--txt-3)', fontStyle: value ? 'normal' : 'italic' }}>
          {value ?? empty ?? '—'}
        </div>
      </div>
    </div>
  );
}

interface Props {
  conversationId: string;
}

export function InfoPanel({ conversationId }: Props) {
  const { t } = useTranslation('omnichannel');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('contact');
  const [linkOrgOpen, setLinkOrgOpen] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);

  const { data } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { conversation: Conversation; messages: unknown[] };
      }>(`/omnichannel/conversations/${conversationId}`);
      return res.data.data;
    },
  });

  const conv = data?.conversation;
  const contactId = conv?.contact_id ?? conv?.client_id ?? null;

  const { data: contactData } = useQuery({
    queryKey: ['crm-contact', contactId],
    queryFn: () => contactsApi.get(contactId!),
    enabled: !!contactId,
  });

  const { data: clientStats, isLoading: statsLoading } = useQuery({
    queryKey: ['crm-client-stats', contactId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: ClientStats }>(`/crm/contacts/${contactId!}/stats`);
      return res.data.data;
    },
    enabled: !!contactId,
    retry: false,
  });

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['omnichannel-client-history', contactId, conversationId],
    queryFn: async () => {
      const params = new URLSearchParams({ contact_id: contactId!, per_page: '5' });
      const res = await api.get<{ success: boolean; data: Conversation[] }>(
        `/omnichannel/conversations?${params}`,
      );
      return res.data.data.filter((item) => item.id !== conversationId);
    },
    enabled: !!contactId,
  });

  const { data: convTags = [], refetch: refetchConvTags } = useQuery({
    queryKey: ['conversation-tags', conversationId],
    queryFn: () => conversationTags.getForConversation(conversationId),
    enabled: Boolean(conversationId),
  });

  const contactPhone =
    contactData?.whatsapp?.trim()
    || contactData?.phone?.trim()
    || conv?.contact_whatsapp?.trim()
    || conv?.client_whatsapp?.trim()
    || conv?.contact_phone?.trim()
    || conv?.client_phone?.trim()
    || null;
  const contactEmail = contactData?.email ?? conv?.contact_email ?? conv?.client_email ?? null;
  const contactName = (contactData?.name ?? conv?.contact_name ?? conv?.client_name ?? null)?.trim();
  const name = contactName || 'Cliente não identificado';
  const chBadge = CH_BADGE[conv?.channel_type ?? ''];
  const currentChannelSub =
    conv?.channel_type === 'email'
      ? contactEmail
      : conv?.channel_type === 'whatsapp'
        ? contactPhone
        : conv?.channel_name;

  async function handleRemoveTag(tagId: string) {
    await conversationTags.removeFromConversation(conversationId, tagId);
    await refetchConvTags();
    await qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
    await qc.invalidateQueries({ queryKey: ['conversations'] });
  }

  return (
    <div style={{
      width: 300, minWidth: 300,
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-2)',
      borderLeft: '1px solid var(--line)',
      overflow: 'hidden',
    }}>
      {/* Header with tabs */}
      <div style={{ padding: '16px 16px 0', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 2, marginBottom: 0 }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: 6,
                borderRadius: 'var(--r)',
                textAlign: 'center',
                fontSize: 11, fontWeight: 500,
                cursor: 'pointer', border: 'none',
                background: activeTab === tab ? 'var(--bg-4)' : 'transparent',
                color: activeTab === tab ? 'var(--txt)' : 'var(--txt-3)',
                transition: 'all .15s',
                marginBottom: 8,
              }}
            >
              {t(`info.${tab}`)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-5) transparent' }}>

        {activeTab === 'contact' && (
          <>
            {/* Contact card */}
            <div style={{
              padding: '20px 16px 16px',
              borderBottom: '1px solid var(--line)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              textAlign: 'center', gap: 10,
            }}>
              <div style={{
                width: 60, height: 60, borderRadius: '50%',
                background: avatarGradient(contactName ?? null),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, fontWeight: 700, color: '#fff',
                border: '3px solid var(--bg-4)',
              }}>
                {name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt)' }}>{name}</div>
                <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 2 }}>{t('info.client')}</div>
              </div>
              {chBadge && (
                <span style={{ padding: '2px 10px', borderRadius: 'var(--r-pill)', fontSize: 10, fontWeight: 500, background: chBadge.bg, color: chBadge.color, border: `1px solid ${chBadge.border}` }}>
                  {chBadge.label}
                </span>
              )}
              {/* Links CRM */}
              {contactId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', width: '100%' }}>
                  <button
                    onClick={() => navigate(`/crm/contacts?id=${contactId}`)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--teal)', fontSize: 11, fontWeight: 500, fontFamily: 'var(--font)', cursor: 'pointer', transition: 'all .15s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--teal-dim)'; e.currentTarget.style.borderColor = 'rgba(0,201,167,.3)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.borderColor = 'var(--line-2)'; }}
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M6 1h4v4M10 1L4 7M2 3H1v7h7V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {t('info.viewFullProfile')}
                  </button>

                  {contactData?.organization_id ? (
                    <button
                      onClick={() => navigate(`/crm/organizations?id=${contactData.organization_id}`)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--txt-2)', fontSize: 11, fontFamily: 'var(--font)', cursor: 'pointer', transition: 'all .15s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; }}
                    >
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><rect x="1" y="2.5" width="9" height="6.5" rx="1.3" stroke="currentColor" strokeWidth="1.1"/><path d="M3.5 2.5V2a1 1 0 011-1h2a1 1 0 011 1v.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
                      {contactData.organization_name}
                    </button>
                  ) : (
                    <button
                      onClick={() => setLinkOrgOpen(true)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--txt-3)', fontSize: 11, fontFamily: 'var(--font)', cursor: 'pointer', transition: 'all .15s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.color = 'var(--txt-2)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--txt-3)'; }}
                    >
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                      Vincular organização
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Stats mini */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              {statsLoading ? (
                <>
                  <Skeleton height={58} />
                  <Skeleton height={58} />
                  <Skeleton height={58} />
                </>
              ) : (
                ([
                  { val: contactId ? String(clientStats?.total_messages ?? 0) : '—', lbl: t('info.messages') },
                  { val: contactId ? String(clientStats?.total_conversations ?? 0) : '—', lbl: t('info.attendances') },
                  { val: contactId ? String(clientStats?.open_tickets ?? 0) : '—', lbl: 'Tickets abertos' },
                ] as { val: string; lbl: string }[]).map(({ val, lbl }) => (
                  <div key={lbl} style={{ background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '10px 12px' }}>
                    <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--txt)', letterSpacing: '-0.5px', fontFamily: 'var(--mono)' }}>{val}</div>
                    <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 1 }}>{lbl}</div>
                  </div>
                ))
              )}
            </div>

            {/* Contact info */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              <SectionTitle action={<span style={{ cursor: 'pointer', color: 'var(--teal)', fontSize: 10 }}>Editar</span>}>{t('info.information')}</SectionTitle>
              <InfoField
                label={t('info.email')}
                value={contactEmail}
                empty={t('info.notProvided')}
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points="22,6 12,13 2,6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
              <InfoField
                label={t('info.phone')}
                value={contactPhone}
                empty={t('info.notProvided')}
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.22 1.18 2 2 0 012.18 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.18 6.18l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
            </div>

            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', position: 'relative' }}>
              <SectionTitle
                action={(
                  <button
                    type="button"
                    onClick={() => setShowTagDropdown((value) => !value)}
                    style={{
                      border: 'none',
                      background: 'none',
                      color: 'var(--teal)',
                      cursor: 'pointer',
                      fontSize: 10,
                    }}
                  >
                    + {t('info.addTag', { defaultValue: 'Adicionar' })}
                  </button>
                )}
              >
                {t('info.tags', { defaultValue: 'Etiquetas' })}
              </SectionTitle>

              <div>
                {convTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="applied-tag"
                    style={{
                      background: `${tag.color}22`,
                      color: tag.color,
                      borderColor: `${tag.color}44`,
                    }}
                  >
                    {tag.name}
                    <button type="button" onClick={() => void handleRemoveTag(tag.id)}>×</button>
                  </span>
                ))}
                {convTags.length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--txt-3)' }}>
                    {t('info.noTags', { defaultValue: 'Nenhuma etiqueta aplicada' })}
                  </span>
                )}
              </div>

              {showTagDropdown && (
                <TagDropdown
                  conversationId={conversationId}
                  onClose={() => setShowTagDropdown(false)}
                />
              )}
            </div>

            {/* Quick actions */}
            <div style={{ padding: '14px 16px' }}>
              <SectionTitle>{t('info.quickActions')}</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                {[
                  { label: t('info.createProposal'), icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="2" width="9" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><path d="M4 5.5h4M4 7.5h2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg> },
                  { label: t('info.schedule'), icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="2" width="9" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><path d="M1.5 5h9" stroke="currentColor" strokeWidth="1.1"/><path d="M4 1.5v1.5M8 1.5v1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg> },
                  { label: t('info.viewTickets'), icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1"/><path d="M6 3.5v3l1.5 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg> },
                  { label: t('info.createTicket'), icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="2" width="9" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><path d="M6 5v4M4 7h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg> },
                ].map((a) => (
                  <button
                    key={a.label}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 'var(--r)', border: '1px solid var(--line)', background: 'var(--bg-3)', color: 'var(--txt-2)', fontSize: 11, fontWeight: 500, fontFamily: 'var(--font)', cursor: 'pointer', transition: 'all .15s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-5)'; e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.color = 'var(--txt)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--txt-2)'; }}
                  >
                    {a.icon}
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'channels' && (
          <div style={{ padding: '14px 16px' }}>
            <SectionTitle>{t('info.activeChannels')}</SectionTitle>
            <div>
              {conv && chBadge ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: chBadge.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {channelIcon(conv.channel_type)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--txt)', fontWeight: 500 }}>{chBadge.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--txt-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentChannelSub ?? '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>{relativeTime(conv.last_message_at ?? conv.created_at)}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 18, background: 'var(--bg-5)', borderRadius: 'var(--r-pill)', fontSize: 10, color: 'var(--txt-2)', marginTop: 2, padding: '0 7px' }}>Atual</div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--txt-3)', padding: '8px 0' }}>—</div>
              )}
              {contactId && (
                <button
                  onClick={() => navigate(`/crm/contacts?id=${contactId}`)}
                  style={{ marginTop: 12, width: '100%', padding: '8px 10px', borderRadius: 'var(--r)', border: '1px solid var(--line)', background: 'var(--bg-3)', color: 'var(--teal)', fontSize: 11, fontWeight: 500, fontFamily: 'var(--font)', cursor: 'pointer' }}
                >
                  Ver perfil completo
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div style={{ padding: '14px 16px' }}>
            <SectionTitle>{t('info.recentActivity')}</SectionTitle>
            {historyLoading ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <Skeleton height={52} />
                <Skeleton height={52} />
                <Skeleton height={52} />
              </div>
            ) : !contactId || history.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--txt-3)', padding: '8px 0' }}>Nenhum atendimento anterior</div>
            ) : (
              <div>
                {history.map((item) => {
                  const badge = CH_BADGE[item.channel_type];
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigate(`/omnichannel/conversations?conversation=${item.id}`)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', border: 'none', borderBottom: '1px solid var(--line)', background: 'transparent', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font)' }}
                    >
                      <div style={{ width: 28, height: 28, borderRadius: 7, background: badge?.bg ?? 'var(--bg-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {channelIcon(item.channel_type)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--txt)', fontWeight: 500 }}>{badge?.label ?? item.channel_type}</div>
                        <div style={{ fontSize: 11, color: 'var(--txt-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.last_message ?? item.subject ?? 'Sem mensagens'}
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                        {relativeTime(item.last_message_at ?? item.created_at)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {contactId && linkOrgOpen && (
        <LinkOrganizationModal
          open={linkOrgOpen}
          onClose={() => setLinkOrgOpen(false)}
          contactId={contactId}
          contactName={name}
        />
      )}
    </div>
  );
}
