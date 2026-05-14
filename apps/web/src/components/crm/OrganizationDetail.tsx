import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { CrmOrganization, CrmContact } from '../../services/api';
import { adminApi, omnichannelApi, organizationsApi } from '../../services/api';
import { ContactAvatar } from './ContactAvatar';
import { OrgStatusBadge } from './ContactBadge';
import { OrganizationStats } from './OrganizationStats';
import { ContactCard } from './ContactCard';
import { EditOrganizationModal } from './EditOrganizationModal';
import { CreateContactModal } from './CreateContactModal';
import { EditContactModal } from './EditContactModal';
import { SelectChannelModal } from './SelectChannelModal';
import { useToast } from '../../stores/toast.store';

type Tab = 'data' | 'contacts' | 'conversations' | 'tickets' | 'notes';

const CH_BADGE: Record<string, { color: string; label: string }> = {
  whatsapp: { color: '#25D366', label: 'WhatsApp' },
  instagram:{ color: 'var(--pink)', label: 'Instagram' },
  email:    { color: 'var(--blue)', label: 'E-mail' },
  live_chat:{ color: 'var(--txt-2)', label: 'Chat' },
};

const TICKET_STATUS_COLORS: Record<string, string> = {
  open:        'var(--blue)',
  in_progress: 'var(--amber)',
  waiting:     'var(--amber)',
  resolved:    'var(--green)',
  closed:      'var(--txt-3)',
};

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

interface Props {
  org: CrmOrganization;
  onUpdated?: () => void;
}

export function OrganizationDetail({ org, onUpdated }: Props) {
  const { t } = useTranslation('crm');
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
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [conversationTargetContact, setConversationTargetContact] = useState<CrmContact | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['org-stats', org.id],
    queryFn:  () => organizationsApi.getStats(org.id),
  });

  const { data: orgContacts = [], isLoading: contactsLoading } = useQuery({
    queryKey: ['org-contacts', org.id],
    queryFn:  () => organizationsApi.getContacts(org.id),
    enabled:  activeTab === 'contacts',
  });

  const { data: activeChannels = [] } = useQuery({
    queryKey: ['crm-active-channels'],
    queryFn: async () => {
      const list = await adminApi.listChannels();
      return list.filter((channel) => channel.status === 'active');
    },
    staleTime: 60_000,
  });

  const { data: convData, isLoading: convsLoading } = useQuery({
    queryKey: ['org-conversations', org.id],
    queryFn:  () => organizationsApi.getConversations(org.id),
    enabled:  activeTab === 'conversations',
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
      toast.success('Notas salvas');
      onUpdated?.();
    },
    onError: () => toast.error('Erro ao salvar notas'),
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

  type OrgConv = { id: string; channel_type: string; channel_name: string | null; client_name: string | null; last_message: string | null; last_message_at: string | null; status: string; created_at: string };
  type OrgTicket = { id: string; title: string; status: string; priority: string; created_at: string };

  const rawConvData = convData as { data?: OrgConv[] } | OrgConv[] | undefined;
  const conversations: OrgConv[] = Array.isArray(rawConvData) ? rawConvData : (rawConvData as { data?: OrgConv[] } | undefined)?.data ?? [];

  const rawTicketData = ticketData as { data?: OrgTicket[] } | OrgTicket[] | undefined;
  const tickets: OrgTicket[] = Array.isArray(rawTicketData) ? rawTicketData : (rawTicketData as { data?: OrgTicket[] } | undefined)?.data ?? [];

  async function createConversationByChannel(channelId: string, preferredContact?: CrmContact | null) {
    const contacts = orgContacts.length > 0 ? orgContacts : await organizationsApi.getContacts(org.id);
    const targetContact =
      preferredContact
      ?? conversationTargetContact
      ?? contacts.find((contact) => contact.is_primary)
      ?? contacts[0];
    if (!targetContact) {
      toast.error('Adicione um contato antes de iniciar conversa');
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
      toast.error('Não foi possível iniciar conversa');
    } finally {
      setCreatingConversation(false);
      setShowSelectChannel(false);
      setConversationTargetContact(null);
    }
  }

  async function handleStartConversation(preferredContact?: CrmContact | null) {
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
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt-3)', marginBottom: 6 }}>{org.document}</div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                    onClick={() => setEditOrg(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 'var(--r)', fontSize: 12, cursor: 'pointer', border: '1px solid var(--line-2)', background: 'var(--bg-4)', color: 'var(--txt-2)', fontFamily: 'var(--font)', fontWeight: 500 }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M1.5 8.5l1-1.5 5-5 1.5 1.5-5 5-2 .5.5-1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>
                  {t('organizations.actions.edit')}
                </button>
                <button
                  onClick={() => void handleStartConversation()}
                  disabled={creatingConversation}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 'var(--r)', fontSize: 12, cursor: 'pointer', border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', fontFamily: 'var(--font)', fontWeight: 600 }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M1.5 7.5V3a1 1 0 011-1h6a1 1 0 011 1v3.5a1 1 0 01-1 1H4.5l-3 2v-2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                  {t('organizations.actions.startConversation')}
                </button>
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
                  <KV label={t('organizations.fields.email')}   value={org.email} />
                  <KV label={t('organizations.fields.phone')}   value={org.phone} mono />
                  <KV label={t('organizations.fields.website')} value={org.website} />
                  <KV label={t('organizations.fields.document')} value={org.document} mono />
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
                    onStartConversation={() => { void handleStartConversation(c); }}
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
                  const badge = CH_BADGE[conv.channel_type];
                  return (
                    <div
                      key={conv.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                      onClick={() => navigate(`/omnichannel/conversations?conversation=${conv.id}`)}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: 'var(--r)', background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: badge?.color ?? 'var(--txt-3)', flexShrink: 0 }}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 9V4a2 2 0 012-2h6a2 2 0 012 2v3.5a2 2 0 01-2 2H6l-4 2V9z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--txt)' }}>{conv.client_name ?? '—'}</span>
                          <span style={{ fontSize: 10, color: 'var(--txt-3)', fontFamily: 'var(--mono)', flexShrink: 0, marginLeft: 8 }}>
                            {conv.last_message_at ? new Date(conv.last_message_at).toLocaleDateString('pt-BR') : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {badge?.label ?? conv.channel_type}
                          {conv.last_message ? ` · ${conv.last_message}` : ''}
                        </div>
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 'var(--r-pill)', background: 'var(--bg-4)', color: 'var(--txt-3)', border: '1px solid var(--line)', flexShrink: 0 }}>
                        {conv.status}
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
                      <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 1 }}>{ticket.status} · {ticket.priority}</div>
                    </div>
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
    </>
  );
}
