import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { CrmContact } from '../../services/api';
import { ContactAvatar } from './ContactAvatar';
import { PrimaryBadge } from './ContactBadge';

interface ContactCardProps {
  contact: CrmContact;
  onEdit?: (contact: CrmContact) => void;
  onStartConversation?: (contact: CrmContact) => void;
  showOrgLink?: boolean;
}

export function ContactCard({ contact, onEdit, onStartConversation, showOrgLink }: ContactCardProps) {
  const { t } = useTranslation('crm');
  const navigate = useNavigate();

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 0', borderBottom: '1px solid var(--line)',
    }}>
      <ContactAvatar id={contact.id} name={contact.name} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contact.name}
          </span>
          {contact.is_primary && (
            <PrimaryBadge label={t('contacts.primary')} />
          )}
        </div>
        {contact.role && (
          <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 2 }}>{contact.role}</div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {contact.email && (
            <span style={{ fontSize: 11, color: 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{contact.email}</span>
          )}
          {contact.whatsapp && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt-2)' }}>{contact.whatsapp}</span>
          )}
        </div>
        {showOrgLink && contact.organization_name && (
          <button
            onClick={() => navigate(`/crm/organizations?id=${contact.organization_id}`)}
            style={{ fontSize: 11, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font)', marginTop: 2 }}
          >
            {contact.organization_name}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {onStartConversation && (
          <button
            title={t('contacts.actions.startConversation')}
            onClick={() => onStartConversation(contact)}
            style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 8.5V3.5a1 1 0 011-1h6a1 1 0 011 1V7a1 1 0 01-1 1H5l-3 2v-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        {onEdit && (
          <button
            title={t('contacts.actions.edit')}
            onClick={() => onEdit(contact)}
            style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 9.5L3.2 8 8.5 2.7l1.8 1.8-5.3 5.3L2 11V9.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
