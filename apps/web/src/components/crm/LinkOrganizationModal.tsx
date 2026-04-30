import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { contactsApi, organizationsApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { ContactAvatar } from './ContactAvatar';
import { useDebounce } from '../../hooks/useDebounce';

interface Props {
  open: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
}

export function LinkOrganizationModal({ open, onClose, contactId, contactName }: Props) {
  const { t } = useTranslation('crm');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [searchRaw, setSearchRaw] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const search = useDebounce(searchRaw, 300);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-organizations-search', search],
    queryFn: () => {
      const params: Parameters<typeof organizationsApi.list>[0] = { per_page: 10 };
      if (search) params.search = search;
      return organizationsApi.list(params);
    },
    enabled: open,
  });

  const organizations = data?.data ?? [];

  const mutation = useMutation({
    mutationFn: () => contactsApi.linkOrganization(contactId, selectedOrgId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-contact', contactId] });
      toast.success(t('contacts.messages.linked'));
      handleClose();
    },
    onError: () => {
      toast.error('Erro ao vincular organização');
    },
  });

  function handleClose() {
    setSearchRaw('');
    setSelectedOrgId(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title={t('contacts.linkModal.title')} maxWidth="sm">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
          {contactName}
        </div>

        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ color: 'var(--txt-3)', flexShrink: 0 }} aria-hidden>
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder={t('contacts.linkModal.search')}
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            autoFocus
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--font)', color: 'var(--txt)', width: '100%' }}
          />
        </div>

        {/* Results */}
        <div style={{ maxHeight: 240, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-5) transparent', border: '1px solid var(--line)', borderRadius: 'var(--r)', background: 'var(--bg-3)' }}>
          {isLoading ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>
              {t('contacts.linkModal.loading')}
            </div>
          ) : organizations.length === 0 ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>
              {t('contacts.linkModal.noResults')}
            </div>
          ) : (
            organizations.map((org) => (
              <div
                key={org.id}
                onClick={() => setSelectedOrgId(org.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--line)',
                  background: selectedOrgId === org.id ? 'var(--teal-dim)' : 'transparent',
                  transition: 'background .1s',
                }}
                onMouseEnter={(e) => { if (selectedOrgId !== org.id) e.currentTarget.style.background = 'var(--bg-4)'; }}
                onMouseLeave={(e) => { if (selectedOrgId !== org.id) e.currentTarget.style.background = 'transparent'; }}
              >
                <ContactAvatar id={org.id} name={org.name} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: selectedOrgId === org.id ? 'var(--teal)' : 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {org.name}
                  </div>
                  {org.segment && (
                    <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{org.segment}</div>
                  )}
                </div>
                {selectedOrgId === org.id && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M2.5 7l3 3 6-6" stroke="var(--teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <button
            onClick={handleClose}
            style={{ padding: '6px 14px', borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--txt-2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)' }}
          >
            Cancelar
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!selectedOrgId || mutation.isPending}
            style={{
              padding: '6px 14px', borderRadius: 'var(--r)',
              border: '1px solid var(--teal)', background: 'var(--teal)',
              color: 'var(--on-teal)', fontSize: 12, fontWeight: 600,
              cursor: selectedOrgId && !mutation.isPending ? 'pointer' : 'not-allowed',
              opacity: !selectedOrgId || mutation.isPending ? 0.5 : 1,
              fontFamily: 'var(--font)',
            }}
          >
            {mutation.isPending ? t('contacts.linkModal.submitting') : t('contacts.linkModal.submit')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
