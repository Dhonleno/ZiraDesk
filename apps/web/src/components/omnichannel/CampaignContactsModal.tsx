import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { campaignsApi, contactsApi, type Campaign, type CrmContact } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';

interface Props {
  campaign: Campaign;
  onClose: () => void;
}

function hasPhone(contact: CrmContact): boolean {
  return Boolean(contact.whatsapp?.trim() || contact.phone?.trim());
}

export function CampaignContactsModal({ campaign, onClose }: Props) {
  const { t } = useTranslation('campaigns');
  const toast = useToast();
  const queryClient = useQueryClient();
  const overlayRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 280);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const { data: contactsData, isFetching } = useQuery({
    queryKey: ['campaign-contacts-search', debouncedSearch, page],
    queryFn: () => contactsApi.list({ ...(debouncedSearch ? { search: debouncedSearch } : {}), per_page: 30, page }),
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

  const contacts = contactsData?.data ?? [];
  const meta = contactsData?.meta;

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

  const toggleSelect = (contactId: string, contact: CrmContact) => {
    if (!isDraft || existingContactIds.has(contactId) || !hasPhone(contact)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
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
          <input
            autoFocus
            style={inputStyle}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('contacts.search')}
          />
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
        <div style={{ overflowY: 'auto', flex: 1 }}>
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
                <div style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: `1.5px solid ${isChecked ? 'var(--teal)' : 'var(--line-2)'}`,
                  background: isChecked ? 'var(--teal)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all .12s',
                }}>
                  {isChecked && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                      <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>

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
                  <span style={{ fontSize: 10, color: 'var(--red)', flexShrink: 0 }}>
                    {t('contacts.noPhone')}
                  </span>
                )}
              </div>
            );
          })}

          {/* Pagination */}
          {meta && meta.total > 30 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '12px 18px' }}>
              {page > 1 && (
                <button className="tb-btn" onClick={() => setPage((p) => p - 1)} style={{ fontSize: 11 }}>
                  Anterior
                </button>
              )}
              <span style={{ fontSize: 11, color: 'var(--txt-3)', alignSelf: 'center' }}>
                {(page - 1) * 30 + 1}–{Math.min(page * 30, meta.total)} de {meta.total}
              </span>
              {page * 30 < meta.total && (
                <button className="tb-btn" onClick={() => setPage((p) => p + 1)} style={{ fontSize: 11 }}>
                  {t('contacts.loadMore')}
                </button>
              )}
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
              : t('contacts.add')}
          </button>
        </div>
      </div>
    </div>
  );
}
