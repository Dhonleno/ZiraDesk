import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi, contactsApi, omnichannelApi, ticketsApi, type CrmContact } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { ContactAvatar } from './ContactAvatar';
import { EditContactModal } from './EditContactModal';
import { LinkOrganizationModal } from './LinkOrganizationModal';
import { SelectChannelModal } from './SelectChannelModal';

type Tab = 'data' | 'conversations' | 'tickets' | 'notes';

interface Props {
  contactId: string;
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString('pt-BR');
}

function InfoField({ label, value, link }: { label: string; value?: string | null; link?: string }) {
  const content = value?.trim() ? value : '—';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </span>
      {link && value ? (
        <Link to={link} style={{ fontSize: 13, color: 'var(--teal)' }}>
          {content}
        </Link>
      ) : (
        <span style={{ fontSize: 13, color: value ? 'var(--txt)' : 'var(--txt-3)', fontStyle: value ? 'normal' : 'italic' }}>
          {content}
        </span>
      )}
    </div>
  );
}

export function ContactDetail({ contactId }: Props) {
  const { t } = useTranslation('crm');
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('data');
  const [showEdit, setShowEdit] = useState(false);
  const [showLinkOrg, setShowLinkOrg] = useState(false);
  const [showSelectChannel, setShowSelectChannel] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);

  const { data: contact, isLoading } = useQuery({
    queryKey: ['crm-contact', contactId],
    queryFn: () => contactsApi.get(contactId),
    enabled: Boolean(contactId),
  });

  const { data: channels = [] } = useQuery({
    queryKey: ['crm-active-channels'],
    queryFn: async () => {
      const list = await adminApi.listChannels();
      return list.filter((channel) => channel.status === 'active');
    },
    staleTime: 60_000,
  });

  const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ['contact-conversations', contactId],
    queryFn: () => omnichannelApi.listConversations({ contact_id: contactId, per_page: 20 }),
    enabled: activeTab === 'conversations',
  });

  const { data: ticketsData, isLoading: ticketsLoading } = useQuery({
    queryKey: ['contact-tickets', contactId],
    queryFn: () => ticketsApi.list({ contact_id: contactId, per_page: 20, sort_by: 'created_at', sort_order: 'desc' }),
    enabled: activeTab === 'tickets',
  });

  const saveNotesMutation = useMutation({
    mutationFn: () => contactsApi.update(contactId, { notes }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-contact', contactId] });
      void queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      toast.success(t('contacts.notes.saved'));
      setNotesDirty(false);
    },
    onError: () => toast.error('Erro ao salvar notas'),
  });

  useEffect(() => {
    setNotes(contact?.notes ?? '');
    setNotesDirty(false);
  }, [contact?.id, contact?.notes]);

  const tabs: Array<{ key: Tab; label: string }> = useMemo(() => ([
    { key: 'data', label: t('contacts.tabs.data') },
    { key: 'conversations', label: t('contacts.tabs.conversations') },
    { key: 'tickets', label: t('contacts.tabs.tickets') },
    { key: 'notes', label: t('contacts.tabs.notes') },
  ]), [t]);

  async function createOutboundConversation(channelId: string) {
    if (!contact) return;
    setCreatingConversation(true);
    try {
      const created = await omnichannelApi.createConversation({
        contact_id: contact.id,
        channel_id: channelId,
        type: 'outbound',
        initial_message: `Olá ${contact.name}, iniciamos seu atendimento.`,
        ...(contact.organization_id ? { organization_id: contact.organization_id } : {}),
      });
      navigate(`/omnichannel/conversations?conversation=${created.id}`);
    } catch {
      toast.error('Não foi possível iniciar conversa');
    } finally {
      setCreatingConversation(false);
      setShowSelectChannel(false);
    }
  }

  async function handleStartConversation() {
    if (!channels.length) {
      toast.error(t('contacts.hasNoActiveChannels', { defaultValue: 'Nenhum canal ativo disponível' }));
      return;
    }
    if (channels.length === 1) {
      await createOutboundConversation(channels[0]!.id);
      return;
    }
    setShowSelectChannel(true);
  }

  if (isLoading || !contact) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', fontSize: 13 }}>
        {t('contacts.loading')}
      </div>
    );
  }

  const ticketRows = ticketsData?.data ?? [];

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-2)' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <ContactAvatar id={contact.id} name={contact.name} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--txt)' }}>{contact.name}</h2>
              {contact.role ? (
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--txt-3)' }}>{contact.role}</div>
              ) : null}
              <div style={{ marginTop: 8 }}>
                {contact.organization_name && contact.organization_id ? (
                  <Link to={`/crm/organizations?id=${contact.organization_id}`} style={{ fontSize: 12, color: 'var(--teal)' }}>
                    🏢 {contact.organization_name}
                  </Link>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--txt-3)', border: '1px solid var(--line)', borderRadius: 'var(--r-pill)', padding: '2px 8px' }}>
                    {t('contacts.standalone_badge')}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowEdit(true)}
                style={{ padding: '5px 10px', borderRadius: 'var(--r)', border: '1px solid var(--line)', background: 'var(--bg-3)', color: 'var(--txt-2)', fontSize: 12, cursor: 'pointer' }}
              >
                {t('contacts.actions.edit')}
              </button>
              <button
                onClick={() => void handleStartConversation()}
                disabled={creatingConversation}
                style={{ padding: '5px 10px', borderRadius: 'var(--r)', border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', fontSize: 12, cursor: 'pointer', opacity: creatingConversation ? 0.6 : 1 }}
              >
                {t('contacts.startConversation')}
              </button>
              {!contact.organization_id ? (
                <button
                  onClick={() => setShowLinkOrg(true)}
                  style={{ padding: '5px 10px', borderRadius: 'var(--r)', border: '1px solid var(--line)', background: 'var(--bg-3)', color: 'var(--txt-2)', fontSize: 12, cursor: 'pointer' }}
                >
                  {t('contacts.actions.link')}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', padding: '0 12px', gap: 2, flexShrink: 0 }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 12px',
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
                color: activeTab === tab.key ? 'var(--teal)' : 'var(--txt-3)',
                borderBottom: activeTab === tab.key ? '2px solid var(--teal)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {activeTab === 'data' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' }}>
              <InfoField label={t('contacts.fields.whatsapp')} value={contact.whatsapp} />
              <InfoField label={t('contacts.fields.phone')} value={contact.phone} />
              <InfoField label={t('contacts.fields.email')} value={contact.email} />
              <InfoField label={t('contacts.fields.document')} value={contact.document} />
              <InfoField label={t('contacts.fields.role')} value={contact.role} />
              <InfoField label={t('contacts.fields.department')} value={contact.department} />
              <InfoField
                label={t('contacts.fields.organization')}
                value={contact.organization_name}
                {...(contact.organization_id ? { link: `/crm/organizations?id=${contact.organization_id}` } : {})}
              />
              <InfoField label={t('contacts.table.createdAt')} value={new Date(contact.created_at).toLocaleDateString('pt-BR')} />
              {contact.tags.length > 0 ? (
                <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                    {t('contacts.fields.tags')}
                  </span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {contact.tags.map((tag) => (
                      <span key={tag} style={{ fontSize: 11, color: 'var(--teal)', background: 'var(--teal-dim)', border: '1px solid rgba(0,201,167,.25)', borderRadius: 'var(--r-pill)', padding: '2px 8px' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === 'conversations' ? (
            conversationsLoading ? (
              <div style={{ color: 'var(--txt-3)', fontSize: 13 }}>{t('contacts.loading')}</div>
            ) : conversations.length === 0 ? (
              <div style={{ color: 'var(--txt-3)', fontSize: 13 }}>{t('organizations.conversations.empty')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {conversations.map((conv) => (
                  <Link
                    key={conv.id}
                    to={`/omnichannel/conversations?conversation=${conv.id}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}
                  >
                    <span style={{ fontSize: 18 }}>{conv.channel_type === 'whatsapp' ? '📱' : conv.channel_type === 'email' ? '📧' : '💬'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--txt)', fontWeight: 600 }}>
                        {conv.protocol_number ?? conv.id.slice(-8).toUpperCase()}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--txt-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {conv.last_message ?? 'Sem mensagens'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 'var(--r-pill)', background: 'var(--bg-4)', border: '1px solid var(--line)', color: 'var(--txt-3)' }}>
                        {conv.status}
                      </span>
                      <div style={{ marginTop: 3, fontSize: 10, color: 'var(--txt-3)' }}>{formatRelativeDate(conv.created_at)}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )
          ) : null}

          {activeTab === 'tickets' ? (
            ticketsLoading ? (
              <div style={{ color: 'var(--txt-3)', fontSize: 13 }}>{t('contacts.loading')}</div>
            ) : ticketRows.length === 0 ? (
              <div style={{ color: 'var(--txt-3)', fontSize: 13 }}>{t('organizations.tickets.empty')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {ticketRows.map((ticket) => (
                  <Link
                    key={ticket.id}
                    to={`/tickets/${ticket.id}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}
                  >
                    <span style={{ fontSize: 16 }}>🎫</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--txt)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {ticket.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{ticket.priority} · {ticket.status}</div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--txt-3)' }}>{formatRelativeDate(ticket.created_at)}</div>
                  </Link>
                ))}
              </div>
            )
          ) : null}

          {activeTab === 'notes' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <textarea
                value={notes}
                rows={10}
                onChange={(event) => {
                  setNotes(event.target.value);
                  setNotesDirty(true);
                }}
                placeholder={t('contacts.notes.placeholder')}
                style={{
                  width: '100%',
                  borderRadius: 'var(--r)',
                  border: '1px solid var(--line)',
                  background: 'var(--bg-3)',
                  color: 'var(--txt)',
                  padding: '10px 12px',
                  resize: 'vertical',
                  minHeight: 180,
                  fontSize: 13,
                  fontFamily: 'var(--font)',
                }}
              />
              {notesDirty ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => saveNotesMutation.mutate()}
                    disabled={saveNotesMutation.isPending}
                    style={{ padding: '6px 12px', borderRadius: 'var(--r)', border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', fontWeight: 600, cursor: 'pointer', opacity: saveNotesMutation.isPending ? 0.6 : 1 }}
                  >
                    {saveNotesMutation.isPending ? t('organizations.actions.savingNotes') : t('contacts.notes.save')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <EditContactModal contact={showEdit ? (contact as CrmContact) : null} onClose={() => setShowEdit(false)} />
      {showLinkOrg ? (
        <LinkOrganizationModal
          open={showLinkOrg}
          onClose={() => setShowLinkOrg(false)}
          contactId={contact.id}
          contactName={contact.name}
        />
      ) : null}
      <SelectChannelModal
        open={showSelectChannel}
        channels={channels.map((channel) => ({ id: channel.id, type: channel.type, name: channel.name }))}
        onClose={() => setShowSelectChannel(false)}
        onSelect={(channelId) => { void createOutboundConversation(channelId); }}
      />
    </>
  );
}
