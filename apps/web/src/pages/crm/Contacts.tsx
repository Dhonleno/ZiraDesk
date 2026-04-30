import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { contactsApi } from '../../services/api';
import type { CrmContact } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { ContactAvatar } from '../../components/crm/ContactAvatar';
import { CreateContactModal } from '../../components/crm/CreateContactModal';
import { EditContactModal } from '../../components/crm/EditContactModal';
import { LinkOrganizationModal } from '../../components/crm/LinkOrganizationModal';

const SORT_ICON = (
  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ opacity: 0.5 }} aria-hidden>
    <path d="M4.5 1.5v6M2.5 5.5l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export function ContactsPage() {
  const { t } = useTranslation('crm');
  const navigate = useNavigate();
  const [searchRaw, setSearchRaw] = useState('');
  const [page, setPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editContact, setEditContact] = useState<CrmContact | null>(null);
  const [linkContact, setLinkContact] = useState<CrmContact | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const search = useDebounce(searchRaw, 300);

  const { data: listData, isLoading } = useQuery({
    queryKey: ['crm-contacts', search, page, 'standalone'],
    queryFn: () => contactsApi.list({
      per_page: 20,
      page,
      ...(search ? { search } : {}),
    }),
  });

  const contacts = listData?.data ?? [];
  const meta = listData?.meta;
  const totalPages = meta?.total_pages ?? 1;

  function handleSearch(val: string) {
    setSearchRaw(val);
    setPage(1);
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Page header */}
      <div style={{ padding: '18px 24px 12px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', color: 'var(--txt)', margin: 0 }}>{t('contacts.standalone')}</h1>
        {meta && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt-3)', padding: '3px 9px', borderRadius: 'var(--r-pill)', background: 'var(--bg-3)', border: '1px solid var(--line)' }}>
            {t('contacts.total', { n: meta.total.toLocaleString('pt-BR') })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setIsCreateOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', whiteSpace: 'nowrap', fontFamily: 'var(--font)' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          {t('contacts.new')}
        </button>
      </div>

      {/* Sub-header: desc + search */}
      <div style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>{t('contacts.standaloneDesc')}</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '7px 11px', width: 280 }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ color: 'var(--txt-3)', flexShrink: 0 }} aria-hidden>
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder={t('contacts.search')}
            value={searchRaw}
            onChange={(e) => handleSearch(e.target.value)}
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--font)', color: 'var(--txt)', width: '100%' }}
          />
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-5) transparent' }}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--txt-3)', fontSize: 13 }}>
            {t('contacts.loading')}
          </div>
        ) : contacts.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 10, color: 'var(--txt-3)' }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
              <circle cx="16" cy="11" r="6" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M4 28c0-6 5.4-10.5 12-10.5S28 22 28 28" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize: 13, color: 'var(--txt-2)' }}>{t('contacts.noResults')}</span>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr>
                {[
                  { label: t('contacts.table.name'),      sort: true  },
                  { label: t('contacts.table.whatsapp'),  sort: false },
                  { label: t('contacts.table.email'),     sort: false },
                  { label: t('contacts.table.createdAt'), sort: true  },
                  { label: t('contacts.table.actions'),   sort: false },
                ].map((h, i) => (
                  <th
                    key={i}
                    style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg-2)', borderBottom: '1px solid var(--line)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', textAlign: 'left', padding: '10px 14px', whiteSpace: 'nowrap' }}
                  >
                    {h.sort ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>{h.label} {SORT_ICON}</span> : h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c: CrmContact) => {
                const isHovered = hoveredId === c.id;
                return (
                  <tr
                    key={c.id}
                    onMouseEnter={() => setHoveredId(c.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{ borderBottom: '1px solid var(--line)', background: isHovered ? 'var(--bg-2)' : 'transparent', transition: 'background .12s', cursor: 'default' }}
                  >
                    {/* Name */}
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180 }}>
                        <ContactAvatar id={c.id} name={c.name} size={32} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                          {c.role && <div style={{ fontSize: 11, color: 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.role}</div>}
                        </div>
                      </div>
                    </td>

                    {/* WhatsApp */}
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt)' }}>{c.whatsapp ?? '—'}</div>
                    </td>

                    {/* Email */}
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: 12, color: 'var(--txt-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{c.email ?? '—'}</div>
                    </td>

                    {/* Created at */}
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt-3)' }}>{formatDate(c.created_at)}</div>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 4, opacity: isHovered ? 1 : 0, transition: 'opacity .12s' }}>
                        <button
                          title={t('contacts.actions.link')}
                          onClick={() => setLinkContact(c)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt-3)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font)' }}
                        >
                          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                            <rect x="1.5" y="3" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                            <rect x="5.5" y="3" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                            <path d="M5.5 5.5h0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                          </svg>
                          {t('contacts.actions.link')}
                        </button>
                        <button
                          title={t('contacts.actions.startConversation')}
                          onClick={() => navigate('/omnichannel/conversations')}
                          style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                            <path d="M2 8.5V3.5a1 1 0 011-1h6a1 1 0 011 1V7a1 1 0 01-1 1H5l-3 2v-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <button
                          title={t('contacts.actions.edit')}
                          onClick={() => setEditContact(c)}
                          style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                            <path d="M2 9.5L3.2 8 8.5 2.7l1.8 1.8-5.3 5.3L2 11V9.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderTop: '1px solid var(--line)', background: 'var(--bg-2)', flexShrink: 0, fontSize: 12, color: 'var(--txt-3)' }}>
        <div>
          {meta && (
            <span>
              {((meta.page - 1) * meta.per_page + 1).toLocaleString('pt-BR')}–{Math.min(meta.page * meta.per_page, meta.total).toLocaleString('pt-BR')}
              {' '}de{' '}
              <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}>{meta.total.toLocaleString('pt-BR')}</strong>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: page <= 1 ? 'var(--txt-3)' : 'var(--txt-2)', cursor: page <= 1 ? 'default' : 'pointer', fontSize: 12, opacity: page <= 1 ? 0.4 : 1, fontFamily: 'var(--mono)' }}
          >←</button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                style={{ width: 28, height: 28, borderRadius: 6, background: p === page ? 'var(--teal)' : 'var(--bg-3)', border: p === page ? '1px solid var(--teal)' : '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: p === page ? 'var(--on-teal)' : 'var(--txt-2)', cursor: 'pointer', fontSize: 11, fontWeight: p === page ? 600 : 400, fontFamily: 'var(--mono)' }}
              >{p}</button>
            );
          })}
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: page >= totalPages ? 'var(--txt-3)' : 'var(--txt-2)', cursor: page >= totalPages ? 'default' : 'pointer', fontSize: 12, opacity: page >= totalPages ? 0.4 : 1, fontFamily: 'var(--mono)' }}
          >→</button>
        </div>
      </div>

      <CreateContactModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <EditContactModal contact={editContact} onClose={() => setEditContact(null)} />
      {linkContact && (
        <LinkOrganizationModal
          open={!!linkContact}
          onClose={() => setLinkContact(null)}
          contactId={linkContact.id}
          contactName={linkContact.name}
        />
      )}
    </div>
  );
}
