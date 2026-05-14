import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { contactsApi } from '../../services/api';
import type { CrmContact } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';
import { ContactAvatar } from '../../components/crm/ContactAvatar';
import { ContactDetail } from '../../components/crm/ContactDetail';
import { CreateContactModal } from '../../components/crm/CreateContactModal';
import { EditContactModal } from '../../components/crm/EditContactModal';
import { LinkOrganizationModal } from '../../components/crm/LinkOrganizationModal';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { PageShell } from '../../components/layout/PageShell';

export function ContactsPage() {
  const { t } = useTranslation('crm');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id: routeId } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchRaw, setSearchRaw] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editContact, setEditContact] = useState<CrmContact | null>(null);
  const [linkContact, setLinkContact] = useState<CrmContact | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CrmContact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('id') ?? routeId ?? null,
  );

  const search = useDebounce(searchRaw, 300);

  const { data: listData, isLoading } = useQuery({
    queryKey: ['crm-contacts', search, 'sidebar'],
    queryFn: () => contactsApi.list({
      per_page: 80,
      standalone_only: true,
      ...(search ? { search } : {}),
    }),
  });

  const contacts = listData?.data ?? [];
  const meta = listData?.meta;

  useEffect(() => {
    const id = searchParams.get('id') ?? routeId ?? null;
    setSelectedId(id);
  }, [routeId, searchParams]);

  useEffect(() => {
    if (!selectedId && contacts.length > 0) {
      const next = contacts[0]!.id;
      setSelectedId(next);
      setSearchParams({ id: next }, { replace: true });
    }
  }, [contacts, selectedId, setSearchParams]);

  function handleSelectContact(id: string) {
    setSelectedId(id);
    setSearchParams({ id }, { replace: true });
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await contactsApi.delete(deleteConfirm.id);
      toast.success('Contato excluído');
      const deletedId = deleteConfirm.id;
      setDeleteConfirm(null);
      await queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['crm-contact', deletedId] });

      if (selectedId === deletedId) {
        const remaining = contacts.filter((item) => item.id !== deletedId);
        if (remaining[0]) {
          setSelectedId(remaining[0].id);
          setSearchParams({ id: remaining[0].id }, { replace: true });
        } else {
          setSelectedId(null);
          setSearchParams({}, { replace: true });
        }
      }
    } catch (error: unknown) {
      const message = (
        (error as { response?: { data?: { error?: { message?: string } } } })
          .response?.data?.error?.message
      ) ?? t('contacts.hasActiveConversations');
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', height: '100%', overflow: 'hidden' }}>
      <div style={{ borderRight: '1px solid var(--line)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 14px 12px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 18, color: 'var(--txt)' }}>{t('contacts.standalone')}</h1>
            {meta ? (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt-3)', border: '1px solid var(--line)', borderRadius: 'var(--r-pill)', padding: '2px 8px', background: 'var(--bg-3)' }}>
                {meta.total}
              </span>
            ) : null}
            <div style={{ flex: 1 }} />
            <PermissionGate permission="clients:edit">
              <button
                onClick={() => setIsCreateOpen(true)}
                className="zd-btn zd-btn-primary"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                {t('contacts.new')}
              </button>
            </PermissionGate>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--txt-3)' }}>{t('contacts.standaloneDesc')}</p>
        </div>

        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
          <input
            type="text"
            value={searchRaw}
            onChange={(event) => setSearchRaw(event.target.value)}
            placeholder={t('contacts.search')}
            className="zd-input"
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {isLoading ? (
            <div style={{ padding: 16, color: 'var(--txt-3)', fontSize: 12 }}>{t('contacts.loading')}</div>
          ) : contacts.length === 0 ? (
            <div style={{ padding: 16, minHeight: 220 }}>
              <div className="zd-empty-state">
                <div className="zd-empty-icon" aria-hidden>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M15 15L20 20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </div>
                <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>{t('contacts.noResults')}</div>
                <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{t('contacts.selectContactHint')}</div>
              </div>
            </div>
          ) : (
            contacts.map((contact) => {
              const selected = selectedId === contact.id;
              return (
                <div
                  key={contact.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--line)',
                    background: selected ? 'var(--bg-2)' : 'transparent',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectContact(contact.id)}
                    style={{ border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}
                  >
                    <ContactAvatar id={contact.id} name={contact.name} size={34} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--txt)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {contact.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--txt-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {contact.email ?? contact.whatsapp ?? t('contacts.standalone_badge')}
                      </div>
                    </div>
                  </button>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button className="tb-icon-btn" onClick={() => setEditContact(contact)} title={t('contacts.actions.edit')} aria-label={t('contacts.actions.edit')} style={{ width: 26, height: 26 }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 9.5L3.2 8 8.5 2.7l1.8 1.8-5.3 5.3L2 11V9.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                    </button>
                    <button className="tb-icon-btn" onClick={() => setLinkContact(contact)} title={t('contacts.actions.link')} aria-label={t('contacts.actions.link')} style={{ width: 26, height: 26 }}>
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                        <rect x="1.5" y="3" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                        <rect x="5.5" y="3" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                      </svg>
                    </button>
                    <PermissionGate permission="clients:delete">
                      <button
                        className="tb-icon-btn"
                        onClick={() => setDeleteConfirm(contact)}
                        title={t('contacts.actions.delete')}
                        aria-label={t('contacts.actions.delete')}
                        style={{ width: 26, height: 26, color: 'var(--red)' }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 3h8M4.5 3V2a.8.8 0 01.8-.8h1.4a.8.8 0 01.8.8v1M3.3 3l.4 6a.8.8 0 00.8.7h2.9a.8.8 0 00.8-.7l.4-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    </PermissionGate>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div style={{ background: 'var(--bg-2)', overflow: 'hidden' }}>
        {selectedId ? (
          <ContactDetail contactId={selectedId} />
        ) : (
          <div className="zd-empty-state" style={{ color: 'var(--txt-3)' }}>
            <div className="zd-empty-icon" aria-hidden>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
                <path d="M5 19c0-3.3 2.9-5.2 7-5.2S19 15.7 19 19" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ fontSize: 14, color: 'var(--txt-2)' }}>{t('contacts.selectContact')}</div>
            <div style={{ fontSize: 12 }}>{t('contacts.selectContactHint')}</div>
          </div>
        )}
      </div>

        <CreateContactModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
        <EditContactModal contact={editContact} onClose={() => setEditContact(null)} />
        {linkContact ? (
          <LinkOrganizationModal
            open={Boolean(linkContact)}
            onClose={() => setLinkContact(null)}
            contactId={linkContact.id}
            contactName={linkContact.name}
          />
        ) : null}
        <ConfirmModal
          open={Boolean(deleteConfirm)}
          title="Excluir contato"
          message={
            deleteConfirm
              ? `${t('contacts.deleteConfirm', { name: deleteConfirm.name })} ${t('contacts.deleteWarning')}`
              : ''
          }
          confirmLabel="Excluir"
          confirmVariant="danger"
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirm(null)}
        />
      </div>
    </PageShell>
  );
}
