import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { CrmContact } from '../../services/api';
import { ContactAvatar } from './ContactAvatar';
import { PrimaryBadge } from './ContactBadge';
import { PermissionGate } from '../ui/PermissionGate';

interface ContactCardProps {
  contact: CrmContact;
  onEdit?: (contact: CrmContact) => void;
  onStartConversation?: (contact: CrmContact) => void;
  onUnlink?: (contact: CrmContact) => void;
  onTransfer?: (contact: CrmContact) => void;
  showOrgLink?: boolean;
}

export function ContactCard({ contact, onEdit, onStartConversation, onUnlink, onTransfer, showOrgLink }: ContactCardProps) {
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
        <PermissionGate permission="contacts:edit">
          <>
            {onStartConversation && (
              <button
                className="row-action-btn"
                title={t('contacts.actions.startConversation')}
                aria-label={t('contacts.actions.startConversation')}
                onClick={() => onStartConversation(contact)}
                style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 8.5V3.5a1 1 0 011-1h6a1 1 0 011 1V7a1 1 0 01-1 1H5l-3 2v-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            {onTransfer && (
              <button
                className="row-action-btn"
                title={t('transferContact')}
                aria-label={t('transferContact')}
                onClick={() => onTransfer(contact)}
                style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M7.5 2.5L10 5l-2.5 2.5M10 5H4M4.5 9.5L2 7l2.5-2.5M2 7h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            {onUnlink && (
              <button
                className="row-action-btn"
                title={t('unlinkContact')}
                aria-label={t('unlinkContact')}
                onClick={() => onUnlink(contact)}
                style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M4.2 4.2l3.6 3.6M7.8 4.2L4.2 7.8M3 3l1-1a1.6 1.6 0 012.3 0l.7.7M9 9l-1 1a1.6 1.6 0 01-2.3 0L5 9.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            {onEdit && (
              <button
                className="row-action-btn"
                title={t('contacts.actions.edit')}
                aria-label={t('contacts.actions.edit')}
                onClick={() => onEdit(contact)}
                style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-3)', cursor: 'pointer' }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 9.5L3.2 8 8.5 2.7l1.8 1.8-5.3 5.3L2 11V9.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </>
        </PermissionGate>
      </div>
    </div>
  );
}
