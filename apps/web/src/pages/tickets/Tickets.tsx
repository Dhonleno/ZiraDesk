import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
import {
  adminApi,
  ticketsApi,
  type ListTicketsParams,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
} from '../../services/api';
import { PageShell } from '../../components/layout/PageShell';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast.store';
import { useAuthStore } from '../../stores/auth.store';
import { subscribeToEvent } from '../../services/socket';
import { getSlaColor, getSlaInfo, type SlaInfo } from '../../utils/sla';

type BoardStatus = 'queued' | 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
type TicketView = 'kanban' | 'list';
type TFn = TFunction<'tickets'>;

const BOARD_COLUMNS: BoardStatus[] = ['queued', 'open', 'in_progress', 'waiting', 'resolved', 'closed'];
const CLOSED_COLUMN_MAX_ITEMS = 20;
const STATUS_ACCENT: Record<BoardStatus, string> = {
  queued: 'var(--amber)',
  open: 'var(--teal)',
  in_progress: 'var(--amber)',
  waiting: 'var(--blue)',
  resolved: 'var(--green)',
  closed: 'var(--txt-3)',
};

function isBoardStatus(value: string): value is BoardStatus {
  return BOARD_COLUMNS.includes(value as BoardStatus);
}

function formatCompactDate(value: string): string {
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function formatTicketNumber(n: number): string {
  return `#${String(n).padStart(5, '0')}`;
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

function getPriorityStyle(priority: TicketPriority, t: TFn) {
  if (priority === 'urgent') {
    return { bg: 'var(--red-dim)', color: 'var(--red)', label: `! ${t('tickets.priority.urgent')}` };
  }

  if (priority === 'high') {
    return { bg: 'var(--amber-dim)', color: 'var(--amber)', label: `↑ ${t('tickets.priority.high')}` };
  }

  if (priority === 'medium') {
    return { bg: 'var(--purple-dim)', color: 'var(--purple)', label: `→ ${t('tickets.priority.medium')}` };
  }

  return { bg: 'var(--bg-4)', color: 'var(--txt-2)', label: `↓ ${t('tickets.priority.low')}` };
}

function statusLabel(status: BoardStatus, t: TFn): string {
  if (status === 'queued') return t('tickets.kanban.queued');
  if (status === 'open') return t('tickets.kanban.open');
  if (status === 'in_progress') return t('tickets.kanban.inProgress');
  if (status === 'waiting') return t('tickets.kanban.waiting');
  if (status === 'resolved') return t('tickets.kanban.resolved');
  return t('tickets.kanban.closed');
}

function isReadonlyStatus(status: BoardStatus): boolean {
  return status === 'closed' || status === 'queued';
}

function canDropToStatus(status: BoardStatus): boolean {
  return status !== 'closed' && status !== 'queued';
}

function parseTicketPriority(value: string | null): TicketPriority | '' {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'urgent') return value;
  return '';
}

function parseHighlightStatus(value: string | null): BoardStatus | '' {
  return value && isBoardStatus(value) ? value : '';
}

function getSlaLabel(sla: SlaInfo, t: TFn): string | null {
  if (sla.status === 'none' || sla.status === 'ok' || sla.hoursRemaining === null) return null;

  if (sla.status === 'overdue') {
    const overdueHours = Math.abs(Math.floor(sla.hoursRemaining));
    if (overdueHours >= 24) {
      return t('tickets.sla.overdueDays', { count: Math.floor(overdueHours / 24) });
    }
    return t('tickets.sla.overdueHours', { count: overdueHours });
  }

  if (sla.hoursRemaining < 1) {
    return t('tickets.sla.expiresLessThanHour');
  }

  const remainingHours = Math.floor(sla.hoursRemaining);
  if (remainingHours <= 0) {
    return t('tickets.sla.expiresToday');
  }

  return t('tickets.sla.expiresHours', { count: remainingHours });
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
  now,
  onClick,
  onClaim,
  isClaiming,
}: {
  ticket: Ticket;
  t: TFn;
  now: Date;
  onClick: () => void;
  onClaim?: (ticketId: string) => void;
  isClaiming?: boolean;
}) {
  const priority = getPriorityStyle(ticket.priority, t);
  const sla = getSlaInfo(ticket.due_date, ticket.status, now);
  const slaLabel = getSlaLabel(sla, t);
  const dueColor = sla.status === 'warning' || sla.status === 'overdue'
    ? getSlaColor(sla.status)
    : 'var(--txt-2)';

  return (
    <div
      role="button"
      tabIndex={0}
      className="tickets-card"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      aria-label={`${formatTicketNumber(ticket.ticket_number)} — ${sanitizeTicketTitle(ticket.title)}`}
      title={sanitizeTicketTitle(ticket.title)}
    >
      <div className="tickets-card-top">
        <span className="tickets-card-id">{formatTicketNumber(ticket.ticket_number)}</span>
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

        {ticket.due_date ? (
          <span className="tickets-card-due" style={{ color: dueColor }}>
            {(sla.status === 'warning' || sla.status === 'overdue') ? (
              <span
                aria-hidden
                className={`tickets-sla-dot ${sla.status}`}
              />
            ) : null}
            {formatCompactDate(ticket.due_date)}
            {slaLabel ? <span className="tickets-card-sla-label"> · {slaLabel}</span> : null}
          </span>
        ) : null}
      </div>

      {ticket.status === 'queued' && onClaim ? (
        <button
          type="button"
          className="tickets-card-claim-btn"
          disabled={isClaiming}
          onClick={(event) => {
            event.stopPropagation();
            onClaim(ticket.id);
          }}
        >
          {t('tickets.actions.claim')}
        </button>
      ) : null}
    </div>
  );
}

function SortableTicketCard({
  ticket,
  t,
  now,
  onClick,
}: {
  ticket: Ticket;
  t: TFn;
  now: Date;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    disabled: ticket.status === 'closed',
  });

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
      <TicketCard ticket={ticket} t={t} now={now} onClick={onClick} />
    </div>
  );
}

function DroppableColumn({
  id,
  disabled = false,
  children,
}: {
  id: BoardStatus;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id, disabled });
  return <div ref={setNodeRef} className="tickets-column-body">{children}</div>;
}

export function TicketsPage() {
  const { t } = useTranslation('tickets');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const user = useAuthStore((state) => state.user);

  const assignedToParam = searchParams.get('assigned_to') ?? '';
  const priorityParam = parseTicketPriority(searchParams.get('priority'));
  const categoryParam = searchParams.get('category') ?? '';
  const initialStatus = parseHighlightStatus(searchParams.get('status'));
  const filterOverdue = searchParams.get('overdue') === 'true';

  const [view, setView] = useState<TicketView>('kanban');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<TicketPriority | ''>(priorityParam);
  const [agentId, setAgentId] = useState(assignedToParam === 'me' ? user?.id ?? '' : assignedToParam);
  const [category, setCategory] = useState(categoryParam);
  const [highlightStatus, setHighlightStatus] = useState<BoardStatus | ''>(initialStatus);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const debouncedSearch = useDebounce(search, 250);

  useEffect(() => {
    setAgentId(assignedToParam === 'me' ? user?.id ?? '' : assignedToParam);
  }, [assignedToParam, user?.id]);

  useEffect(() => {
    setPriority(priorityParam);
  }, [priorityParam]);

  useEffect(() => {
    setCategory(categoryParam);
  }, [categoryParam]);

  useEffect(() => {
    setHighlightStatus(initialStatus);
  }, [initialStatus]);

  const listQueryKey = ['tickets-board', debouncedSearch, priority, agentId, category, filterOverdue] as const;

  const buildBoardFilters = (): ListTicketsParams => {
    const params: ListTicketsParams = {
      sort_by: 'updated_at',
      sort_order: 'desc',
    };

    if (debouncedSearch) params.search = debouncedSearch;
    if (priority) params.priority = priority;
    if (agentId) params.assigned_to = agentId;
    if (category) params.category = category;
    if (filterOverdue) params.overdue = true;

    return params;
  };

  const { data: ticketsData, isPending } = useQuery({
    queryKey: listQueryKey,
    queryFn: () => {
      const params: ListTicketsParams = {
        ...buildBoardFilters(),
        per_page: 100,
      };

      return ticketsApi.list(params);
    },
    staleTime: 25_000,
  });

  const { data: closedTicketsData } = useQuery({
    queryKey: ['tickets-board-closed', debouncedSearch, priority, agentId, category, filterOverdue],
    queryFn: () => ticketsApi.list({
      ...buildBoardFilters(),
      status: 'closed',
      per_page: CLOSED_COLUMN_MAX_ITEMS,
    }),
    staleTime: 25_000,
  });

  useEffect(() => {
    if (!highlightStatus || view !== 'kanban' || isPending) return;
    const col = document.querySelector(`[data-status="${highlightStatus}"]`);
    col?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }, [highlightStatus, isPending, view]);

  const { data: agentsData } = useQuery({
    queryKey: ['tickets-filter-agents'],
    queryFn: () => adminApi.listUsers({ per_page: 100, status: 'active' }),
    staleTime: 60_000,
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['ticket-categories'],
    queryFn: adminApi.ticketCategories.list,
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
      void queryClient.invalidateQueries({ queryKey: ['tickets-board-closed'] });
    },
  });

  const claimMutation = useMutation({
    mutationFn: (ticketId: string) => ticketsApi.claim(ticketId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
      void queryClient.invalidateQueries({ queryKey: ['tickets-board-closed'] });
      toast.success(t('tickets.actions.claimSuccess'));
    },
    onError: (error: unknown) => {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 409) {
          toast.error(t('tickets.actions.claimErrorConflict'));
          return;
        }
        if (error.response?.status === 403) {
          toast.error(t('tickets.actions.claimErrorForbidden'));
          return;
        }
        if (error.response?.status === 404) {
          toast.error(t('tickets.actions.claimErrorNotFound'));
          return;
        }
      }
      toast.error(t('tickets.actions.claimErrorGeneric'));
    },
  });

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const unsubscribers = [
      subscribeToEvent('ticket:created', () => {
        void queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
        void queryClient.invalidateQueries({ queryKey: ['tickets-board-closed'] });
      }),
      subscribeToEvent('ticket:updated', () => {
        void queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
        void queryClient.invalidateQueries({ queryKey: ['tickets-board-closed'] });
      }),
      subscribeToEvent('ticket:deleted', () => {
        void queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
        void queryClient.invalidateQueries({ queryKey: ['tickets-board-closed'] });
      }),
      subscribeToEvent('ticket:assigned', () => {
        void queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
        void queryClient.invalidateQueries({ queryKey: ['tickets-board-closed'] });
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [queryClient]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const tickets = ticketsData?.data ?? [];
  const closedTickets = closedTicketsData?.data ?? [];
  const total = ticketsData?.meta.total ?? tickets.length;

  const categories = useMemo(
    () => (categoriesData ?? []).filter((item) => item.is_active),
    [categoriesData],
  );

  const grouped = useMemo(() => {
    const map: Record<BoardStatus, Ticket[]> = {
      queued: [],
      open: [],
      in_progress: [],
      waiting: [],
      resolved: [],
      closed: [],
    };

    tickets.forEach((ticket) => {
      if (ticket.status !== 'closed' && isBoardStatus(ticket.status)) {
        map[ticket.status].push(ticket);
      }
    });

    map.closed = closedTickets;

    return map;
  }, [closedTickets, tickets]);

  const ticketById = useMemo(() => {
    const map = new Map<string, Ticket>();
    tickets.forEach((ticket) => map.set(ticket.id, ticket));
    closedTickets.forEach((ticket) => map.set(ticket.id, ticket));
    return map;
  }, [closedTickets, tickets]);

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
    if (!canDropToStatus(targetStatus)) return;

    statusMutation.mutate({ ticketId: source.id, status: targetStatus });
  }

  async function handleExportCSV() {
    setIsExporting(true);

    try {
      const blob = await ticketsApi.exportCsv({
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(priority ? { priority } : {}),
        ...(agentId ? { assigned_to: agentId } : {}),
        ...(category ? { category } : {}),
      });

      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);

      toast.success(t('tickets.exportSuccess'));
    } catch {
      toast.error(t('tickets.exportError'));
    } finally {
      setIsExporting(false);
    }
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
                <option key={item.id} value={item.name}>{item.name}</option>
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
            <PermissionGate permission="tickets:view">
              <button type="button" className="tickets-secondary-btn" onClick={() => void handleExportCSV()} disabled={isExporting}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M6 1v7M3 5l3 3 3-3M1 9v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
                {isExporting ? t('tickets.exporting') : t('tickets.exportCsv')}
              </button>
            </PermissionGate>

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
          <div className="tickets-loading">{t('loading', { ns: 'common' })}</div>
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
                <section
                  key={column}
                  className={`tickets-column${isReadonlyStatus(column) ? ' tickets-column-readonly' : ''}`}
                  id={column}
                  data-status={column}
                  style={highlightStatus === column ? {
                    borderColor: STATUS_ACCENT[column],
                    boxShadow: `0 0 0 1px ${STATUS_ACCENT[column]}`,
                  } : undefined}
                >
                  <header className="tickets-column-head">
                    <div className="tickets-column-title-wrap">
                      <span>{statusLabel(column, t)}</span>
                      {isReadonlyStatus(column) ? (
                        <span className="tickets-column-readonly-hint" title={t('tickets.kanban.readOnly')}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                            <rect x="2.5" y="5" width="7" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M4 5V3.8a2 2 0 1 1 4 0V5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                          </svg>
                          <span>{t('tickets.kanban.readOnly')}</span>
                        </span>
                      ) : null}
                    </div>
                    <span
                      className={`tickets-column-count${isReadonlyStatus(column) ? ' tickets-column-count-muted' : ''}`}
                      style={{ color: STATUS_ACCENT[column] }}
                    >
                      {isReadonlyStatus(column)
                        ? (closedTicketsData?.meta.total ?? grouped[column].length)
                        : grouped[column].length}
                    </span>
                  </header>

                  <DroppableColumn id={column} disabled={!canDropToStatus(column)}>
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
                          isReadonlyStatus(column) ? (
                            <TicketCard
                              key={ticket.id}
                              ticket={ticket}
                              t={t}
                              now={now}
                              onClick={() => navigate(`/tickets/${ticket.id}`)}
                              onClaim={(ticketId) => claimMutation.mutate(ticketId)}
                              isClaiming={claimMutation.isPending}
                            />
                          ) : (
                            <SortableTicketCard
                              key={ticket.id}
                              ticket={ticket}
                              t={t}
                              now={now}
                              onClick={() => navigate(`/tickets/${ticket.id}`)}
                            />
                          )
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
                  <TicketCard ticket={activeTicket} t={t} now={now} onClick={() => {}} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : null}

        {!isPending && view === 'list' ? (
          <div className="tickets-list-board">
            {BOARD_COLUMNS.map((column) => (
              <section
                key={column}
                className={`tickets-list-section${isReadonlyStatus(column) ? ' tickets-column-readonly' : ''}`}
              >
                <header className="tickets-column-head">
                  <div className="tickets-column-title-wrap">
                    <span>{statusLabel(column, t)}</span>
                    {isReadonlyStatus(column) ? (
                      <span className="tickets-column-readonly-hint" title={t('tickets.kanban.readOnly')}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                          <rect x="2.5" y="5" width="7" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
                          <path d="M4 5V3.8a2 2 0 1 1 4 0V5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                        <span>{t('tickets.kanban.readOnly')}</span>
                      </span>
                    ) : null}
                  </div>
                  <span
                    className={`tickets-column-count${isReadonlyStatus(column) ? ' tickets-column-count-muted' : ''}`}
                    style={{ color: STATUS_ACCENT[column] }}
                  >
                    {isReadonlyStatus(column)
                      ? (closedTicketsData?.meta.total ?? grouped[column].length)
                      : grouped[column].length}
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
                        now={now}
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                        onClaim={(ticketId) => claimMutation.mutate(ticketId)}
                        isClaiming={claimMutation.isPending}
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
