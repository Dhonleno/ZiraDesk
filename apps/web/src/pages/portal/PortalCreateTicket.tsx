import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { portalApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

export function PortalCreateTicket() {
  const { t } = useTranslation('portal');
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    title: '',
    description: '',
    type_id: '',
  });

  const { data: ticketTypes = [] } = useQuery({
    queryKey: ['portal-ticket-types'],
    queryFn: () => portalApi.getTicketTypes(),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      portalApi.createTicket({
        title: form.title.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.type_id ? { type_id: form.type_id } : {}),
      }),
    onSuccess: (ticket) => {
      toast.success(t('ticket.messages.createSuccess'));
      navigate(`/portal/tickets/${ticket.id}`, { replace: true });
    },
    onError: () => toast.error(t('ticket.messages.createError')),
  });

  return (
    <div className="portal-section">
      <Link to="/portal/tickets" className="portal-back-link">← {t('ticket.backToTickets')}</Link>
      <h2>{t('ticket.createTitle')}</h2>

      <div className="portal-field">
        <label htmlFor="portal-ticket-title">{t('ticket.title')}</label>
        <input
          id="portal-ticket-title"
          value={form.title}
          onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          placeholder={t('ticket.titlePlaceholder')}
        />
      </div>

      <div className="portal-field">
        <label htmlFor="portal-ticket-type">{t('ticket.type')}</label>
        <select
          id="portal-ticket-type"
          value={form.type_id}
          onChange={(event) => setForm((prev) => ({ ...prev, type_id: event.target.value }))}
        >
          <option value="">{t('ticket.typePlaceholder')}</option>
          {ticketTypes.map((type) => (
            <option key={type.id} value={type.id}>{type.name}</option>
          ))}
        </select>
      </div>

      <div className="portal-field">
        <label htmlFor="portal-ticket-description">{t('ticket.description')}</label>
        <textarea
          id="portal-ticket-description"
          rows={6}
          value={form.description}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          placeholder={t('ticket.descriptionPlaceholder')}
        />
      </div>

      <button
        type="button"
        className="portal-btn-primary portal-btn-inline"
        disabled={!form.title.trim() || createMutation.isPending}
        onClick={() => createMutation.mutate()}
      >
        {createMutation.isPending ? t('ticket.submitLoading') : t('ticket.submit')}
      </button>
    </div>
  );
}
