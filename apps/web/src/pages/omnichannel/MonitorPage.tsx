import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePermission } from '../../hooks/usePermission';
import { TVDashboard } from '../tv/TVDashboard';
import { QueuePage } from './Queue';

type MonitorHubTab = 'agents' | 'queue';

export function MonitorPage() {
  const { t } = useTranslation('admin');
  const { user } = useAuth();
  const { canAny } = usePermission();
  const canViewMonitor = ['owner', 'admin', 'supervisor'].includes(user?.role ?? '');
  const canViewQueue = canAny('conversations:reply', 'conversations:manage');
  const [activeTab, setActiveTab] = useState<MonitorHubTab>(() => (canViewMonitor ? 'agents' : 'queue'));

  if (!canViewMonitor && !canViewQueue) {
    return <Navigate to="/omnichannel/conversations" replace />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="omni-page-tabs">
        {canViewMonitor && (
          <button
            type="button"
            className={`omni-tab${activeTab === 'agents' ? ' active' : ''}`}
            onClick={() => setActiveTab('agents')}
          >
            {t('nav.tabs.monitor')}
          </button>
        )}
        {canViewQueue && (
          <button
            type="button"
            className={`omni-tab${activeTab === 'queue' ? ' active' : ''}`}
            onClick={() => setActiveTab('queue')}
          >
            {t('nav.tabs.queue')}
          </button>
        )}
      </div>

      {/* Ambos ficam montados — só a visibilidade alterna — para não matar o polling
          (refetchInterval) da aba inativa ao trocar de aba. */}
      <div style={{ flex: 1, minHeight: 0, display: activeTab === 'agents' ? 'flex' : 'none', flexDirection: 'column' }}>
        {canViewMonitor && <TVDashboard />}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: activeTab === 'queue' ? 'flex' : 'none', flexDirection: 'column' }}>
        {canViewQueue && <QueuePage />}
      </div>
    </div>
  );
}
