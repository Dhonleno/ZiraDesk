import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { organizationsApi } from '../../services/api';
import type { CrmOrganization } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { OrganizationCard } from '../../components/crm/OrganizationCard';
import { OrganizationDetail } from '../../components/crm/OrganizationDetail';
import { CreateOrganizationModal } from '../../components/crm/CreateOrganizationModal';

type StatusFilter = 'all' | 'lead' | 'prospect' | 'client' | 'inactive';

const STATUS_TABS: StatusFilter[] = ['all', 'lead', 'prospect', 'client', 'inactive'];

export function OrganizationsPage() {
  const { t } = useTranslation('crm');
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchRaw, setSearchRaw] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const search = useDebounce(searchRaw, 300);

  useEffect(() => {
    const id = searchParams.get('id');
    if (id) setSelectedId(id);
  }, [searchParams]);

  const { data: listData, isLoading } = useQuery({
    queryKey: ['crm-organizations', search, statusFilter],
    queryFn: () => organizationsApi.list({
      per_page: 50,
      ...(search ? { search } : {}),
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    }),
  });

  const { data: selectedOrg, isLoading: detailLoading } = useQuery({
    queryKey: ['crm-organization', selectedId],
    queryFn: () => organizationsApi.get(selectedId!),
    enabled: !!selectedId,
  });

  const organizations = listData?.data ?? [];
  const meta = listData?.meta;

  function selectOrg(id: string) {
    setSelectedId(id);
    setSearchParams(id ? { id } : {}, { replace: true });
  }

  function handleSearch(val: string) {
    setSearchRaw(val);
  }

  const statusTabLabels: Record<StatusFilter, string> = {
    all:      t('organizations.status.all'),
    lead:     t('organizations.status.lead'),
    prospect: t('organizations.status.prospect'),
    client:   t('organizations.status.client'),
    inactive: t('organizations.status.inactive'),
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', height: '100%', overflow: 'hidden' }}>

      {/* ── Left panel: list ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--line)', background: 'var(--bg)' }}>

        {/* Header */}
        <div style={{ padding: '18px 16px 12px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.3px', color: 'var(--txt)', margin: 0 }}>
            {t('organizations.title')}
          </h1>
          {meta && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt-3)', padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--bg-3)', border: '1px solid var(--line)' }}>
              {meta.total}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setIsCreateOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 'var(--r)', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', whiteSpace: 'nowrap', fontFamily: 'var(--font)' }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            {t('organizations.new')}
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '7px 10px' }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ color: 'var(--txt-3)', flexShrink: 0 }} aria-hidden>
              <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder={t('organizations.search')}
              value={searchRaw}
              onChange={(e) => handleSearch(e.target.value)}
              style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--font)', color: 'var(--txt)', width: '100%' }}
            />
          </div>
        </div>

        {/* Status tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none', padding: '0 4px' }}>
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              style={{
                padding: '8px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                border: 'none', borderBottom: `2px solid ${statusFilter === tab ? 'var(--teal)' : 'transparent'}`,
                background: 'transparent', color: statusFilter === tab ? 'var(--teal)' : 'var(--txt-3)',
                whiteSpace: 'nowrap', fontFamily: 'var(--font)', transition: 'all .15s',
                marginBottom: -1,
              }}
            >
              {statusTabLabels[tab]}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-5) transparent' }}>
          {isLoading ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>
              {t('organizations.loading')}
            </div>
          ) : organizations.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: 10, color: 'var(--txt-3)' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <rect x="2" y="4" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M6 8h8M6 11h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </div>
              <span style={{ fontSize: 13, color: 'var(--txt-2)' }}>{t('organizations.noResults')}</span>
            </div>
          ) : (
            organizations.map((org: CrmOrganization) => (
              <OrganizationCard
                key={org.id}
                org={org}
                selected={selectedId === org.id}
                onClick={() => selectOrg(org.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: detail ── */}
      <div style={{ overflow: 'hidden', background: 'var(--bg-2)' }}>
        {!selectedId ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, color: 'var(--txt-3)', padding: '40px 20px', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M7 9h10M7 12.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14, color: 'var(--txt-2)', fontWeight: 500, marginBottom: 4 }}>{t('organizations.noSelection')}</div>
              <div style={{ fontSize: 12, maxWidth: 220, lineHeight: 1.5 }}>{t('organizations.noSelectionSub')}</div>
            </div>
          </div>
        ) : detailLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: 'var(--txt-3)' }}>
            {t('organizations.loading')}
          </div>
        ) : selectedOrg ? (
          <OrganizationDetail key={selectedOrg.id} org={selectedOrg} />
        ) : null}
      </div>

      <CreateOrganizationModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </div>
  );
}
