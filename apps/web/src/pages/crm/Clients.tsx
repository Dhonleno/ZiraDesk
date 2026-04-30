import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { contactsApi } from '../../services/api';
import type { CrmContact } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { CreateClientModal } from '../../components/crm/CreateClientModal';
import { EditClientModal } from '../../components/crm/EditClientModal';
import { ClientProfile } from '../../components/crm/ClientProfile';

const AVATAR_GRADS = [
  '#667eea,#764ba2', '#f093fb,#f5576c', '#4facfe,#00f2fe', '#43e97b,#38f9d7',
  '#fa709a,#fee140', '#a18cd1,#fbc2eb', '#f7971e,#ffd200', '#5ee7df,#b490ca',
  '#84fab0,#8fd3f4', '#fad0c4,#ffd1ff', '#ee9ca7,#ffdde1', '#fbc2eb,#a6c1ee',
];

function gradFor(id: string): string {
  const h = id.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0xffff, 0);
  return `linear-gradient(135deg,${AVATAR_GRADS[h % AVATAR_GRADS.length]})`;
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => (w[0] ?? '').toUpperCase()).join('');
}

const SORT_ICON = (
  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ opacity: 0.5 }} aria-hidden>
    <path d="M4.5 1.5v6M2.5 5.5l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function CrmClientsPage() {
  const { t } = useTranslation('crm');
  const [searchParams] = useSearchParams();
  const [searchRaw, setSearchRaw] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editContact, setEditContact] = useState<CrmContact | null>(null);

  const search = useDebounce(searchRaw, 300);

  useEffect(() => {
    const contactId = searchParams.get('contact');
    if (contactId) setSelectedId(contactId);
  }, [searchParams]);

  const { data: listData, isLoading } = useQuery({
    queryKey: ['crm-contacts', search, page],
    queryFn: () => contactsApi.list({
      per_page: 20,
      page,
      ...(search ? { search } : {}),
    }),
  });

  const contacts  = listData?.data ?? [];
  const meta      = listData?.meta;
  const totalPages = meta?.total_pages ?? 1;

  function handleSearch(val: string) {
    setSearchRaw(val);
    setPage(1);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', height: '100%', overflow: 'hidden' }}>

      {/* ── List area ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Page header */}
        <div style={{ padding: '18px 24px 12px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', color: 'var(--txt)' }}>{t('clients.title')}</h1>
          {meta && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt-3)', padding: '3px 9px', borderRadius: 'var(--r-pill)', background: 'var(--bg-3)', border: '1px solid var(--line)' }}>
              {t('clients.total', { n: meta.total.toLocaleString('pt-BR') })}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setIsCreateModalOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', whiteSpace: 'nowrap', fontFamily: 'var(--font)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            {t('clients.newClient')}
          </button>
        </div>

        {/* Filter bar */}
        <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '7px 11px', flex: 1, maxWidth: 320, minWidth: 200 }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ color: 'var(--txt-3)', flexShrink: 0 }} aria-hidden>
              <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" />
              <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder={t('clients.searchPlaceholder')}
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
              {t('clients.loading')}
            </div>
          ) : contacts.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8, color: 'var(--txt-3)' }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden><circle cx="16" cy="11" r="6" stroke="currentColor" strokeWidth="1.4" /><path d="M4 28c0-6 5.4-10.5 12-10.5S28 22 28 28" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
              <span style={{ fontSize: 13, color: 'var(--txt-2)' }}>{t('clients.noClients')}</span>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  {[
                    { label: t('clients.table.client'), sort: true  },
                    { label: 'Organização',             sort: false },
                    { label: 'WhatsApp',                sort: false },
                    { label: 'Cargo',                   sort: false },
                    { label: '',                         sort: false },
                  ].map((h, i) => (
                    <th key={i} style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg-2)', borderBottom: '1px solid var(--line)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', textAlign: 'left', padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      {h.sort ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>{h.label} {SORT_ICON}</span> : h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contacts.map((c: CrmContact) => {
                  const isSelected = selectedId === c.id;
                  const isHovered  = hoveredId  === c.id;
                  const grad = gradFor(c.id);
                  const ini  = initials(c.name);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      onMouseEnter={() => setHoveredId(c.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer', background: isSelected ? 'rgba(0,201,167,.06)' : isHovered ? 'var(--bg-2)' : 'transparent', transition: 'background .12s' }}
                    >
                      {/* Name */}
                      <td style={{ padding: '10px 14px', boxShadow: isSelected ? 'inset 2px 0 0 var(--teal)' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#fff' }}>{ini}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email ?? c.phone ?? '—'}</div>
                          </div>
                        </div>
                      </td>

                      {/* Organization */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontSize: 12, color: 'var(--txt-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                          {c.organization_name ?? '—'}
                        </div>
                      </td>

                      {/* WhatsApp */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt)' }}>{c.whatsapp ?? '—'}</div>
                      </td>

                      {/* Role */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{c.role ?? '—'}</div>
                      </td>

                      {/* Row actions */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', gap: 4, opacity: isSelected || isHovered ? 1 : 0, transition: 'opacity .12s' }}>
                          <button
                            title={t('clients.actions.edit')}
                            onClick={(e) => { e.stopPropagation(); setEditContact(c); }}
                            style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 9.5L3.2 8 8.5 2.7l1.8 1.8-5.3 5.3L2 11V9.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
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

        {/* Footer / pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderTop: '1px solid var(--line)', background: 'var(--bg-2)', flexShrink: 0, fontSize: 12, color: 'var(--txt-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {meta && (
              <>
                <span>
                  {t('clients.pagination.showing')}{' '}
                  <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}>
                    {((meta.page - 1) * meta.per_page + 1).toLocaleString('pt-BR')}–{Math.min(meta.page * meta.per_page, meta.total).toLocaleString('pt-BR')}
                  </strong>
                  {' '}{t('clients.pagination.of')}{' '}
                  <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}>{meta.total.toLocaleString('pt-BR')}</strong>
                </span>
                <span>·</span>
                <span>{meta.per_page} {t('clients.pagination.perPage')}</span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: page <= 1 ? 'var(--txt-3)' : 'var(--txt-2)', cursor: page <= 1 ? 'default' : 'pointer', fontFamily: 'var(--mono)', fontSize: 12, opacity: page <= 1 ? 0.4 : 1 }}
            >
              ←
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{ width: 28, height: 28, borderRadius: 6, background: p === page ? 'var(--teal)' : 'var(--bg-3)', border: p === page ? '1px solid var(--teal)' : '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: p === page ? 'var(--on-teal)' : 'var(--txt-2)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: p === page ? 600 : 400 }}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: page >= totalPages ? 'var(--txt-3)' : 'var(--txt-2)', cursor: page >= totalPages ? 'default' : 'pointer', fontFamily: 'var(--mono)', fontSize: 12, opacity: page >= totalPages ? 0.4 : 1 }}
            >
              →
            </button>
          </div>
        </div>

      </div>{/* end list area */}

      {/* ── Contact profile panel ── */}
      <ClientProfile clientId={selectedId} onEdit={setEditContact} />

      {/* ── Modals ── */}
      <CreateClientModal open={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
      <EditClientModal client={editContact} onClose={() => setEditContact(null)} />

    </div>
  );
}
