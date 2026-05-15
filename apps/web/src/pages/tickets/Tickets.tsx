import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { adminApi, ticketsApi, type Ticket, type TicketPriority, type TicketStatus } from '../../services/api';
import { PageShell } from '../../components/layout/PageShell';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';
import { subscribeToEvent } from '../../services/socket';

type BoardStatus = 'open' | 'in_progress' | 'waiting' | 'resolved';
type TicketView = 'kanban' | 'list';

const BOARD_COLUMNS: BoardStatus[] = ['open', 'in_progress', 'waiting', 'resolved'];
const STATUS_ACCENT: Record<BoardStatus, string> = {
  open: 'var(--teal)',
  in_progress: '#F59E0B',
  waiting: 'var(--amber)',
  resolved: 'var(--txt-2)',
};

function isBoardStatus(value: string): value is BoardStatus {
  return BOARD_COLUMNS.includes(value as BoardStatus);
}

function formatCompactDate(value: string): string {
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function initials(name: string | null | undefined): string {
  if (!name) return '??';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

function sanitizeTicketTitle(value: string): string {
  return value
    .replace(/[`*_~>#\[\]\(\)!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPriorityStyle(priority: TicketPriority, t: (key: string) => string) {
  if (priority === 'urgent') {
    return { bg: '#EF444420', color: '#EF4444', label: `! ${t('tickets.priority.urgent')}` };
  }

  if (priority === 'high') {
    return { bg: '#F59E0B20', color: '#F59E0B', label: `↑ ${t('tickets.priority.high')}` };
  }

  if (priority === 'medium') {
    return { bg: '#8B5CF620', color: '#8B5CF6', label: `→ ${t('tickets.priority.medium')}` };
  }

  return { bg: 'var(--bg-4)', color: 'var(--txt-2)', label: `↓ ${t('tickets.priority.low')}` };
}

function getDueMeta(ticket: Ticket): { label: string; color: string } | null {
  if (!ticket.due_date) return null;

  const due = new Date(ticket.due_date);
  const today = new Date();
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diffDays = Math.floor((dueStart - todayStart) / (24 * 60 * 60 * 1000));

  if (diffDays < 0) {
    return { label: formatCompactDate(ticket.due_date), color: '#EF4444' };
  }

  if (diffDays <= 3) {
    return { label: formatCompactDate(ticket.due_date), color: '#F59E0B' };
  }

  return { label: formatCompactDate(ticket.due_date), color: 'var(--txt-2)' };
}

function statusLabel(status: BoardStatus, t: (key: string) => string): string {
  if (status === 'open') return t('tickets.kanban.open');
  if (status === 'in_progress') return t('tickets.kanban.inProgress');
  if (status === 'waiting') return t('tickets.kanban.waiting');
  return t('tickets.kanban.resolved');
}

function StackAvatar({
  name,
  src,
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  className?: string;
}) {
  return (
    <span className={`tickets-avatar ${className ?? ''}`.trim()} title={name ?? undefined}>
      {src ? <img src={src} alt={name ?? ''} /> : <span>{initials(name)}</span>}
    </span>
  );
}

function TicketCard({
  ticket,
  t,
  onClick,
}: {
  ticket: Ticket;
  t: (key: string) => string;
  onClick: () => void;
}) {
  const priority = getPriorityStyle(ticket.priority, t);
  const dueMeta = getDueMeta(ticket);

  return (
    <button
      type="button"
      className="tickets-card"
      onClick={onClick}
      title={sanitizeTicketTitle(ticket.title)}
    >
      <div className="tickets-card-top">
        <span className="tickets-card-id">#{ticket.id.slice(-6).toUpperCase()}</span>
        <span className="tickets-priority-badge" style={{ background: priority.bg, color: priority.color }}>
          {priority.label}
        </span>
      </div>

      <div className="tickets-card-title">{sanitizeTicketTitle(ticket.title) || ticket.title}</div>

      {ticket.category ? <div className="tickets-card-category">{ticket.category}</div> : null}

      <div className="tickets-card-bottom">
        <div className="tickets-avatar-stack" aria-hidden>
          <StackAvatar name={ticket.contact_name ?? null} />
          <StackAvatar
            name={ticket.assignee_name ?? null}
            src={ticket.assignee_avatar}
            className="tickets-avatar-overlap"
          />
        </div>

        {dueMeta ? (
          <span className="tickets-card-due" style={{ color: dueMeta.color }}>
            {dueMeta.label}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function SortableTicketCard({
  ticket,
  t,
  onClick,
}: {
  ticket: Ticket;
  t: (key: string) => string;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      <TicketCard ticket={ticket} t={t} onClick={onClick} />
    </div>
  );
}

function DroppableColumn({
  id,
  children,
}: {
  id: BoardStatus;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef} className="tickets-column-body">{children}</div>;
}

export function TicketsPage() {
  const { t } = useTranslation('tickets');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [view, setView] = useState<TicketView>('kanban');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<TicketPriority | ''>('');
  const [agentId, setAgentId] = useState('');
  const [category, setCategory] = useState('');
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 250);

  const listQueryKey = ['tickets-board', debouncedSearch, priority, agentId, category] as const;

  const { data: ticketsData, isPending } = useQuery({
    queryKey: listQueryKey,
    queryFn: () => {
      const params: import('../../services/api').ListTicketsParams = {
        per_page: 100,
        sort_by: 'updated_at',
        sort_order: 'desc',
      };

      if (debouncedSearch) params.search = debouncedSearch;
      if (priority) params.priority = priority;
      if (agentId) params.assigned_to = agentId;
      if (category) params.category = category;

      return ticketsApi.list(params);
    },
    staleTime: 25_000,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['tickets-filter-agents'],
    queryFn: () => adminApi.listUsers({ per_page: 100, status: 'active' }),
    staleTime: 60_000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ ticketId, status }: { ticketId: string; status: TicketStatus }) =>
      ticketsApi.update(ticketId, { status }),
    onMutate: async ({ ticketId, status }) => {
      await queryClient.cancelQueries({ queryKey: listQueryKey });
      const previous = queryClient.getQueryData<{ data: Ticket[]; meta: { total: number } }>(listQueryKey);

      if (previous) {
        queryClient.setQueryData(listQueryKey, {
          ...previous,
          data: previous.data.map((ticket) => (
            ticket.id === ticketId ? { ...ticket, status } : ticket
          )),
        });
      }

      return { previous };
    },
    onError: (_error, _payload, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(listQueryKey, ctx.previous);
      }
      toast.error(t('tickets.errorUpdate'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
    },
  });

  useEffect(() => {
    const unsubscribers = [
      subscribeToEvent('ticket:created', () => {
        void queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
      }),
      subscribeToEvent('ticket:updated', () => {
        void queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
      }),
      subscribeToEvent('ticket:deleted', () => {
        void queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
      }),
      subscribeToEvent('ticket:assigned', () => {
        void queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [queryClient]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const tickets = ticketsData?.data ?? [];
  const total = ticketsData?.meta.total ?? tickets.length;

  const categories = useMemo(() => {
    const values = new Set<string>();
    tickets.forEach((ticket) => {
      if (ticket.category) values.add(ticket.category);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [tickets]);

  const grouped = useMemo(() => {
    const map: Record<BoardStatus, Ticket[]> = {
      open: [],
      in_progress: [],
      waiting: [],
      resolved: [],
    };

    tickets.forEach((ticket) => {
      if (isBoardStatus(ticket.status)) {
        map[ticket.status].push(ticket);
      }
    });

    return map;
  }, [tickets]);

  const ticketById = useMemo(() => {
    const map = new Map<string, Ticket>();
    tickets.forEach((ticket) => map.set(ticket.id, ticket));
    return map;
  }, [tickets]);

  const activeTicket = activeTicketId ? ticketById.get(activeTicketId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveTicketId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTicketId(null);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;

    if (!overId) return;

    const source = ticketById.get(activeId);
    if (!source) return;

    let targetStatus: BoardStatus | null = null;

    if (isBoardStatus(overId)) {
      targetStatus = overId;
    } else {
      const targetTicket = ticketById.get(overId);
      if (targetTicket && isBoardStatus(targetTicket.status)) {
        targetStatus = targetTicket.status;
      }
    }

    if (!targetStatus || targetStatus === source.status) return;

    statusMutation.mutate({ ticketId: source.id, status: targetStatus });
  }

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <section className="tickets-page-v2">
        <header className="tickets-page-header">
          <div className="tickets-page-title-wrap">
            <h1>{t('tickets.title')}</h1>
            <span className="tickets-total-badge">{total}</span>
          </div>

          <div className="tickets-inline-filters">
            <select
              className="tickets-inline-select"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              aria-label={t('tickets.filterByAgent')}
            >
              <option value="">{t('tickets.filterByAgent')}</option>
              {(agentsData?.data ?? []).map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>

            <select
              className="tickets-inline-select"
              value={priority}
              onChange={(event) => setPriority(event.target.value as TicketPriority | '')}
              aria-label={t('tickets.priority.all')}
            >
              <option value="">{t('tickets.priority.all')}</option>
              <option value="urgent">{t('tickets.priority.urgent')}</option>
              <option value="high">{t('tickets.priority.high')}</option>
              <option value="medium">{t('tickets.priority.medium')}</option>
              <option value="low">{t('tickets.priority.low')}</option>
            </select>

            <select
              className="tickets-inline-select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              aria-label={t('tickets.fields.category')}
            >
              <option value="">{t('tickets.fields.category')}</option>
              {categories.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>

            <div className="tickets-search-wrap">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.3" />
                <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <input
                className="tickets-search-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('tickets.searchPlaceholder')}
                aria-label={t('tickets.searchPlaceholder')}
              />
            </div>
          </div>

          <div className="tickets-header-actions">
            <PermissionGate permission="tickets:edit">
              <button type="button" className="tickets-primary-btn" onClick={() => navigate('/tickets/new')}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                {t('tickets.new')}
              </button>
            </PermissionGate>

            <div className="tickets-view-toggle" role="group" aria-label={t('tickets.view')}>
              <button
                type="button"
                className={view === 'kanban' ? 'active' : ''}
                onClick={() => setView('kanban')}
                title={t('tickets.viewKanban')}
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                  <rect x="1.5" y="2" width="3" height="11" rx="1" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="6" y="2" width="3" height="11" rx="1" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="10.5" y="2" width="3" height="11" rx="1" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </button>
              <button
                type="button"
                className={view === 'list' ? 'active' : ''}
                onClick={() => setView('list')}
                title={t('tickets.viewList')}
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                  <path d="M4 3h9M4 7.5h9M4 12h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <circle cx="2" cy="3" r=".9" fill="currentColor" />
                  <circle cx="2" cy="7.5" r=".9" fill="currentColor" />
                  <circle cx="2" cy="12" r=".9" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        {isPending ? (
          <div className="tickets-loading">{t('common.loading', { ns: 'admin', defaultValue: 'Carregando...' })}</div>
        ) : null}

        {!isPending && view === 'kanban' ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="tickets-kanban-board">
              {BOARD_COLUMNS.map((column) => (
                <section key={column} className="tickets-column" id={column}>
                  <header className="tickets-column-head">
                    <span>{statusLabel(column, t)}</span>
                    <span className="tickets-column-count" style={{ color: STATUS_ACCENT[column] }}>
                      {grouped[column].length}
                    </span>
                  </header>

                  <DroppableColumn id={column}>
                    {grouped[column].length === 0 ? (
                      <div className="tickets-column-empty">
                        <span className="tickets-empty-icon" aria-hidden>
                          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                            <rect x="3.5" y="4" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.3" />
                            <path d="M7 8h8M7 11h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                          </svg>
                        </span>
                        <span>{t('tickets.kanban.empty')}</span>
                      </div>
                    ) : (
                      <SortableContext items={grouped[column].map((ticket) => ticket.id)} strategy={rectSortingStrategy}>
                        {grouped[column].map((ticket) => (
                          <SortableTicketCard
                            key={ticket.id}
                            ticket={ticket}
                            t={t}
                            onClick={() => navigate(`/tickets/${ticket.id}`)}
                          />
                        ))}
                      </SortableContext>
                    )}
                  </DroppableColumn>
                </section>
              ))}
            </div>

            <DragOverlay>
              {activeTicket ? (
                <div style={{ width: 280 }}>
                  <TicketCard ticket={activeTicket} t={t} onClick={() => {}} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : null}

        {!isPending && view === 'list' ? (
          <div className="tickets-list-board">
            {BOARD_COLUMNS.map((column) => (
              <section key={column} className="tickets-list-section">
                <header className="tickets-column-head">
                  <span>{statusLabel(column, t)}</span>
                  <span className="tickets-column-count" style={{ color: STATUS_ACCENT[column] }}>
                    {grouped[column].length}
                  </span>
                </header>

                <div className="tickets-list-items">
                  {grouped[column].length === 0 ? (
                    <div className="tickets-list-empty">{t('tickets.kanban.empty')}</div>
                  ) : (
                    grouped[column].map((ticket) => (
                      <TicketCard
                        key={ticket.id}
                        ticket={ticket}
                        t={t}
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                      />
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </section>
    </PageShell>
  );
}
