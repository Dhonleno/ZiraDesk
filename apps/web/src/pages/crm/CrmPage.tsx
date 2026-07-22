import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../../hooks/usePermission';
import { ContactsPage } from './Contacts';
import { OrganizationsPage } from './Organizations';

type CrmTab = 'contacts' | 'organizations';

export function CrmPage() {
  const { t } = useTranslation('admin');
  const { can } = usePermission();
  const canViewContacts = can('contacts:view');
  const [activeTab, setActiveTab] = useState<CrmTab>(() => (canViewContacts ? 'contacts' : 'organizations'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="omni-page-tabs">
        {canViewContacts && (
          <button
            type="button"
            className={`omni-tab${activeTab === 'contacts' ? ' active' : ''}`}
            onClick={() => setActiveTab('contacts')}
          >
            {t('nav.tabs.contacts')}
          </button>
        )}
        <button
          type="button"
          className={`omni-tab${activeTab === 'organizations' ? ' active' : ''}`}
          onClick={() => setActiveTab('organizations')}
        >
          {t('nav.tabs.organizations')}
        </button>
      </div>

      {/* Desmonta/remonta ao trocar — selectedIds/selectAllMode de cada tela são
          resetados automaticamente por não sobreviverem ao unmount. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'contacts' && canViewContacts ? <ContactsPage /> : <OrganizationsPage />}
      </div>
    </div>
  );
}
