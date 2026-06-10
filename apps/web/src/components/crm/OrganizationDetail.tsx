import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import type { CrmOrganization, CrmContact, CrmOrganizationConversation } from '../../services/api';
import { contactsApi, omnichannelApi, organizationsApi } from '../../services/api';
import { ContactAvatar } from './ContactAvatar';
import { OrgStatusBadge } from './ContactBadge';
import { OrganizationStats } from './OrganizationStats';
import { ContactCard } from './ContactCard';
import { EditOrganizationModal } from './EditOrganizationModal';
import { CreateContactModal } from './CreateContactModal';
import { EditContactModal } from './EditContactModal';
import { SelectChannelModal } from './SelectChannelModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Modal } from '../ui/Modal';
import { useToast } from '../../stores/toast.store';
import { useDebounce } from '../../hooks/useDebounce';
import { PiiReveal } from '../common/PiiReveal';
import { maskEmail, maskPhone, maskDocument } from '../../utils/pii-mask';

type Tab = 'data' | 'contacts' | 'conversations' | 'tickets' | 'notes';

const CH_BADGE: Record<string, { color: string }> = {
  whatsapp: { color: 'var(--green)' },
  instagram:{ color: 'var(--pink)' },
  email:    { color: 'var(--blue)' },
  live_chat:{ color: 'var(--txt-2)' },
};

function normalizeChannelType(channelType: string | null | undefined): 'whatsapp' | 'instagram' | 'email' | 'live_chat' | null {
  if (!channelType) return null;
  const normalized = channelType.trim().toLowerCase().replace('-', '_');
  if (normalized === 'whatsapp' || normalized === 'instagram' || normalized === 'email' || normalized === 'live_chat') {
    return normalized;
  }
  return null;
}

const CONVERSATION_STATUS_COLORS: Record<string, { fg: string; bg: string; border: string }> = {
  open:        { fg: 'var(--blue)', bg: 'var(--blue-dim)', border: 'rgba(96,165,250,.24)' },
  in_progress: { fg: 'var(--amber)', bg: 'var(--amber-dim)', border: 'rgba(245,158,11,.24)' },
  waiting:     { fg: 'var(--amber)', bg: 'var(--amber-dim)', border: 'rgba(245,158,11,.24)' },
  resolved:    { fg: 'var(--green)', bg: 'var(--green-dim)', border: 'rgba(62,207,142,.24)' },
  closed:      { fg: 'var(--txt-3)', bg: 'var(--bg-4)', border: 'var(--line-2)' },
};
const DEFAULT_CONVERSATION_STATUS_STYLE = { fg: 'var(--txt-3)', bg: 'var(--bg-4)', border: 'var(--line-2)' } as const;

const TICKET_STATUS_COLORS: Record<string, string> = {
  open:        'var(--blue)',
  in_progress: 'var(--amber)',
  waiting:     'var(--amber)',
  resolved:    'var(--green)',
  closed:      'var(--txt-3)',
};

function relativeDateLabel(dateStr: string | null | undefined, locale: string, t: TFunction<'crm'>): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t('organizations.time.now');
  if (mins < 60) return t('organizations.time.minutesAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('organizations.time.hoursAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  if (days < 7) return t('organizations.time.daysAgo', { count: days });
  return new Date(dateStr).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

function PiiField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 12 }}>{children}</span>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 12, color: value ? 'var(--txt)' : 'var(--txt-3)', fontFamily: mono ? 'var(--mono)' : 'var(--font)', fontStyle: value ? 'normal' : 'italic' }}>
        {value || '—'}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', marginBottom: 12, marginTop: 4 }}>
      {children}
    </div>
  );
}

function ConversationChannelIcon({ channelType }: { channelType: string | null }) {
  const channel = normalizeChannelType(channelType);
  if (channel === 'whatsapp') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M2 10C2.5 12 4.5 13 7 12.5c3-.5 5-3 5-6a5 5 0 10-10 0c0 1.2.4 2.3 1 3.2L2 10z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      </svg>
    );
  }
  if (channel === 'instagram') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="2" y="2" width="10" height="10" rx="3" stroke="currentColor" strokeWidth="1.2"/>
        <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.2"/>
        <circle cx="10" cy="4.2" r="0.8" fill="currentColor"/>
      </svg>
    );
  }
  if (channel === 'email') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="1.5" y="3" width="11" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M1.5 5l5.5 3.5L12.5 5" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2 9V4a2 2 0 012-2h6a2 2 0 012 2v3.5a2 2 0 01-2 2H6l-4 2V9z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  );
}

interface Props {
  org: CrmOrganization;
  onUpdated?: () => void;
}

export function OrganizationDetail({ org, onUpdated }: Props) {
  const { t, i18n } = useTranslation(['crm', 'common']);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('data');
  const [editOrg, setEditOrg] = useState(false);
  const [createContact, setCreateContact] = useState(false);
  const [editContact, setEditContact] = useState<CrmContact | null>(null);
  const [notes, setNotes] = useState(org.notes ?? '');
  const [notesDirty, setNotesDirty] = useState(false);
  const [showSelectChannel, setShowSelectChannel] = useState(false);
  const [, setCreatingConversation] = useState(false);
  const [conversationTargetContact, setConversationTargetContact] = useState<CrmContact | null>(null);
  const [unlinkContact, setUnlinkContact] = useState<CrmContact | null>(null);
  const [transferContact, setTransferContact] = useState<CrmContact | null>(null);
  const [transferSearchRaw, setTransferSearchRaw] = useState('');
  const [transferTargetOrgId, setTransferTargetOrgId] = useState<string | null>(null);
  const debouncedTransferSearch = useDebounce(transferSearchRaw, 250);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['org-stats', org.id],
    queryFn:  () => organizationsApi.getStats(org.id),
  });

  const { data: orgContacts = [], isLoading: contactsLoading } = useQuery({
    queryKey: ['org-contacts', org.id],
    queryFn:  () => organizationsApi.getContacts(org.id),
    enabled:  Boolean(org.id),
  });

  const { data: activeChannels = [] } = useQuery({
    queryKey: ['crm-active-channels'],
    queryFn: async () => {
      const list = await omnichannelApi.listConversationChannels();
      return list.filter((channel) => channel.status === 'active');
    },
    staleTime: 60_000,
  });

  const { data: convData, isLoading: convsLoading } = useQuery({
    queryKey: ['org-conversations', org.id],
    queryFn:  () => organizationsApi.getConversations(org.id),
    enabled:  activeTab === 'conversations',
  });

  const { data: transferOrgData, isLoading: transferOrgsLoading } = useQuery({
    queryKey: ['crm-organizations-transfer-search', debouncedTransferSearch],
    queryFn: () => {
      const params: Parameters<typeof organizationsApi.list>[0] = { per_page: 12 };
      if (debouncedTransferSearch.trim()) params.search = debouncedTransferSearch.trim();
      return organizationsApi.list(params);
    },
    enabled: transferContact !== null,
  });

  const { data: ticketData, isLoading: ticketsLoading } = useQuery({
    queryKey: ['org-tickets', org.id],
    queryFn:  () => organizationsApi.getTickets(org.id),
    enabled:  activeTab === 'tickets',
  });

  const saveNotesMutation = useMutation({
    mutationFn: () => organizationsApi.update(org.id, { notes }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-organizations'] });
      setNotesDirty(false);
      toast.success(t('organizations.messages.notesSaved'));
      onUpdated?.();
    },
    onError: () => toast.error(t('organizations.messages.notesSaveError')),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (contactId: string) => contactsApi.update(contactId, { organization_id: null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-contacts', org.id] });
      void queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-organizations'] });
      toast.success(t('unlinkSuccess'));
      setUnlinkContact(null);
    },
    onError: () => toast.error(t('organizations.messages.contactActionError')),
  });

  const transferMutation = useMutation({
    mutationFn: async ({ contactId, organizationId }: { contactId: string; organizationId: string }) =>
      contactsApi.update(contactId, { organization_id: organizationId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-contacts', org.id] });
      void queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-organizations'] });
      toast.success(t('transferSuccess'));
      setTransferContact(null);
      setTransferSearchRaw('');
      setTransferTargetOrgId(null);
    },
    onError: () => toast.error(t('organizations.messages.contactActionError')),
  });

  const statusLabels: Record<string, string> = {
    lead:     t('organizations.status.lead'),
    prospect: t('organizations.status.prospect'),
    client:   t('organizations.status.client'),
    inactive: t('organizations.status.inactive'),
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'data',          label: t('organizations.tabs.data') },
    { key: 'contacts',      label: t('organizations.tabs.contacts') },
    { key: 'conversations', label: t('organizations.tabs.conversations') },
    { key: 'tickets',       label: t('organizations.tabs.tickets') },
    { key: 'notes',         label: t('organizations.tabs.notes') },
  ];

  type OrgTicket = { id: string; title: string; status: string; priority: string; created_at: string };

  const conversations: CrmOrganizationConversation[] = convData?.data ?? [];

  const rawTicketData = ticketData as { data?: OrgTicket[] } | OrgTicket[] | undefined;
  const tickets: OrgTicket[] = Array.isArray(rawTicketData) ? rawTicketData : (rawTicketData as { data?: OrgTicket[] } | undefined)?.data ?? [];
  const channelLabels: Record<string, string> = {
    whatsapp: t('organizations.channels.whatsapp'),
    instagram: t('organizations.channels.instagram'),
    email: t('organizations.channels.email'),
    live_chat: t('organizations.channels.liveChat'),
  };
  const conversationStatusLabels: Record<string, string> = {
    open: t('organizations.conversations.statuses.open'),
    in_progress: t('organizations.conversations.statuses.inProgress'),
    waiting: t('organizations.conversations.statuses.waiting'),
    resolved: t('organizations.conversations.statuses.resolved'),
    closed: t('organizations.conversations.statuses.closed'),
  };
  const ticketStatusLabels: Record<string, string> = {
    open: t('organizations.tickets.statuses.open'),
    in_progress: t('organizations.tickets.statuses.inProgress'),
    waiting: t('organizations.tickets.statuses.waiting'),
    resolved: t('organizations.tickets.statuses.resolved'),
    closed: t('organizations.tickets.statuses.closed'),
  };
  const ticketPriorityLabels: Record<string, string> = {
    low: t('organizations.tickets.priorities.low'),
    medium: t('organizations.tickets.priorities.medium'),
    high: t('organizations.tickets.priorities.high'),
    urgent: t('organizations.tickets.priorities.urgent'),
  };
  const transferOrganizations = transferOrgData?.data.filter((item) => item.id !== org.id) ?? [];
  const primaryContact = orgContacts.find((contact) => contact.is_primary) ?? null;
  const canStartFromOrganization = !contactsLoading && primaryContact !== null;

  function getConversationTitle(conv: CrmOrganizationConversation): string {
    return conv.protocol ?? conv.id;
  }

  async function createConversationByChannel(channelId: string, preferredContact?: CrmContact | null) {
    const contacts = orgContacts.length > 0 ? orgContacts : await organizationsApi.getContacts(org.id);
    const targetContact =
      preferredContact
      ?? conversationTargetContact
      ?? contacts.find((contact) => contact.is_primary)
      ?? contacts[0];
    if (!targetContact) {
      toast.error(t('organizations.messages.addContactFirst'));
      return;
    }

    setCreatingConversation(true);
    try {
      const created = await omnichannelApi.createConversation({
        contact_id: targetContact.id,
        organization_id: org.id,
        channel_id: channelId,
        type: 'outbound',
        initial_message: `Olá ${targetContact.name}, iniciamos seu atendimento.`,
      });
      navigate(`/omnichannel/conversations?conversation=${created.id}`);
    } catch {
      toast.error(t('organizations.messages.conversationStartError'));
    } finally {
      setCreatingConversation(false);
      setShowSelectChannel(false);
      setConversationTargetContact(null);
    }
  }

  function handleStartConversation(contact: CrmContact) {
    navigate('/omnichannel/conversations', {
      state: {
        preselectedContact: {
          id: contact.id,
          name: contact.name,
          phone: contact.whatsapp ?? contact.phone,
          organizationId: org.id,
          organizationName: org.name,
        },
      },
    });
  }

  async function handleStartConversationByChannel(preferredContact?: CrmContact | null) {
    setConversationTargetContact(preferredContact ?? null);
    if (activeChannels.length === 0) {
      toast.error(t('contacts.hasNoActiveChannels', { defaultValue: 'Nenhum canal ativo disponível' }));
      return;
    }
    if (activeChannels.length === 1) {
      await createConversationByChannel(activeChannels[0]!.id, preferredContact);
      return;
    }
    setShowSelectChannel(true);
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-2)' }}>

        {/* Hero */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0, position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 80, background: 'radial-gradient(ellipse at top, var(--hero-glow), transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative' }}>
            <ContactAvatar id={org.id} name={org.name} size={72} style={{ border: '3px solid var(--bg-2)', boxShadow: '0 8px 24px rgba(102,126,234,.25)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.3px', color: 'var(--txt)', margin: 0 }}>{org.name}</h2>
                <OrgStatusBadge status={org.status} label={statusLabels[org.status] ?? org.status} />
              </div>
              {org.document && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt-3)', marginBottom: 6 }}>
                  <PiiReveal entityType="organization" entityId={org.id} maskedValue={maskDocument(org.document ?? null)} fullValue={org.document ?? null} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                    onClick={() => setEditOrg(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 'var(--r)', fontSize: 12, cursor: 'pointer', border: '1px solid var(--line-2)', background: 'var(--bg-4)', color: 'var(--txt-2)', fontFamily: 'var(--font)', fontWeight: 500 }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M1.5 8.5l1-1.5 5-5 1.5 1.5-5 5-2 .5.5-1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>
                  {t('organizations.actions.edit')}
                </button>
                {canStartFromOrganization ? (
                  <button
                    type="button"
                    className="tb-btn-primary"
                    onClick={() => handleStartConversation(primaryContact)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '5px 11px',
                      borderRadius: 'var(--r)',
                      fontSize: 12,
                      cursor: 'pointer',
                      border: '1px solid var(--teal)',
                      background: 'var(--teal)',
                      color: 'var(--on-teal)',
                      fontFamily: 'var(--font)',
                      fontWeight: 600,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="M14 10c0 .667-.167 1.167-.5 1.5S12.667 12 12 12H4l-2 2V4c0-.667.167-1.167.5-1.5S3.333 2 4 2h8c.667 0 1.167.167 1.5.5S14 3.333 14 4v6z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    {t('startConversation')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <OrganizationStats stats={stats} loading={statsLoading} />

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 16px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                border: 'none', borderBottom: `2px solid ${activeTab === tab.key ? 'var(--teal)' : 'transparent'}`,
                background: 'transparent', color: activeTab === tab.key ? 'var(--teal)' : 'var(--txt-3)',
                whiteSpace: 'nowrap', fontFamily: 'var(--font)', transition: 'all .15s',
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-5) transparent' }}>

          {/* ── Aba Dados ── */}
          {activeTab === 'data' && (
            <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <SectionTitle>{t('organizations.sections.generalInfo')}</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                  <PiiField label={t('organizations.fields.email')}>
                    <PiiReveal entityType="organization" entityId={org.id} maskedValue={maskEmail(org.email ?? null)} fullValue={org.email ?? null} />
                  </PiiField>
                  <PiiField label={t('organizations.fields.phone')}>
                    <PiiReveal entityType="organization" entityId={org.id} maskedValue={maskPhone(org.phone ?? null)} fullValue={org.phone ?? null} />
                  </PiiField>
                  <KV label={t('organizations.fields.website')} value={org.website} />
                  <PiiField label={t('organizations.fields.document')}>
                    <PiiReveal entityType="organization" entityId={org.id} maskedValue={maskDocument(org.document ?? null)} fullValue={org.document ?? null} />
                  </PiiField>
                </div>
              </div>
              <div>
                <SectionTitle>{t('organizations.sections.address')}</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                  <KV label={t('organizations.fields.street')} value={org.address_street} />
                  <KV label={t('organizations.fields.city')}   value={org.address_city} />
                  <KV label={t('organizations.fields.state')}  value={org.address_state} />
                  <KV label={t('organizations.fields.zip')}    value={org.address_zip} mono />
                </div>
              </div>
              <div>
                <SectionTitle>{t('organizations.sections.commercial')}</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                  <KV label={t('organizations.fields.segment')}     value={org.segment} />
                  <KV label={t('organizations.fields.leadSource')}  value={org.lead_source} />
                  <KV label={t('organizations.fields.responsible')} value={org.responsible_name} />
                </div>
              </div>
            </div>
          )}

          {/* ── Aba Contatos ── */}
          {activeTab === 'contacts' && (
            <div style={{ padding: '16px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--txt-3)' }}>{orgContacts.length} {t('organizations.fields.contacts')}</span>
                <button
                  onClick={() => setCreateContact(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--r)', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', fontFamily: 'var(--font)' }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  {t('organizations.actions.addContact')}
                </button>
              </div>
              {!contactsLoading && orgContacts.length > 0 && !primaryContact ? (
                <div style={{ fontSize: 11, color: 'var(--txt-3)', display: 'flex', alignItems: 'center', gap: 5, padding: '6px 0' }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M6 5.2V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <circle cx="6" cy="3.7" r=".7" fill="currentColor"/>
                  </svg>
                  {t('noPrimaryContactHint')}
                </div>
              ) : null}
              {contactsLoading ? (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>{t('organizations.loading')}</div>
              ) : orgContacts.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>{t('contacts.noResults')}</div>
              ) : (
                orgContacts.map((c) => (
                  <ContactCard
                    key={c.id}
                    contact={c}
                    onEdit={setEditContact}
                    onStartConversation={() => { void handleStartConversationByChannel(c); }}
                    onUnlink={() => setUnlinkContact(c)}
                    onTransfer={() => {
                      setTransferContact(c);
                      setTransferSearchRaw('');
                      setTransferTargetOrgId(null);
                    }}
                  />
                ))
              )}
            </div>
          )}

          {/* ── Aba Conversas ── */}
          {activeTab === 'conversations' && (
            <div style={{ padding: '16px 24px' }}>
              {convsLoading ? (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>{t('organizations.loading')}</div>
              ) : conversations.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>{t('organizations.conversations.empty')}</div>
              ) : (
                conversations.map((conv) => {
                  const normalizedChannelType = normalizeChannelType(conv.channel_type);
                  const badge = normalizedChannelType ? CH_BADGE[normalizedChannelType] : undefined;
                  const statusStyle = CONVERSATION_STATUS_COLORS[conv.status] ?? DEFAULT_CONVERSATION_STATUS_STYLE;
                  const title = getConversationTitle(conv);
                  const dateBase = conv.last_message_at ?? conv.created_at;
                  return (
                    <div
                      key={conv.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                      onClick={() => navigate(`/omnichannel/conversations?conversation=${conv.id}`)}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: 'var(--r)', background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: badge?.color ?? 'var(--txt-3)', flexShrink: 0 }}>
                        <ConversationChannelIcon channelType={conv.channel_type} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                          {title}
                        </div>
                        {conv.bot_department ? (
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--teal)', fontWeight: 500, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {conv.bot_department}
                          </span>
                        ) : null}
                        <div style={{ fontSize: 11, color: 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {conv.last_message?.trim() || (normalizedChannelType ? channelLabels[normalizedChannelType] : null) || t('organizations.conversations.noPreview')}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: statusStyle.bg, color: statusStyle.fg, border: `1px solid ${statusStyle.border}` }}>
                          {conversationStatusLabels[conv.status] ?? conv.status}
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
                          {relativeDateLabel(dateBase, i18n.language, t)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── Aba Tickets ── */}
          {activeTab === 'tickets' && (
            <div style={{ padding: '16px 24px' }}>
              {ticketsLoading ? (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>{t('organizations.loading')}</div>
              ) : tickets.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>{t('organizations.tickets.empty')}</div>
              ) : (
                tickets.map((ticket) => (
                  <div key={ticket.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: TICKET_STATUS_COLORS[ticket.status] ?? 'var(--txt-3)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 1 }}>
                        {ticketStatusLabels[ticket.status] ?? ticket.status}
                        {' · '}
                        {ticketPriorityLabels[ticket.priority] ?? ticket.priority}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
                      {relativeDateLabel(ticket.created_at, i18n.language, t)}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate(`/tickets/${ticket.id}`)}
                      style={{
                        height: 24,
                        borderRadius: 'var(--r)',
                        border: '1px solid var(--line-2)',
                        background: 'var(--bg-3)',
                        color: 'var(--txt-2)',
                        fontSize: 11,
                        padding: '0 8px',
                        fontFamily: 'var(--font)',
                        cursor: 'pointer',
                      }}
                    >
                      {t('organizations.tickets.openTicket')}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Aba Notas ── */}
          {activeTab === 'notes' && (
            <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
                placeholder={t('organizations.notes.placeholder')}
                style={{
                  flex: 1, minHeight: 200, width: '100%', borderRadius: 'var(--r)',
                  padding: '12px', fontSize: 13, lineHeight: 1.6,
                  background: 'var(--bg-3)', border: '1px solid var(--line)',
                  color: 'var(--txt)', outline: 'none', fontFamily: 'var(--font)', resize: 'vertical',
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{t('organizations.notes.hint')}</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => saveNotesMutation.mutate()}
                  disabled={!notesDirty || saveNotesMutation.isPending}
                  style={{
                    padding: '6px 16px', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600,
                    cursor: notesDirty && !saveNotesMutation.isPending ? 'pointer' : 'not-allowed',
                    border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)',
                    opacity: !notesDirty || saveNotesMutation.isPending ? 0.5 : 1, fontFamily: 'var(--font)',
                  }}
                >
                  {saveNotesMutation.isPending ? t('organizations.actions.savingNotes') : t('organizations.actions.saveNotes')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <EditOrganizationModal org={editOrg ? org : null} onClose={() => setEditOrg(false)} />
      <CreateContactModal open={createContact} onClose={() => setCreateContact(false)} defaultOrganizationId={org.id} />
      <EditContactModal contact={editContact} onClose={() => setEditContact(null)} />
      <SelectChannelModal
        open={showSelectChannel}
        channels={activeChannels.map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }))}
        onClose={() => setShowSelectChannel(false)}
        onSelect={(channelId) => { void createConversationByChannel(channelId, conversationTargetContact); }}
      />
      <ConfirmModal
        open={unlinkContact !== null}
        title={t('unlinkContact')}
        message={unlinkContact ? t('unlinkContactConfirm', { name: unlinkContact.name }) : ''}
        confirmLabel={t('confirm', { ns: 'common' })}
        cancelLabel={t('cancel', { ns: 'common' })}
        loading={unlinkMutation.isPending}
        onConfirm={() => {
          if (!unlinkContact) return;
          unlinkMutation.mutate(unlinkContact.id);
        }}
        onCancel={() => setUnlinkContact(null)}
      />

      <Modal
        open={transferContact !== null}
        onClose={() => {
          setTransferContact(null);
          setTransferSearchRaw('');
          setTransferTargetOrgId(null);
        }}
        title={t('transferContactTitle')}
        maxWidth="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
            {transferContact?.name}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ color: 'var(--txt-3)', flexShrink: 0 }} aria-hidden>
              <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder={t('searchOrganization')}
              value={transferSearchRaw}
              onChange={(e) => setTransferSearchRaw(e.target.value)}
              autoFocus
              style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--font)', color: 'var(--txt)', width: '100%' }}
            />
          </div>

          <div style={{ maxHeight: 240, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-5) transparent', border: '1px solid var(--line)', borderRadius: 'var(--r)', background: 'var(--bg-3)' }}>
            {transferOrgsLoading ? (
              <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>
                {t('organizations.loading')}
              </div>
            ) : transferOrganizations.length === 0 ? (
              <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>
                {t('organizations.noResults')}
              </div>
            ) : (
              transferOrganizations.map((targetOrg) => (
                <button
                  key={targetOrg.id}
                  type="button"
                  onClick={() => setTransferTargetOrgId(targetOrg.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    border: 'none',
                    borderBottom: '1px solid var(--line)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    background: transferTargetOrgId === targetOrg.id ? 'var(--teal-dim)' : 'transparent',
                  }}
                >
                  <ContactAvatar id={targetOrg.id} name={targetOrg.name} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: transferTargetOrgId === targetOrg.id ? 'var(--teal)' : 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {targetOrg.name}
                    </div>
                    {targetOrg.segment && (
                      <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{targetOrg.segment}</div>
                    )}
                  </div>
                  {transferTargetOrgId === targetOrg.id ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M2.5 7l3 3 6-6" stroke="var(--teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : null}
                </button>
              ))
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
            <button
              type="button"
              onClick={() => {
                setTransferContact(null);
                setTransferSearchRaw('');
                setTransferTargetOrgId(null);
              }}
              style={{ padding: '6px 14px', borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--txt-2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)' }}
            >
              {t('cancel', { ns: 'common' })}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!transferContact || !transferTargetOrgId) return;
                transferMutation.mutate({ contactId: transferContact.id, organizationId: transferTargetOrgId });
              }}
              disabled={!transferContact || !transferTargetOrgId || transferMutation.isPending}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--teal)',
                background: 'var(--teal)',
                color: 'var(--on-teal)',
                fontSize: 12,
                fontWeight: 600,
                cursor: transferContact && transferTargetOrgId && !transferMutation.isPending ? 'pointer' : 'not-allowed',
                opacity: transferContact && transferTargetOrgId && !transferMutation.isPending ? 1 : 0.5,
                fontFamily: 'var(--font)',
              }}
            >
              {transferMutation.isPending ? t('loading', { ns: 'common' }) : t('confirm', { ns: 'common' })}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
