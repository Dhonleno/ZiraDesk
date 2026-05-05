import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { portalApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

export function PortalCreateTicket() {
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
      toast.success('Ticket criado com sucesso');
      navigate(`/portal/tickets/${ticket.id}`, { replace: true });
    },
    onError: () => toast.error('Erro ao criar ticket'),
  });

  return (
    <div className="portal-section">
      <Link to="/portal/tickets" className="portal-back-link">← Voltar para tickets</Link>
      <h2>Novo ticket</h2>

      <div className="portal-field">
        <label htmlFor="portal-ticket-title">Título</label>
        <input
          id="portal-ticket-title"
          value={form.title}
          onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          placeholder="Resumo do problema"
        />
      </div>

      <div className="portal-field">
        <label htmlFor="portal-ticket-type">Tipo</label>
        <select
          id="portal-ticket-type"
          value={form.type_id}
          onChange={(event) => setForm((prev) => ({ ...prev, type_id: event.target.value }))}
        >
          <option value="">Selecione o tipo</option>
          {ticketTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.icon} {type.name}
            </option>
          ))}
        </select>
      </div>

      <div className="portal-field">
        <label htmlFor="portal-ticket-description">Descrição</label>
        <textarea
          id="portal-ticket-description"
          rows={6}
          value={form.description}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          placeholder="Descreva o que está acontecendo"
        />
      </div>

      <button
        type="button"
        className="portal-btn-primary portal-btn-inline"
        disabled={!form.title.trim() || createMutation.isPending}
        onClick={() => createMutation.mutate()}
      >
        Enviar ticket
      </button>
    </div>
  );
}
