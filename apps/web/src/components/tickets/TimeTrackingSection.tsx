import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ticketsApi, type TicketTimeEntry } from '../../services/api';
import { useToast } from '../../stores/toast.store';

interface TimeTrackingSectionProps {
  ticketId: string;
}

function formatMinutes(minutesTotal: number): string {
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

export default function TimeTrackingSection({ ticketId }: TimeTrackingSectionProps) {
  const { t } = useTranslation('tickets');
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    hours: '',
    minutes: '',
    description: '',
    worked_at: new Date().toISOString().split('T')[0] ?? '',
  });

  const { data: entries = [] } = useQuery<TicketTimeEntry[]>({
    queryKey: ['ticket-time', ticketId],
    queryFn: () => ticketsApi.listTimeEntries(ticketId),
    enabled: !!ticketId,
  });

  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);

  const addMutation = useMutation({
    mutationFn: (data: { minutes: number; description?: string; worked_at?: string }) =>
      ticketsApi.addTimeEntry(ticketId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ticket-time', ticketId] });
      toast.success(t('tickets.timeTracking.addSuccess'));
      setShowForm(false);
      setForm({
        hours: '',
        minutes: '',
        description: '',
        worked_at: new Date().toISOString().split('T')[0] ?? '',
      });
    },
    onError: () => toast.error(t('tickets.timeTracking.addError')),
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: string) => ticketsApi.deleteTimeEntry(ticketId, entryId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ticket-time', ticketId] });
      toast.success(t('tickets.timeTracking.deleteSuccess'));
    },
    onError: () => toast.error(t('tickets.timeTracking.deleteError')),
  });

  function handleAdd() {
    const totalMins = Number(form.hours || 0) * 60 + Number(form.minutes || 0);
    if (totalMins <= 0) {
      toast.error(t('tickets.timeTracking.noMinutesError'));
      return;
    }

    addMutation.mutate({
      minutes: totalMins,
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      worked_at: form.worked_at,
    });
  }

  return (
    <section className="ticket-dsec">
      <div className="ticket-dsec-head">
        <span>
          {t('tickets.timeTracking.title')}
          {totalMinutes > 0 ? (
            <span className="time-total-badge">{formatMinutes(totalMinutes)}</span>
          ) : null}
        </span>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowForm((prev) => !prev)}
        >
          {t('tickets.timeTracking.register')}
        </button>
      </div>

      <div className="ticket-dsec-body">
      {showForm ? (
        <div className="time-form">
          <div className="time-inputs-row">
            <div className="time-input-group">
              <label htmlFor="time-hours">{t('tickets.timeTracking.hours')}</label>
              <input
                id="time-hours"
                type="number"
                min={0}
                max={24}
                placeholder="0"
                value={form.hours}
                onChange={(e) => setForm((prev) => ({ ...prev, hours: e.target.value }))}
              />
            </div>
            <div className="time-input-group">
              <label htmlFor="time-minutes">{t('tickets.timeTracking.minutes')}</label>
              <input
                id="time-minutes"
                type="number"
                min={0}
                max={59}
                placeholder="0"
                value={form.minutes}
                onChange={(e) => setForm((prev) => ({ ...prev, minutes: e.target.value }))}
              />
            </div>
            <div className="time-input-group">
              <label htmlFor="time-worked-at">{t('tickets.timeTracking.date')}</label>
              <input
                id="time-worked-at"
                type="date"
                value={form.worked_at}
                onChange={(e) => setForm((prev) => ({ ...prev, worked_at: e.target.value }))}
              />
            </div>
          </div>
          <input
            placeholder={t('tickets.timeTracking.descriptionPlaceholder')}
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            className="time-desc-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
          />
          <div className="time-form-actions">
            <button
              type="button"
              onClick={handleAdd}
              disabled={addMutation.isPending}
              className="zd-btn zd-btn-primary"
            >
              {t('tickets.timeTracking.save')}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="zd-btn"
            >
              {t('tickets.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {entries.length === 0 && !showForm ? (
        <div className="ticket-empty-state">
          <div className="ticket-empty-icon">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
              <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M10 6.5V10l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="ticket-empty-title">{t('tickets.timeTracking.emptyTitle')}</p>
        </div>
      ) : (
        <div className="time-entries">
          {entries.map((entry) => (
            <div key={entry.id} className="time-entry">
              <span className="time-entry-duration">{formatMinutes(entry.minutes)}</span>
              <div className="time-entry-info">
                <span className="time-entry-desc">
                  {entry.description || t('tickets.timeTracking.noDescription')}
                </span>
                <span className="time-entry-meta">
                  {entry.user_name ?? t('tickets.timeTracking.unknownUser')} · {new Date(entry.worked_at).toLocaleDateString('pt-BR')}
                </span>
              </div>
              <button
                type="button"
                className="checklist-delete"
                onClick={() => deleteMutation.mutate(entry.id)}
                aria-label={t('tickets.timeTracking.deleteEntry')}
                title={t('tickets.timeTracking.deleteEntry')}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}
