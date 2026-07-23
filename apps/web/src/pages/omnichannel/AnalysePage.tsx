import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MetricsPage } from './Metrics';
import { PerformancePage } from './Performance';
import { HistoryPage } from './History';
import { TicketCsatMetrics } from './TicketCsatMetrics';

type AnalyseTab = 'metrics' | 'performance' | 'history' | 'ticketCsat';

export function AnalysePage() {
  const { t } = useTranslation('admin');
  const [activeTab, setActiveTab] = useState<AnalyseTab>('metrics');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="omni-page-tabs">
        <button
          type="button"
          className={`omni-tab${activeTab === 'metrics' ? ' active' : ''}`}
          onClick={() => setActiveTab('metrics')}
        >
          {t('nav.tabs.metrics')}
        </button>
        <button
          type="button"
          className={`omni-tab${activeTab === 'performance' ? ' active' : ''}`}
          onClick={() => setActiveTab('performance')}
        >
          {t('nav.tabs.performance')}
        </button>
        <button
          type="button"
          className={`omni-tab${activeTab === 'history' ? ' active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          {t('nav.tabs.history')}
        </button>
        <button
          type="button"
          className={`omni-tab${activeTab === 'ticketCsat' ? ' active' : ''}`}
          onClick={() => setActiveTab('ticketCsat')}
        >
          {t('nav.tabs.ticketCsat')}
        </button>
      </div>

      {/* Desmonta/remonta ao trocar — cada sub-página mantém seu próprio filtro local */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'metrics' && <MetricsPage />}
        {activeTab === 'performance' && <PerformancePage />}
        {activeTab === 'history' && <HistoryPage />}
        {activeTab === 'ticketCsat' && <TicketCsatMetrics />}
      </div>
    </div>
  );
}
