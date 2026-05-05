import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { portalApi, type TicketStatus } from '../../services/api';

const tabs: Array<{ key: TicketStatus | 'all'; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'open', label: 'Abertos' },
  { key: 'in_progress', label: 'Em andamento' },
  { key: 'resolved', label: 'Resolvidos' },
];

export function PortalTickets() {
  const [status, setStatus] = useState<TicketStatus | 'all'>('all');

  const { data: result } = useQuery({
    queryKey: ['portal-tickets', status],
    queryFn: () => portalApi.getTickets(status === 'all' ? undefined : { status }),
  });

  const tickets = result?.data ?? [];

  return (
    <div className="portal-section">
      <div className="portal-page-header">
        <div>
          <h2>Meus Tickets</h2>
          <p>Acompanhe o andamento dos chamados</p>
        </div>
        <Link to="/portal/tickets/new" className="portal-btn-primary portal-btn-inline">
          + Novo ticket
        </Link>
      </div>

      <div className="portal-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={status === tab.key ? 'active' : ''}
            onClick={() => setStatus(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="portal-ticket-list">
        {tickets.map((ticket) => (
          <Link key={ticket.id} to={`/portal/tickets/${ticket.id}`} className="portal-ticket-row">
            <div>
              <div className="portal-ticket-title">{ticket.title}</div>
              <div className="portal-ticket-meta">
                {ticket.type_icon ?? '🎫'} {ticket.type_name ?? 'Ticket'} · {new Date(ticket.created_at).toLocaleDateString('pt-BR')}
              </div>
            </div>
            <span className={`portal-status portal-status-${ticket.status}`}>{ticket.status}</span>
          </Link>
        ))}
        {tickets.length === 0 ? <p className="portal-empty">Nenhum ticket para o filtro selecionado</p> : null}
      </div>
    </div>
  );
}
