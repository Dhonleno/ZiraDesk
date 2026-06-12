import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { campaignsApi, contactsApi, type Campaign, type CrmContact } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';

interface Props {
  campaign: Campaign;
  onClose: () => void;
}

type ContactStatusFilter = '' | 'lead' | 'prospect' | 'client' | 'inactive';

function hasPhone(contact: CrmContact): boolean {
  return Boolean(contact.whatsapp?.trim() || contact.phone?.trim());
}

export function CampaignContactsModal({ campaign, onClose }: Props) {
  const { t } = useTranslation(['campaigns', 'crm']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const overlayRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContactStatusFilter>('');
  const [tagFilter, setTagFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const debouncedSearch = useDebounce(search, 280);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const {
    data: contactsData,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['campaign-contacts-search', debouncedSearch, statusFilter, tagFilter],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => contactsApi.list({
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(tagFilter ? { tags: [tagFilter] } : {}),
      per_page: 30,
      page: pageParam,
    }),
    getNextPageParam: (lastPage) => (
      lastPage.meta.page < lastPage.meta.total_pages
        ? lastPage.meta.page + 1
        : undefined
    ),
    staleTime: 30_000,
  });

  const { data: existingContacts } = useQuery({
    queryKey: ['campaign-existing-contacts', campaign.id],
    queryFn: () => campaignsApi.listContacts(campaign.id, { limit: 500 }),
    staleTime: 10_000,
  });

  const existingContactIds = useMemo(
    () => new Set((existingContacts?.data ?? []).map((cc) => cc.contact_id)),
    [existingContacts],
  );

  const { data: allTags = [] } = useQuery({
    queryKey: ['contact-tags'],
    queryFn: () => contactsApi.listTags(),
    staleTime: 5 * 60_000,
  });

  const contacts = contactsData?.pages.flatMap((result) => result.data) ?? [];
  const availableTags = useMemo(() => (
    [...allTags].sort((left, right) => left.name.localeCompare(right.name))
  ), [allTags]);

  const addMutation = useMutation({
    mutationFn: () => campaignsApi.addContacts(campaign.id, Array.from(selected)),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaign.id] });
      void queryClient.invalidateQueries({ queryKey: ['campaign-existing-contacts', campaign.id] });
      toast.success(`${result.added} contato(s) adicionado(s). Total: ${result.total_contacts}`);
      setSelected(new Set());
    },
    onError: () => {
      toast.error('Erro ao adicionar contatos. Verifique se têm telefone cadastrado.');
    },
  });

  const isDraft = campaign.status === 'draft';
  const selectedCount = selected.size;
  const selectableVisibleContacts = contacts.filter(
    (contact) => isDraft && !existingContactIds.has(contact.id) && hasPhone(contact),
  );
  const allVisibleSelected = selectableVisibleContacts.length > 0
    && selectableVisibleContacts.every((contact) => selected.has(contact.id));

  const toggleSelect = (contactId: string, contact: CrmContact) => {
    if (!isDraft || existingContactIds.has(contactId) || !hasPhone(contact)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      selectableVisibleContacts.forEach((contact) => {
        if (checked) next.add(contact.id);
        else next.delete(contact.id);
      });
      return next;
    });
  };

  const handleListScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
    const isNearEnd = scrollHeight - scrollTop - clientHeight < 80;
    if (isNearEnd && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 34,
    background: 'var(--bg-3)',
    border: '1px solid var(--line-2)',
    borderRadius: 'var(--r)',
    color: 'var(--txt)',
    fontSize: 12,
    padding: '0 10px',
    outline: 'none',
    fontFamily: 'var(--font)',
    boxSizing: 'border-box',
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('contacts.title')}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'var(--backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{
        width: '100%',
        maxWidth: 540,
        background: 'var(--bg-2)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-pop)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 48px)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{t('contacts.title')}</div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 1 }}>{campaign.name}</div>
          </div>
          <button onClick={onClose} className="tb-icon-btn" aria-label="Fechar">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              autoFocus
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('contacts.search')}
            />
            <select
              className="fchip"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ContactStatusFilter)}
            >
              <option value="">{t('addContacts.allStatuses')}</option>
              <option value="lead">{t('organizations.status.lead', { ns: 'crm' })}</option>
              <option value="prospect">{t('organizations.status.prospect', { ns: 'crm' })}</option>
              <option value="client">{t('organizations.status.client', { ns: 'crm' })}</option>
              <option value="inactive">{t('organizations.status.inactive', { ns: 'crm' })}</option>
            </select>
            <select
              className="fchip"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
            >
              <option value="">{t('addContacts.allTags')}</option>
              {availableTags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Selection bar */}
        {selectedCount > 0 && (
          <div style={{
            padding: '8px 18px',
            background: 'var(--teal-dim)',
            borderBottom: '1px solid rgba(0,201,167,.15)',
            fontSize: 11,
            color: 'var(--teal)',
            fontWeight: 500,
            flexShrink: 0,
          }}>
            {t('contacts.selected', { count: selectedCount })}
          </div>
        )}

        {/* Contact list */}
        <div onScroll={handleListScroll} style={{ overflowY: 'auto', flex: 1 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 18px',
            borderBottom: '1px solid var(--line)',
            fontSize: 12,
            color: 'var(--txt-2)',
          }}>
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={selectableVisibleContacts.length === 0}
              onChange={(event) => toggleSelectAll(event.target.checked)}
            />
            <span>{t('addContacts.selectAll')}</span>
          </div>

          {isFetching && contacts.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--txt-3)', fontSize: 12 }}>
              Carregando...
            </div>
          )}

          {!isFetching && contacts.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--txt-3)', fontSize: 12 }}>
              {t('contacts.noResults')}
            </div>
          )}

          {contacts.map((contact) => {
            const isExisting = existingContactIds.has(contact.id);
            const noPhone = !hasPhone(contact);
            const isChecked = selected.has(contact.id) || isExisting;
            const disabled = isExisting || noPhone || !isDraft;

            return (
              <div
                key={contact.id}
                onClick={() => toggleSelect(contact.id, contact)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '9px 18px',
                  borderBottom: '1px solid var(--line)',
                  cursor: disabled ? 'default' : 'pointer',
                  background: selected.has(contact.id) ? 'var(--teal-dim)' : 'transparent',
                  opacity: noPhone ? 0.5 : 1,
                  transition: 'background .1s',
                }}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={disabled}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => toggleSelect(contact.id, contact)}
                  style={{
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    accentColor: 'var(--teal)',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                />

                {/* Avatar */}
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--bg-5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--txt-2)',
                  flexShrink: 0,
                }}>
                  {contact.name.slice(0, 2).toUpperCase()}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--txt)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {contact.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {contact.whatsapp ?? contact.phone ?? contact.email ?? '—'}
                  </div>
                </div>

                {isExisting && (
                  <span style={{ fontSize: 10, color: 'var(--teal)', fontWeight: 500, flexShrink: 0 }}>
                    {t('contacts.alreadyAdded')}
                  </span>
                )}
                {noPhone && !isExisting && (
                  <span
                    className="tag-pill"
                    style={{ background: 'var(--bg-4)', color: 'var(--txt-3)', flexShrink: 0 }}
                  >
                    {t('addContacts.noPhone')}
                  </span>
                )}
              </div>
            );
          })}

          {isFetchingNextPage && (
            <div style={{ padding: '12px 18px', textAlign: 'center', fontSize: 11, color: 'var(--txt-3)' }}>
              Carregando...
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
          <button className="tb-btn" onClick={onClose}>Cancelar</button>
          <button
            className="tb-btn tb-btn-primary"
            disabled={selectedCount === 0 || addMutation.isPending || !isDraft}
            onClick={() => addMutation.mutate()}
          >
            {addMutation.isPending
              ? t('contacts.adding')
              : selectedCount > 0
                ? t('addContacts.confirmWithCount', { count: selectedCount })
                : t('addContacts.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
