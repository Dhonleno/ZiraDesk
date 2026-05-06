import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ticketsApi,
  type AddTicketRelationPayload,
  type TicketRelation,
  type TicketSearchResult,
} from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';

interface TicketRelationsProps {
  ticketId: string;
}

const RELATION_LABELS: Record<string, string> = {
  relates_to: 'Relacionado a',
  duplicates: 'Duplicata de',
  blocks: 'Bloqueia',
  is_blocked_by: 'Bloqueado por',
};

const RELATION_COLORS: Record<string, string> = {
  relates_to: 'var(--txt-3)',
  duplicates: 'var(--amber)',
  blocks: 'var(--red)',
  is_blocked_by: 'var(--red)',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'var(--blue)',
  in_progress: 'var(--amber)',
  waiting: 'var(--purple)',
  resolved: 'var(--green)',
  closed: 'var(--txt-3)',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  waiting: 'Aguardando',
  resolved: 'Resolvido',
  closed: 'Fechado',
};

export default function TicketRelations({ ticketId }: TicketRelationsProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [relationType, setRelationType] = useState<AddTicketRelationPayload['relation_type']>('relates_to');
  const [selectedTicket, setSelectedTicket] = useState<TicketSearchResult | null>(null);
  const debouncedSearch = useDebounce(search, 300);

  const { data: relations = [] } = useQuery<TicketRelation[]>({
    queryKey: ['ticket-relations', ticketId],
    queryFn: () => ticketsApi.listRelations(ticketId),
    enabled: !!ticketId,
  });

  const { data: searchResults = [] } = useQuery<TicketSearchResult[]>({
    queryKey: ['tickets-search', ticketId, debouncedSearch],
    queryFn: () => ticketsApi.search(debouncedSearch, ticketId),
    enabled: debouncedSearch.length >= 2,
  });

  const addMutation = useMutation({
    mutationFn: () => {
      if (!selectedTicket) throw new Error('Ticket não selecionado');
      return ticketsApi.addRelation(ticketId, {
        related_id: selectedTicket.id,
        relation_type: relationType,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ticket-relations', ticketId] });
      await queryClient.invalidateQueries({ queryKey: ['ticket-timeline', ticketId] });
      setShowAdd(false);
      setSearch('');
      setSelectedTicket(null);
      setRelationType('relates_to');
      toast.success('Ticket vinculado');
    },
    onError: (error: unknown) => {
      const message =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error as any)?.response?.data?.error?.message ??
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error as any)?.response?.data?.error ??
        'Erro ao vincular ticket';
      toast.error(message);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (relationId: string) => ticketsApi.removeRelation(ticketId, relationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ticket-relations', ticketId] });
      await queryClient.invalidateQueries({ queryKey: ['ticket-timeline', ticketId] });
      toast.success('Vínculo removido');
    },
    onError: () => toast.error('Erro ao remover vínculo'),
  });

  function toggleAddForm() {
    setShowAdd((prev) => !prev);
    setTimeout(() => searchRef.current?.focus(), 100);
  }

  return (
    <div className="ticket-section">
      <div className="ticket-section-header">
        <span className="ticket-section-title">
          Tickets relacionados
          {relations.length > 0 ? (
            <span className="section-count">{relations.length}</span>
          ) : null}
        </span>
        <button
          type="button"
          className="tb-icon-btn"
          onClick={toggleAddForm}
          title="Vincular ticket"
          aria-label="Vincular ticket"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
            <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {showAdd ? (
        <div className="relation-add-form">
          <select
            value={relationType}
            onChange={(event) => setRelationType(event.target.value as AddTicketRelationPayload['relation_type'])}
            className="relation-type-select"
          >
            <option value="relates_to">Relacionado a</option>
            <option value="duplicates">Duplicata de</option>
            <option value="blocks">Bloqueia</option>
            <option value="is_blocked_by">Bloqueado por</option>
          </select>

          {selectedTicket ? (
            <div className="relation-selected">
              <span className="relation-selected-title">
                #{selectedTicket.id.slice(-6).toUpperCase()} - {selectedTicket.title}
              </span>
              <button
                type="button"
                className="relation-selected-clear"
                onClick={() => setSelectedTicket(null)}
                aria-label="Remover seleção"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="relation-search-wrapper">
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar ticket pelo título ou ID..."
                className="relation-search-input"
              />

              {search.length >= 2 && searchResults.length > 0 ? (
                <div className="relation-search-results">
                  {searchResults.map((ticket) => (
                    <button
                      type="button"
                      key={ticket.id}
                      className="relation-search-item"
                      onClick={() => {
                        setSelectedTicket(ticket);
                        setSearch('');
                      }}
                    >
                      <span
                        className="relation-search-status"
                        style={{ background: STATUS_COLORS[ticket.status] ?? 'var(--txt-3)' }}
                      />
                      <span className="relation-search-title">
                        #{ticket.id.slice(-6).toUpperCase()} - {ticket.title}
                      </span>
                      <span className="relation-search-badge">
                        {STATUS_LABELS[ticket.status] ?? ticket.status}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {search.length >= 2 && searchResults.length === 0 ? (
                <div className="relation-search-empty">Nenhum ticket encontrado</div>
              ) : null}
            </div>
          )}

          <div className="relation-add-actions">
            <button
              type="button"
              className="zd-btn"
              onClick={() => {
                setShowAdd(false);
                setSearch('');
                setSelectedTicket(null);
                setRelationType('relates_to');
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="zd-btn zd-btn-primary"
              disabled={!selectedTicket || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              Vincular
            </button>
          </div>
        </div>
      ) : null}

      {relations.length > 0 ? (
        <div className="relations-list">
          {relations.map((relation) => {
            let label = RELATION_LABELS[relation.relation_type] ?? relation.relation_type;
            if (relation.relation_type === 'blocks' && relation.direction === 'incoming') {
              label = RELATION_LABELS.is_blocked_by ?? 'Bloqueado por';
            }

            return (
              <div key={relation.relation_id} className="relation-item">
                <div className="relation-item-left">
                  <span
                    className="relation-type-label"
                    style={{ color: RELATION_COLORS[relation.relation_type] ?? 'var(--txt-3)' }}
                  >
                    {label}
                  </span>
                  <span className="relation-ticket-id">
                    #{relation.related_ticket_id.slice(-6).toUpperCase()}
                  </span>
                  <span className="relation-ticket-title">{relation.related_title}</span>
                </div>

                <div className="relation-item-right">
                  <span
                    className="relation-status-badge"
                    style={{ color: STATUS_COLORS[relation.related_status] ?? 'var(--txt-3)' }}
                  >
                    {STATUS_LABELS[relation.related_status] ?? relation.related_status}
                  </span>

                  <div className="row-actions">
                    <button
                      type="button"
                      className="tb-icon-btn danger"
                      onClick={() => removeMutation.mutate(relation.relation_id)}
                      title="Remover vínculo"
                      aria-label="Remover vínculo"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : !showAdd ? (
        <p className="relations-empty">Nenhum ticket vinculado</p>
      ) : null}
    </div>
  );
}
