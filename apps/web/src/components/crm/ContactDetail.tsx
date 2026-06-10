import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { contactsApi, omnichannelApi, ticketsApi, type CrmContact } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { ContactAvatar } from './ContactAvatar';
import { EditContactModal } from './EditContactModal';
import { LinkOrganizationModal } from './LinkOrganizationModal';
import { SelectChannelModal } from './SelectChannelModal';
import { Modal } from '../ui/Modal';
import { PiiReveal } from '../common/PiiReveal';
import { maskEmail, maskPhone, maskDocument } from '../../utils/pii-mask';

type Tab = 'data' | 'conversations' | 'tickets' | 'notes';

interface Props {
  contactId: string;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractEmailFromArray(values: unknown[]): string | null {
  for (const item of values) {
    const direct = normalizeEmail(item);
    if (direct) return direct;

    if (item && typeof item === 'object') {
      const entry = item as Record<string, unknown>;
      const email = normalizeEmail(entry['email']) ?? normalizeEmail(entry['value']);
      if (email) return email;
    }
  }
  return null;
}

function resolveContactEmail(contact: CrmContact): string | null {
  const direct = normalizeEmail(contact.email);
  if (direct) return direct;

  const rawContact = contact as unknown as Record<string, unknown>;
  const fromEmails = rawContact['emails'];
  if (Array.isArray(fromEmails)) {
    const email = extractEmailFromArray(fromEmails);
    if (email) return email;
  }

  if (contact.custom_fields && typeof contact.custom_fields === 'object') {
    const customFields = contact.custom_fields as Record<string, unknown>;
    const customDirect = normalizeEmail(customFields['email']) ?? normalizeEmail(customFields['primary_email']);
    if (customDirect) return customDirect;

    const customEmails = customFields['emails'];
    if (Array.isArray(customEmails)) {
      const email = extractEmailFromArray(customEmails);
      if (email) return email;
    }
  }

  return null;
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

function PiiField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 13 }}>{children}</span>
    </div>
  );
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

function ChannelTypeIcon({ channelType }: { channelType: string }) {
  if (channelType === 'whatsapp') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
        <rect x="4" y="2.5" width="10" height="13" rx="2.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M7 5.2h4M7 12.8h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }

  if (channelType === 'email') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
        <rect x="2.5" y="4" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.5 6l4.5 3.5L13.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M4 4.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8l-3.5 2v-2H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
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
  const [accessInfo, setAccessInfo] = useState<{ portalUrl: string; tempPassword: string; email: string | null } | null>(null);
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
      const list = await omnichannelApi.listConversationChannels();
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

  const createPortalAccessMutation = useMutation({
    mutationFn: () => contactsApi.portalAccess.create(contactId),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['crm-contact', contactId] });
      await queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      setAccessInfo({
        portalUrl: data.portal_url,
        tempPassword: data.temp_password,
        email: data.email,
      });
      toast.success('Acesso ao portal criado');
    },
    onError: (error: unknown) => {
      const message = (error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? 'Erro ao criar acesso ao portal';
      toast.error(message);
    },
  });

  const revokePortalAccessMutation = useMutation({
    mutationFn: () => contactsApi.portalAccess.revoke(contactId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['crm-contact', contactId] });
      await queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      toast.success('Acesso ao portal revogado');
    },
    onError: () => toast.error('Erro ao revogar acesso ao portal'),
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

  const ticketRows = ticketsData?.data ?? [];
  const contactEmail = contact ? resolveContactEmail(contact) : null;
  const maskedPortalEmail = maskEmail(accessInfo?.email ?? null);

  if (isLoading || !contact) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', fontSize: 13 }}>
        {t('contacts.loading')}
      </div>
    );
  }

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
                  <Link to={`/crm/organizations?id=${contact.organization_id}`} style={{ fontSize: 12, color: 'var(--teal)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                      <rect x="1.5" y="3.5" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M5 3.5V2.6a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    {contact.organization_name}
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
                className="zd-btn"
              >
                {t('contacts.actions.edit')}
              </button>
              <button
                onClick={() => void handleStartConversation()}
                disabled={creatingConversation}
                className="zd-btn zd-btn-primary"
                style={{ opacity: creatingConversation ? 0.6 : 1 }}
              >
                {t('contacts.startConversation')}
              </button>
              {!contact.organization_id ? (
                <button
                  onClick={() => setShowLinkOrg(true)}
                  className="zd-btn"
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
              <PiiField label={t('contacts.table.whatsapp')}>
                <PiiReveal entityType="contact" entityId={contact.id} maskedValue={maskPhone(contact.whatsapp ?? null)} fullValue={contact.whatsapp ?? null} />
              </PiiField>
              <PiiField label={t('contacts.fields.phone')}>
                <PiiReveal entityType="contact" entityId={contact.id} maskedValue={maskPhone(contact.phone ?? null)} fullValue={contact.phone ?? null} />
              </PiiField>
              <PiiField label={t('contacts.fields.email')}>
                <PiiReveal entityType="contact" entityId={contact.id} maskedValue={maskEmail(contactEmail)} fullValue={contactEmail} />
              </PiiField>
              <PiiField label={t('contacts.fields.document')}>
                <PiiReveal entityType="contact" entityId={contact.id} maskedValue={maskDocument(contact.document ?? null)} fullValue={contact.document ?? null} />
              </PiiField>
              <InfoField label={t('contacts.fields.role')} value={contact.role} />
              <InfoField label={t('contacts.fields.department')} value={contact.department} />
              <InfoField
                label={t('contacts.fields.organization')}
                value={contact.organization_name}
                {...(contact.organization_id ? { link: `/crm/organizations?id=${contact.organization_id}` } : {})}
              />
              <InfoField label={t('contacts.table.createdAt')} value={new Date(contact.created_at).toLocaleDateString('pt-BR')} />

              <div className="portal-access-section" style={{ gridColumn: '1 / -1' }}>
                <div className="portal-access-header">
                  <span>Acesso ao Portal</span>
                  {contact.portal_enabled ? (
                    <span className="comment-visibility-badge public">Ativo</span>
                  ) : (
                    <span className="comment-visibility-badge">Sem acesso</span>
                  )}
                </div>

                {contact.portal_enabled ? (
                  <div>
                    <p className="portal-access-hint">
                      Último acesso: {contact.portal_last_login ? formatRelativeDate(contact.portal_last_login) : 'Nunca'}
                    </p>
                    <button
                      type="button"
                      onClick={() => revokePortalAccessMutation.mutate()}
                      disabled={revokePortalAccessMutation.isPending}
                      className="zd-btn"
                      style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                    >
                      Revogar acesso
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="portal-access-hint">
                      {contactEmail
                        ? 'Este contato já possui e-mail. Gere o acesso ao portal para liberar login.'
                        : 'O contato precisa ter e-mail cadastrado.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => createPortalAccessMutation.mutate()}
                      disabled={!contactEmail || createPortalAccessMutation.isPending}
                      className="zd-btn zd-btn-primary"
                    >
                      Criar acesso ao portal
                    </button>
                  </div>
                )}
              </div>

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
              <div style={{ minHeight: 220 }}>
                <div className="zd-empty-state">
                  <div className="zd-empty-icon" aria-hidden>
                    <svg width="21" height="21" viewBox="0 0 21 21" fill="none">
                      <path d="M4 4.5h13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-3.5 2V14.5H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>{t('organizations.conversations.empty')}</div>
                  <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{t('contacts.selectContactHint')}</div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {conversations.map((conv) => (
                  <Link
                    key={conv.id}
                    to={`/omnichannel/conversations?conversation=${conv.id}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}
                  >
                    <span style={{ color: 'var(--blue)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ChannelTypeIcon channelType={conv.channel_type} />
                    </span>
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
              <div style={{ minHeight: 220 }}>
                <div className="zd-empty-state">
                  <div className="zd-empty-icon" aria-hidden>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M4 5h12a1.5 1.5 0 0 1 1.5 1.5v1.2a1.2 1.2 0 0 0-1 1.18 1.2 1.2 0 0 0 1 1.18v1.42A1.5 1.5 0 0 1 16 14H4a1.5 1.5 0 0 1-1.5-1.5v-1.42a1.2 1.2 0 0 0 1-1.18 1.2 1.2 0 0 0-1-1.18V6.5A1.5 1.5 0 0 1 4 5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>{t('organizations.tickets.empty')}</div>
                  <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{t('contacts.selectContactHint')}</div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {ticketRows.map((ticket) => (
                  <Link
                    key={ticket.id}
                    to={`/tickets/${ticket.id}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}
                  >
                    <span style={{ color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                        <path d="M3.5 4.5h9a1.3 1.3 0 0 1 1.3 1.3v1a1 1 0 0 0-.8 1 1 1 0 0 0 .8 1v1.1a1.3 1.3 0 0 1-1.3 1.3h-9a1.3 1.3 0 0 1-1.3-1.3V9a1 1 0 0 0 .8-1 1 1 0 0 0-.8-1v-1a1.3 1.3 0 0 1 1.3-1.3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                      </svg>
                    </span>
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
                className="zd-textarea"
                style={{ resize: 'vertical', minHeight: 180 }}
              />
              {notesDirty ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => saveNotesMutation.mutate()}
                    disabled={saveNotesMutation.isPending}
                    className="zd-btn zd-btn-primary"
                    style={{ opacity: saveNotesMutation.isPending ? 0.6 : 1 }}
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

      <Modal
        open={!!accessInfo}
        onClose={() => setAccessInfo(null)}
        title="Acesso criado!"
        maxWidth="sm"
      >
        {accessInfo ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--txt-2)' }}>
              As credenciais foram enviadas por e-mail para {accessInfo.email ?? maskedPortalEmail ?? 'o contato'}.
            </p>
            <div className="portal-credentials-display">
              <div>
                <label>URL do portal:</label>
                <code>{accessInfo.portalUrl}</code>
              </div>
              <div>
                <label>Senha temporária:</label>
                <code>{accessInfo.tempPassword}</code>
              </div>
            </div>
            <p className="portal-access-hint" style={{ marginBottom: 0 }}>
              Anote a senha temporária. Ela não será exibida novamente.
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
