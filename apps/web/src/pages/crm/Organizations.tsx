import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { adminApi, organizationsApi } from '../../services/api';
import type { CrmOrganization } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { OrganizationCard } from '../../components/crm/OrganizationCard';
import { OrganizationDetail } from '../../components/crm/OrganizationDetail';
import { CreateOrganizationModal } from '../../components/crm/CreateOrganizationModal';
import { CrmSidebarHeader } from '../../components/crm/CrmSidebarHeader';
import { CrmSearchField } from '../../components/crm/CrmSearchField';
import { CrmActiveFilterChips } from '../../components/crm/CrmActiveFilterChips';
import { CrmBulkSelectionBar } from '../../components/crm/CrmBulkSelectionBar';
import { CrmBulkDeleteConfirmModal } from '../../components/crm/CrmBulkDeleteConfirmModal';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { PageShell } from '../../components/layout/PageShell';
import { usePermission } from '../../hooks/usePermission';
import { useToast } from '../../stores/toast.store';
import './Organizations.css';

type StatusFilter = 'all' | 'lead' | 'prospect' | 'client' | 'inactive';
type SortBy = 'updated_at' | 'created_at' | 'name';
type SortOrder = 'asc' | 'desc';

const STATUS_TABS: StatusFilter[] = ['all', 'lead', 'prospect', 'client', 'inactive'];
const SORT_OPTIONS: SortBy[] = ['updated_at', 'created_at', 'name'];

function parseStatusFilter(value: string | null): StatusFilter {
  return STATUS_TABS.includes(value as StatusFilter) ? (value as StatusFilter) : 'all';
}

function parseSortBy(value: string | null): SortBy {
  return SORT_OPTIONS.includes(value as SortBy) ? (value as SortBy) : 'updated_at';
}

function parseSortOrder(value: string | null): SortOrder {
  return value === 'asc' || value === 'desc' ? value : 'desc';
}

function parsePage(value: string | null): number {
  const page = Number(value ?? 1);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function OrganizationsPage() {
  const { t } = useTranslation('crm');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = usePermission();
  const { id: routeId } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchRaw, setSearchRaw] = useState(searchParams.get('q') ?? '');
  const [segmentRaw, setSegmentRaw] = useState(searchParams.get('segment') ?? '');
  const [tagRaw, setTagRaw] = useState(searchParams.get('tag') ?? '');
  const [responsibleId, setResponsibleId] = useState(searchParams.get('responsible_id') ?? '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(parseStatusFilter(searchParams.get('status')));
  const [sortBy, setSortBy] = useState<SortBy>(parseSortBy(searchParams.get('sort_by')));
  const [sortOrder, setSortOrder] = useState<SortOrder>(parseSortOrder(searchParams.get('sort_order')));
  const [page, setPage] = useState<number>(parsePage(searchParams.get('page')));
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id') ?? routeId ?? null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [filterBulkDeleteOpen, setFilterBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const canDeleteOrganizations = can('organizations:delete');

  const search = useDebounce(searchRaw, 300);
  const segment = useDebounce(segmentRaw, 300);
  const tag = useDebounce(tagRaw, 300);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const id = searchParams.get('id') ?? routeId ?? null;
    const q = searchParams.get('q') ?? '';
    const nextSegment = searchParams.get('segment') ?? '';
    const nextTag = searchParams.get('tag') ?? '';
    const nextResponsibleId = searchParams.get('responsible_id') ?? '';
    const nextStatus = parseStatusFilter(searchParams.get('status'));
    const nextSortBy = parseSortBy(searchParams.get('sort_by'));
    const nextSortOrder = parseSortOrder(searchParams.get('sort_order'));
    const nextPage = parsePage(searchParams.get('page'));

    setSelectedId(id);
    setSearchRaw((prev) => (prev === q ? prev : q));
    setSegmentRaw((prev) => (prev === nextSegment ? prev : nextSegment));
    setTagRaw((prev) => (prev === nextTag ? prev : nextTag));
    setResponsibleId((prev) => (prev === nextResponsibleId ? prev : nextResponsibleId));
    setStatusFilter((prev) => (prev === nextStatus ? prev : nextStatus));
    setSortBy((prev) => (prev === nextSortBy ? prev : nextSortBy));
    setSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
  }, [routeId, searchParams]);

  function updateParams(next: {
    id?: string | null;
    q?: string;
    status?: StatusFilter;
    segment?: string;
    tag?: string;
    responsibleId?: string;
    sortBy?: SortBy;
    sortOrder?: SortOrder;
    page?: number;
  }) {
    const nextId = Object.prototype.hasOwnProperty.call(next, 'id') ? (next.id ?? null) : selectedId;
    const nextQ = next.q ?? searchRaw;
    const nextStatus = next.status ?? statusFilter;
    const nextSegment = next.segment ?? segmentRaw;
    const nextTag = next.tag ?? tagRaw;
    const nextResponsibleId = next.responsibleId ?? responsibleId;
    const nextSortBy = next.sortBy ?? sortBy;
    const nextSortOrder = next.sortOrder ?? sortOrder;
    const nextPage = next.page ?? page;
    const params: Record<string, string> = {};

    if (nextId) params.id = nextId;
    if (nextQ.trim()) params.q = nextQ.trim();
    if (nextStatus !== 'all') params.status = nextStatus;
    if (nextSegment.trim()) params.segment = nextSegment.trim();
    if (nextTag.trim()) params.tag = nextTag.trim();
    if (nextResponsibleId) params.responsible_id = nextResponsibleId;
    if (nextSortBy !== 'updated_at') params.sort_by = nextSortBy;
    if (nextSortOrder !== 'desc') params.sort_order = nextSortOrder;
    if (nextPage > 1) params.page = String(nextPage);

    setSearchParams(params, { replace: true });
  }

  const { data: listData, isLoading } = useQuery({
    queryKey: ['crm-organizations', search, statusFilter, segment, tag, responsibleId, sortBy, sortOrder, page],
    queryFn: () => organizationsApi.list({
      page,
      per_page: 20,
      sort_by: sortBy,
      sort_order: sortOrder,
      ...(search ? { search } : {}),
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      ...(segment ? { segment } : {}),
      ...(tag ? { tag } : {}),
      ...(responsibleId ? { responsible_id: responsibleId } : {}),
    }),
  });

  const { data: usersData } = useQuery({
    queryKey: ['crm-organizations-users-filter'],
    queryFn: () => adminApi.listUsers({ per_page: 100, status: 'active' }),
    staleTime: 60_000,
  });

  const { data: selectedOrg, isLoading: detailLoading } = useQuery({
    queryKey: ['crm-organization', selectedId],
    queryFn: () => organizationsApi.get(selectedId!),
    enabled: !!selectedId,
  });

  const organizations = listData?.data ?? [];
  const meta = listData?.meta;
  const bulkFilter = {
    ...(search ? { search } : {}),
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(segment ? { segment } : {}),
    ...(tag ? { tag } : {}),
    ...(responsibleId ? { responsible_id: responsibleId } : {}),
  };
  const allOrganizationsSelected = organizations.length > 0
    && organizations.every((organization) => (
      selectAllMode ? !selectedIds.has(organization.id) : selectedIds.has(organization.id)
    ));
  const { data: countData, isFetching: isFetchingCount } = useQuery({
    queryKey: ['crm-organizations-count', search, statusFilter, segment, tag, responsibleId],
    queryFn: () => organizationsApi.count(bulkFilter),
    enabled: allOrganizationsSelected || selectAllMode,
    staleTime: 30_000,
  });
  const totalMatchingCount = countData?.count ?? 0;
  const selectedCount = selectAllMode
    ? Math.max(0, totalMatchingCount - selectedIds.size)
    : selectedIds.size;
  const filters = {
    segment: segmentRaw.trim(),
    tag: tagRaw.trim(),
    responsible: responsibleId,
  };
  const activeFilterCount = [filters.segment, filters.tag, filters.responsible].filter(Boolean).length;
  const segmentOptions = Array.from(
    new Set([
      ...organizations.map((org) => org.segment).filter(isNonEmptyString).map((value) => value.trim()),
      ...(filters.segment ? [filters.segment] : []),
    ]),
  ).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  const tagOptions = Array.from(
    new Set([
      ...organizations.flatMap((org) => org.tags).filter(isNonEmptyString).map((value) => value.trim()),
      ...(filters.tag ? [filters.tag] : []),
    ]),
  ).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

  useEffect(() => {
    setSelectAllMode(false);
    setSelectedIds(new Set());
  }, [search, statusFilter, segment, tag, responsibleId]);

  useEffect(() => {
    if (!selectAllMode) setSelectedIds(new Set());
  }, [page, selectAllMode, sortBy, sortOrder]);

  useEffect(() => {
    if (organizations.length === 0) {
      if (selectedId) {
        setSelectedId(null);
        updateParams({ id: null });
      }
      return;
    }

    const selectedExists = selectedId ? organizations.some((org) => org.id === selectedId) : false;
    if (!selectedExists) {
      const firstId = organizations[0]!.id;
      setSelectedId(firstId);
      updateParams({ id: firstId });
    }
  }, [organizations, selectedId]);

  function selectOrg(id: string) {
    setSelectedId(id);
    updateParams({ id });
  }

  function handleSearchChange(val: string) {
    setSearchRaw(val);
    setPage(1);
    updateParams({ q: val, page: 1 });
  }

  function handleStatusChange(nextStatus: StatusFilter) {
    setStatusFilter(nextStatus);
    setPage(1);
    updateParams({ status: nextStatus, page: 1 });
  }

  function handleSegmentChange(nextSegment: string) {
    setSegmentRaw(nextSegment);
    setPage(1);
    updateParams({ segment: nextSegment, page: 1 });
  }

  function handleTagChange(nextTag: string) {
    setTagRaw(nextTag);
    setPage(1);
    updateParams({ tag: nextTag, page: 1 });
  }

  function handleResponsibleChange(nextResponsibleId: string) {
    setResponsibleId(nextResponsibleId);
    setPage(1);
    updateParams({ responsibleId: nextResponsibleId, page: 1 });
  }

  function handleSortByChange(nextSortBy: SortBy) {
    setSortBy(nextSortBy);
    setPage(1);
    updateParams({ sortBy: nextSortBy, page: 1 });
  }

  function handleSortOrderToggle() {
    const nextOrder: SortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    setSortOrder(nextOrder);
    setPage(1);
    updateParams({ sortOrder: nextOrder, page: 1 });
  }

  function handlePageChange(nextPage: number) {
    const safePage = Math.max(1, nextPage);
    setPage(safePage);
    updateParams({ page: safePage });
  }

  const statusTabLabels: Record<StatusFilter, string> = {
    all:      t('organizations.status.all'),
    lead:     t('organizations.status.lead'),
    prospect: t('organizations.status.prospect'),
    client:   t('organizations.status.client'),
    inactive: t('organizations.status.inactive'),
  };
  const sortByLabels: Record<SortBy, string> = {
    updated_at: t('organizations.sort.updatedAt'),
    created_at: t('organizations.sort.createdAt'),
    name: t('organizations.sort.name'),
  };
  const responsibleName = (usersData?.data ?? []).find((user) => user.id === responsibleId)?.name ?? null;
  const activeFilters: Array<{ key: string; label: string; onRemove: () => void }> = [
    ...(searchRaw.trim()
      ? [{ key: 'q', label: `${t('organizations.search')}: ${searchRaw.trim()}`, onRemove: () => handleSearchChange('') }]
      : []),
    ...(statusFilter !== 'all'
      ? [{ key: 'status', label: `${t('organizations.fields.status')}: ${statusTabLabels[statusFilter]}`, onRemove: () => handleStatusChange('all') }]
      : []),
    ...(segmentRaw.trim()
      ? [{ key: 'segment', label: `${t('organizations.filters.segment')}: ${segmentRaw.trim()}`, onRemove: () => handleSegmentChange('') }]
      : []),
    ...(tagRaw.trim()
      ? [{ key: 'tag', label: `${t('organizations.filters.tag')}: ${tagRaw.trim()}`, onRemove: () => handleTagChange('') }]
      : []),
    ...(responsibleId
      ? [{
          key: 'responsible_id',
          label: `${t('organizations.filters.responsible')}: ${responsibleName ?? t('organizations.filters.responsibleAll')}`,
          onRemove: () => handleResponsibleChange(''),
        }]
      : []),
  ];
  const canGoPrev = page > 1;
  const canGoNext = page < (meta?.total_pages ?? 1);

  function clearAllFilters() {
    setSearchRaw('');
    setSegmentRaw('');
    setTagRaw('');
    setResponsibleId('');
    setStatusFilter('all');
    setSortBy('updated_at');
    setSortOrder('desc');
    setPage(1);
    updateParams({
      q: '',
      segment: '',
      tag: '',
      responsibleId: '',
      status: 'all',
      sortBy: 'updated_at',
      sortOrder: 'desc',
      page: 1,
    });
  }

  function clearPopoverFilters() {
    setSegmentRaw('');
    setTagRaw('');
    setResponsibleId('');
    setPage(1);
    updateParams({
      segment: '',
      tag: '',
      responsibleId: '',
      page: 1,
    });
  }

  function toggleOrganizationSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOrganizations() {
    if (selectAllMode) {
      setSelectAllMode(false);
      setSelectedIds(new Set());
      return;
    }

    const visibleIds = organizations.map((organization) => organization.id);
    const allSelected = visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(visibleIds));
  }

  async function handleBulkDelete() {
    if (selectedCount === 0) return;

    setBulkDeleting(true);
    try {
      const result = await organizationsApi.bulkDelete(
        selectAllMode
          ? { filter: bulkFilter, exclude_ids: [...selectedIds] }
          : { ids: [...selectedIds] },
      );
      if (result.deleted.length > 0) {
        toast.success(t('organizations.bulkDelete.success', { count: result.deleted.length }));
      }
      if (result.blocked.length > 0 || result.not_found.length > 0) {
        toast.warning(t('organizations.bulkDelete.partial', {
          blocked: result.blocked.length,
          notFound: result.not_found.length,
        }));
      }

      const deletedIds = new Set(result.deleted);
      setSelectAllMode(false);
      setSelectedIds(new Set(result.blocked.map((item) => item.id)));
      setBulkDeleteOpen(false);
      setFilterBulkDeleteOpen(false);

      if (selectedId && deletedIds.has(selectedId)) {
        setSelectedId(null);
        updateParams({ id: null });
      }

      await queryClient.invalidateQueries({ queryKey: ['crm-organizations'] });
      for (const id of result.deleted) {
        queryClient.removeQueries({ queryKey: ['crm-organization', id] });
      }
    } catch {
      toast.error(t('organizations.bulkDelete.error'));
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', height: '100%', overflow: 'hidden' }}>

      {/* ── Left panel: list ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--line)', background: 'var(--bg)' }}>

        {/* Header */}
        <CrmSidebarHeader
          title={t('organizations.title')}
          count={meta?.total ?? null}
          action={(
            <button
              onClick={() => setIsCreateOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 'var(--r)', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--teal)', background: 'var(--teal)', color: 'var(--on-teal)', whiteSpace: 'nowrap', fontFamily: 'var(--font)' }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              {t('organizations.new')}
            </button>
          )}
        />

        {/* Search */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div className="organizations-filter-bar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="search-box" style={{ flex: 1 }}>
              <CrmSearchField
                value={searchRaw}
                onChange={handleSearchChange}
                placeholder={t('organizations.search')}
                clearLabel={t('organizations.filters.clearSearch')}
                onClear={() => handleSearchChange('')}
              />
            </div>
            <div ref={filterRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className="tb-btn"
                onClick={() => setFilterOpen((value) => !value)}
                style={activeFilterCount > 0 ? { borderColor: 'var(--teal)', color: 'var(--teal)', background: 'var(--teal-dim)' } : {}}
                aria-label={t('organizations.filters.toggle')}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 3h8M3.5 6h5M5 9h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                {t('organizations.filters.toggle')}
                {activeFilterCount > 0 ? (
                  <span style={{ background: 'var(--teal)', color: 'var(--on-teal)', borderRadius: 'var(--r-pill)', fontSize: 10, padding: '1px 6px', fontFamily: 'var(--mono)' }}>
                    {activeFilterCount}
                  </span>
                ) : null}
              </button>
              {filterOpen ? (
                <div
                  className="organizations-filter-popover"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 6,
                    width: 280,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--r-lg)',
                    boxShadow: 'var(--shadow-pop)',
                    padding: 14,
                    zIndex: 100,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', display: 'block', marginBottom: 6 }}>
                      {t('organizations.sort.label')}
                    </label>
                    <select
                      className="filter-select"
                      value={sortBy}
                      onChange={(event) => handleSortByChange(event.target.value as SortBy)}
                      aria-label={t('organizations.sort.label')}
                    >
                      {SORT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {sortByLabels[option]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', display: 'block', marginBottom: 6 }}>
                      {t('organizations.filters.segment')}
                    </label>
                    <select
                      className="filter-select"
                      value={segmentRaw}
                      onChange={(event) => handleSegmentChange(event.target.value)}
                      aria-label={t('organizations.filters.segment')}
                    >
                      <option value="">{t('organizations.filters.segmentPlaceholder')}</option>
                      {segmentOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', display: 'block', marginBottom: 6 }}>
                      {t('organizations.filters.tag')}
                    </label>
                    <select
                      className="filter-select"
                      value={tagRaw}
                      onChange={(event) => handleTagChange(event.target.value)}
                      aria-label={t('organizations.filters.tag')}
                    >
                      <option value="">{t('organizations.filters.tagPlaceholder')}</option>
                      {tagOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', display: 'block', marginBottom: 6 }}>
                      {t('organizations.filters.responsible')}
                    </label>
                    <select
                      className="filter-select"
                      value={responsibleId}
                      onChange={(event) => handleResponsibleChange(event.target.value)}
                      aria-label={t('organizations.filters.responsible')}
                    >
                      <option value="">{t('organizations.filters.responsibleAll')}</option>
                      {(usersData?.data ?? []).map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', justifyContent: 'space-between' }}>
                    <button type="button" className="tb-btn" onClick={clearPopoverFilters}>
                      {t('organizations.filters.clear')}
                    </button>
                    <button type="button" className="tb-btn-primary" onClick={() => setFilterOpen(false)}>
                      {t('organizations.filters.apply')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="tb-icon-btn"
              onClick={handleSortOrderToggle}
              title={sortOrder === 'asc' ? t('organizations.sort.orderAsc') : t('organizations.sort.orderDesc')}
              aria-label={sortOrder === 'asc' ? t('organizations.sort.orderAsc') : t('organizations.sort.orderDesc')}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                {sortOrder === 'asc' ? (
                  <path d="M7 2v10M4.2 4.8L7 2l2.8 2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M7 12V2M4.2 9.2L7 12l2.8-2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Status tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none', padding: '0 4px' }}>
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => handleStatusChange(tab)}
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
        <CrmActiveFilterChips
          filters={activeFilters}
          removeLabel={t('organizations.filters.removeFilter')}
          clearAllLabel={t('organizations.filters.clearAll')}
          onClearAll={clearAllFilters}
        />
        <PermissionGate permission="organizations:delete">
          <CrmBulkSelectionBar
            visibleCount={organizations.length}
            selectedCount={selectedCount}
            allSelected={selectAllMode || allOrganizationsSelected}
            selectAllLabel={t('organizations.bulkDelete.selectPage')}
            selectedLabel={t('organizations.bulkDelete.selected', { count: selectedCount })}
            clearLabel={t('organizations.bulkDelete.clear')}
            deleteLabel={t('organizations.bulkDelete.action')}
            showSelectAllMatching={
              !selectAllMode
              && allOrganizationsSelected
              && !isFetchingCount
              && totalMatchingCount > organizations.length
            }
            selectAllMatchingLabel={t('bulkSelect.selectAllMatching', { count: totalMatchingCount })}
            onToggleAll={toggleAllOrganizations}
            onSelectAllMatching={() => {
              setSelectAllMode(true);
              setSelectedIds(new Set());
            }}
            onClear={() => {
              setSelectAllMode(false);
              setSelectedIds(new Set());
            }}
            onDelete={() => {
              if (selectAllMode) setFilterBulkDeleteOpen(true);
              else setBulkDeleteOpen(true);
            }}
          />
        </PermissionGate>

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
                selectable={canDeleteOrganizations}
                checked={selectAllMode ? !selectedIds.has(org.id) : selectedIds.has(org.id)}
                selectionLabel={t('organizations.bulkDelete.selectItem', { name: org.name })}
                onToggleSelection={() => toggleOrganizationSelection(org.id)}
                onClick={() => selectOrg(org.id)}
              />
            ))
          )}
        </div>
        {meta && meta.total_pages > 1 ? (
          <div style={{ borderTop: '1px solid var(--line)', padding: '9px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => handlePageChange(page - 1)}
              disabled={!canGoPrev}
              style={{
                height: 28,
                minWidth: 28,
                borderRadius: 'var(--r)',
                border: '1px solid var(--line-2)',
                background: canGoPrev ? 'var(--bg-3)' : 'var(--bg-2)',
                color: canGoPrev ? 'var(--txt-2)' : 'var(--txt-3)',
                fontFamily: 'var(--font)',
                fontSize: 11,
                cursor: canGoPrev ? 'pointer' : 'not-allowed',
                padding: '0 9px',
              }}
              aria-label={t('organizations.pagination.prev')}
            >
              {t('organizations.pagination.prev')}
            </button>
            <span style={{ fontSize: 11, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
              {t('organizations.pagination.pageOf', { page, total: meta.total_pages })}
            </span>
            <button
              type="button"
              onClick={() => handlePageChange(page + 1)}
              disabled={!canGoNext}
              style={{
                height: 28,
                minWidth: 28,
                borderRadius: 'var(--r)',
                border: '1px solid var(--line-2)',
                background: canGoNext ? 'var(--bg-3)' : 'var(--bg-2)',
                color: canGoNext ? 'var(--txt-2)' : 'var(--txt-3)',
                fontFamily: 'var(--font)',
                fontSize: 11,
                cursor: canGoNext ? 'pointer' : 'not-allowed',
                padding: '0 9px',
              }}
              aria-label={t('organizations.pagination.next')}
            >
              {t('organizations.pagination.next')}
            </button>
          </div>
        ) : null}
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
        <ConfirmModal
          open={bulkDeleteOpen}
          title={t('organizations.bulkDelete.title')}
          message={t('organizations.bulkDelete.confirm', { count: selectedCount })}
          confirmLabel={t('organizations.bulkDelete.confirmAction')}
          cancelLabel={t('organizations.bulkDelete.cancel')}
          confirmVariant="danger"
          loading={bulkDeleting}
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkDeleteOpen(false)}
        />
        <CrmBulkDeleteConfirmModal
          open={filterBulkDeleteOpen}
          count={selectedCount}
          title={t('bulkSelect.confirmTitle')}
          warning={t('bulkSelect.confirmWarning', { count: selectedCount })}
          instruction={t('bulkSelect.confirmInstruction', { count: selectedCount })}
          confirmLabel={t('bulkSelect.confirmDelete')}
          cancelLabel={t('organizations.bulkDelete.cancel')}
          loading={bulkDeleting}
          onConfirm={handleBulkDelete}
          onCancel={() => setFilterBulkDeleteOpen(false)}
        />
      </div>
    </PageShell>
  );
}
