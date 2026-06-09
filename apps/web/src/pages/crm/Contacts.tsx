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
import { CrmSidebarHeader } from '../../components/crm/CrmSidebarHeader';
import { CrmSearchField } from '../../components/crm/CrmSearchField';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { PageShell } from '../../components/layout/PageShell';
import { maskEmail, maskPhone } from '../../utils/pii-mask';
import { ContactImportModal } from '../../components/crm/ContactImportModal';
import { useAuthStore } from '../../stores/auth.store';
import './Contacts.css';

export function ContactsPage() {
  const { t } = useTranslation('crm');
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const { id: routeId } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchRaw, setSearchRaw] = useState(searchParams.get('q') ?? '');
  const [filterMode, setFilterMode] = useState<'all' | 'linked' | 'standalone'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editContact, setEditContact] = useState<CrmContact | null>(null);
  const [linkContact, setLinkContact] = useState<CrmContact | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CrmContact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('id') ?? routeId ?? null,
  );

  const search = useDebounce(searchRaw, 300);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterMode, search]);

  const { data: listData, isLoading } = useQuery({
    queryKey: ['crm-contacts', search, filterMode, currentPage, 'sidebar'],
    queryFn: () => {
      const queryParams = {
        per_page: 20,
        page: currentPage,
        ...(search ? { search } : {}),
        ...(filterMode === 'standalone' ? { standalone_only: true } : {}),
      };
      return contactsApi.list(queryParams);
    },
  });

  const contacts = filterMode === 'linked'
    ? (listData?.data ?? []).filter((contact) => contact.organization_id !== null)
    : (listData?.data ?? []);
  const meta = listData?.meta;
  const totalPages = meta?.total_pages ?? 1;
  const canImportContacts = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'agent';

  useEffect(() => {
    const id = searchParams.get('id') ?? routeId ?? null;
    setSelectedId(id);
    setSearchRaw((prev) => {
      const nextSearch = searchParams.get('q') ?? '';
      return prev === nextSearch ? prev : nextSearch;
    });
  }, [routeId, searchParams]);

  useEffect(() => {
    if (!selectedId && contacts.length > 0) {
      const next = contacts[0]!.id;
      setSelectedId(next);
      const params: Record<string, string> = { id: next };
      if (searchRaw.trim()) params.q = searchRaw.trim();
      setSearchParams(params, { replace: true });
    }
  }, [contacts, selectedId, setSearchParams, searchRaw]);

  function handleSelectContact(id: string) {
    setSelectedId(id);
    const params: Record<string, string> = { id };
    if (searchRaw.trim()) params.q = searchRaw.trim();
    setSearchParams(params, { replace: true });
  }

  function handleSearchChange(value: string) {
    setSearchRaw(value);
    const params: Record<string, string> = {};
    if (selectedId) params.id = selectedId;
    if (value.trim()) params.q = value.trim();
    setSearchParams(params, { replace: true });
  }

  function clearSearch() {
    handleSearchChange('');
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
          const params: Record<string, string> = { id: remaining[0].id };
          if (searchRaw.trim()) params.q = searchRaw.trim();
          setSearchParams(params, { replace: true });
        } else {
          setSelectedId(null);
          const params: Record<string, string> = {};
          if (searchRaw.trim()) params.q = searchRaw.trim();
          setSearchParams(params, { replace: true });
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
        <CrmSidebarHeader
          title={t('contacts.title')}
          count={meta?.total ?? null}
          subtitle={t('contacts.subtitle', { count: meta?.total ?? 0 })}
          action={(
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {canImportContacts ? (
                <button
                  type="button"
                  onClick={() => setIsImportOpen(true)}
                  className="tb-btn"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M6 8V1.5M3.5 4L6 1.5 8.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 8.5v1.3c0 .4.3.7.7.7h6.6c.4 0 .7-.3.7-.7V8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  {t('import.button')}
                </button>
              ) : null}
              <PermissionGate permission="contacts:edit">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(true)}
                  className="zd-btn zd-btn-primary"
                  title={t('contacts.new')}
                  aria-label={t('contacts.new')}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  {t('contacts.newCompact')}
                </button>
              </PermissionGate>
            </div>
          )}
        />

        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
          <CrmSearchField
            value={searchRaw}
            onChange={handleSearchChange}
            placeholder={t('contacts.search')}
            clearLabel={t('contacts.clearSearch')}
            onClear={clearSearch}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }} className="filter-chips">
            {(['all', 'linked', 'standalone'] as const).map((mode) => (
              <button
                key={mode}
                className={`fchip ${filterMode === mode ? 'has-val' : ''}`}
                onClick={() => setFilterMode(mode)}
                style={{
                  border: `1px solid ${filterMode === mode ? 'var(--teal)' : 'var(--line-2)'}`,
                  background: filterMode === mode ? 'var(--teal-dim)' : 'var(--bg-3)',
                  color: filterMode === mode ? 'var(--teal)' : 'var(--txt-2)',
                  borderRadius: 'var(--r-pill)',
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 500,
                  fontFamily: 'var(--font)',
                  cursor: 'pointer',
                }}
              >
                {t(`contacts.filter.${mode}`)}
              </button>
            ))}
          </div>
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
                  className="contact-list-item"
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
                        {maskEmail(contact.email) ?? maskPhone(contact.whatsapp) ?? t('contacts.standalone_badge')}
                      </div>
                    </div>
                  </button>
                  <div className="contact-row-actions">
                    <button className="tb-icon-btn" onClick={() => setEditContact(contact)} title={t('contacts.actions.edit')} aria-label={t('contacts.actions.edit')} style={{ width: 26, height: 26 }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 9.5L3.2 8 8.5 2.7l1.8 1.8-5.3 5.3L2 11V9.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                    </button>
                    <button className="tb-icon-btn" onClick={() => setLinkContact(contact)} title={t('contacts.actions.link')} aria-label={t('contacts.actions.link')} style={{ width: 26, height: 26 }}>
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                        <rect x="1.5" y="3" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                        <rect x="5.5" y="3" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                      </svg>
                    </button>
                    <PermissionGate permission="contacts:delete">
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
        {totalPages > 1 ? (
          <div style={{ borderTop: '1px solid var(--line)', padding: '9px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }} className="pagination">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              style={{
                height: 28,
                minWidth: 28,
                borderRadius: 'var(--r)',
                border: '1px solid var(--line-2)',
                background: currentPage === 1 ? 'var(--bg-2)' : 'var(--bg-3)',
                color: currentPage === 1 ? 'var(--txt-3)' : 'var(--txt-2)',
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              }}
              aria-label="Página anterior"
            >
              ←
            </button>
            <span style={{ fontSize: 11, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>{currentPage} / {totalPages}</span>
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              style={{
                height: 28,
                minWidth: 28,
                borderRadius: 'var(--r)',
                border: '1px solid var(--line-2)',
                background: currentPage === totalPages ? 'var(--bg-2)' : 'var(--bg-3)',
                color: currentPage === totalPages ? 'var(--txt-3)' : 'var(--txt-2)',
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
              }}
              aria-label="Próxima página"
            >
              →
            </button>
          </div>
        ) : null}
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
        <ContactImportModal
          open={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          onRefresh={() => {
            void queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
          }}
        />
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
