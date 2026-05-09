import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  ticketsApi,
  type Ticket,
  type TicketPriority,
  type TicketTimelineEvent,
} from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { useAuthStore } from '../../stores/auth.store';
import { TicketComments } from '../../components/tickets/TicketComments';
import { AssignTicketModal } from '../../components/tickets/AssignTicketModal';
import ChecklistSection from '../../components/tickets/ChecklistSection';
import TimeTrackingSection from '../../components/tickets/TimeTrackingSection';
import TicketRelations from '../../components/tickets/TicketRelations';
import { SourceBadge } from '../../components/tickets/SourceBadge';
import { ContactAvatar } from '../../components/crm/ContactAvatar';
import { subscribeToEvent } from '../../services/socket';

interface Props {
  ticketId: string | null;
}

interface SbFieldProps {
  label: string;
  children: React.ReactNode;
}

function SbField({ label, children }: SbFieldProps) {
  return (
    <div className="sb-field">
      <span className="sb-label">{label}</span>
      <div className="sb-value">{children}</div>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'agora';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return (
    <span
      style={{
        width: 22,
        height: 22,
        borderRadius: '50%',
        flexShrink: 0,
        background: 'var(--bg-4)',
        border: '1px solid var(--line-2)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9,
        fontWeight: 600,
        color: 'var(--txt-2)',
      }}
    >
      {initials}
    </span>
  );
}

function PriorityIcon({ value }: { value: TicketPriority }) {
  if (value === 'low') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (value === 'medium') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M2 6h8M2 3.5h8M2 8.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (value === 'high') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 2v5M6 9.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function StatusBadgeDropdown({
  status,
  onUpdate,
}: {
  status: Ticket['status'];
  onUpdate: (data: { status: Ticket['status'] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const statuses: Array<{ value: Ticket['status']; label: string; color: string }> = [
    { value: 'open', label: 'Aberto', color: 'var(--teal)' },
    { value: 'in_progress', label: 'Em andamento', color: 'var(--amber)' },
    { value: 'waiting', label: 'Aguardando', color: 'var(--txt-2)' },
    { value: 'resolved', label: 'Resolvido', color: 'var(--green)' },
    { value: 'closed', label: 'Fechado', color: 'var(--txt-3)' },
  ];

  const current = statuses.find((item) => item.value === status) ?? statuses[0]!;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="badge-btn"
        style={{
          background: current.value === 'closed' ? 'var(--bg-4)' : 'var(--teal-dim)',
          color: current.color,
          border: `1px solid ${current.value === 'closed' ? 'var(--line-2)' : 'var(--line)'}`,
        }}
        onClick={() => setOpen((prev) => !prev)}
      >
        {current.label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div className="inline-dropdown">
          {statuses.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`inline-dropdown-item ${item.value === status ? 'active' : ''}`}
              onClick={() => {
                onUpdate({ status: item.value });
                setOpen(false);
              }}
            >
              <span className="dropdown-dot" style={{ background: item.color }} />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PriorityBadgeDropdown({
  priority,
  onUpdate,
}: {
  priority: TicketPriority;
  onUpdate: (data: { priority: TicketPriority }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const priorities: Array<{ value: TicketPriority; label: string; color: string }> = [
    { value: 'low', label: 'Baixa', color: 'var(--green)' },
    { value: 'medium', label: 'Média', color: 'var(--amber)' },
    { value: 'high', label: 'Alta', color: 'var(--red)' },
    { value: 'urgent', label: 'Urgente', color: 'var(--red)' },
  ];

  const current = priorities.find((item) => item.value === priority) ?? priorities[1]!;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="badge-btn"
        style={{
          background: current.value === 'low' ? 'var(--green-dim)' : current.value === 'medium' ? 'var(--amber-dim)' : 'var(--red-dim)',
          color: current.color,
          border: '1px solid var(--line)',
        }}
        onClick={() => setOpen((prev) => !prev)}
      >
        <PriorityIcon value={current.value} />
        {current.label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div className="inline-dropdown">
          {priorities.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`inline-dropdown-item ${item.value === priority ? 'active' : ''}`}
              onClick={() => {
                onUpdate({ priority: item.value });
                setOpen(false);
              }}
            >
              <PriorityIcon value={item.value} />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TimelineEvent({ event, showLine }: { event: TicketTimelineEvent; showLine: boolean }) {
  const { t } = useTranslation('tickets');

  const icon = (() => {
    if (event.event_type === 'created') {
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M3 4.2h8a1.4 1.4 0 0 1 1.4 1.4v1.1a1 1 0 0 0-.8 1 .98.98 0 0 0 .8.9v1.2A1.4 1.4 0 0 1 11 11.2H3A1.4 1.4 0 0 1 1.6 9.8V8.6a1 1 0 0 0 .8-.9 1 1 0 0 0-.8-1V5.6A1.4 1.4 0 0 1 3 4.2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    }
    if (event.event_type === 'status_changed') {
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M10.8 5.2 12.4 6.8l-1.6 1.6M12.2 6.8H5.3a2.7 2.7 0 0 0-2.7 2.7M3.2 8.8 1.6 7.2l1.6-1.6M1.8 7.2h6.9a2.7 2.7 0 0 0 2.7-2.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (event.event_type === 'priority_changed') {
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M7.1 2.2 3.4 7.1h2.7l-.6 4.7 5.1-5.9H7.9l.5-3.7h-1.3Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (event.event_type === 'assigned') {
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <circle cx="7" cy="4.7" r="2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2.5 11.5c0-2.1 1.8-3.4 4.5-3.4s4.5 1.3 4.5 3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    }
    if (event.event_type === 'tag_added' || event.event_type === 'tag_removed') {
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M7.8 2.2H3.5v4.3l4 4 4.3-4.3-4-4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="5.1" cy="4.9" r=".7" fill="currentColor" />
        </svg>
      );
    }
    if (event.event_type === 'comment_added') {
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M3 3.6h8a1.4 1.4 0 0 1 1.4 1.4v3.7A1.4 1.4 0 0 1 11 10.1H6.9l-2.4 1.8v-1.8H3A1.4 1.4 0 0 1 1.6 8.7V5A1.4 1.4 0 0 1 3 3.6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    }
    if (event.event_type === 'resolved') {
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" />
          <path d="m4.8 7 1.5 1.5 2.9-2.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (event.event_type === 'relation_added') {
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M4.1 5.3a2.1 2.1 0 0 1 0-3l.2-.2a2.1 2.1 0 0 1 3 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M9.9 8.7a2.1 2.1 0 0 1 0 3l-.2.2a2.1 2.1 0 0 1-3 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="m5.3 8.7 3.4-3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    }
    return <span style={{ lineHeight: 1 }}>•</span>;
  })();

  const message = (() => {
    if (event.event_type === 'created') return t('tickets.timeline.created');
    if (event.event_type === 'status_changed') {
      return t('tickets.timeline.status_changed', { old: event.old_value ?? '—', new: event.new_value ?? '—' });
    }
    if (event.event_type === 'priority_changed') {
      return t('tickets.timeline.priority_changed', { old: event.old_value ?? '—', new: event.new_value ?? '—' });
    }
    if (event.event_type === 'assigned') {
      if (event.new_value) return t('tickets.timeline.assigned', { name: event.new_value });
      return t('tickets.timeline.unassigned');
    }
    if (event.event_type === 'tag_added') return t('tickets.timeline.tag_added', { tag: event.new_value ?? '—' });
    if (event.event_type === 'tag_removed') return t('tickets.timeline.tag_removed', { tag: event.old_value ?? '—' });
    if (event.event_type === 'comment_added') return t('tickets.timeline.comment_added');
    if (event.event_type === 'resolved') return t('tickets.timeline.resolved');
    if (event.event_type === 'relation_added') {
      const meta = event.metadata as { related_title?: string };
      return `Ticket vinculado: "${meta?.related_title ?? 'Desconhecido'}"`;
    }
    return event.event_type;
  })();

  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 0', position: 'relative' }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'var(--bg-3)',
          border: '1px solid var(--line-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          flexShrink: 0,
          zIndex: 1,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt-2)' }}>{icon}</span>
      </div>
      {showLine ? (
        <div
          style={{
            position: 'absolute',
            left: 14,
            top: 32,
            bottom: -10,
            width: 1,
            background: 'var(--line)',
          }}
        />
      ) : null}
      <div style={{ flex: 1, paddingTop: 4, position: 'relative' }}>
        <div style={{ fontSize: 13, color: 'var(--txt)' }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2, fontSize: 11, color: 'var(--txt-3)' }}>
          <span style={{ fontWeight: 500 }}>{event.user_name ?? 'Sistema'}</span>
          <span style={{ fontFamily: 'var(--mono)' }}>{formatRelativeDate(event.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

export function TicketDetail({ ticketId }: Props) {
  const { t } = useTranslation('tickets');
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descValue, setDescValue] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'comments' | 'timeline'>('comments');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [editCat, setEditCat] = useState(false);
  const [catVal, setCatVal] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const { data: ticket, isPending } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => ticketsApi.get(ticketId!),
    enabled: !!ticketId,
    staleTime: 30_000,
  });

  const { data: timeline = [], isPending: timelineLoading } = useQuery({
    queryKey: ['ticket-timeline', ticketId],
    queryFn: () => ticketsApi.getTimeline(ticketId!),
    enabled: !!ticketId,
    staleTime: 10_000,
  });

  const { data: ticketTypes = [] } = useQuery({
    queryKey: ['ticket-types'],
    queryFn: adminApi.ticketTypes.list,
    staleTime: 60_000,
    enabled: !!ticketId,
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ['ticket-attachments', ticketId],
    queryFn: () => ticketsApi.listAttachments(ticketId!),
    enabled: !!ticketId,
    staleTime: 10_000,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['ticket-detail-agents'],
    queryFn: () => adminApi.listUsers({ per_page: 100, status: 'active' }),
    staleTime: 60_000,
    enabled: !!ticketId,
  });

  useEffect(() => {
    if (!ticket) return;
    setDescValue(ticket.description ?? '');
    setCatVal(ticket.category ?? '');
  }, [ticket?.id, ticket?.description, ticket?.category]);

  useEffect(() => {
    if (!ticket?.id) return;
    setEditingDescription(false);
  }, [ticket?.id]);

  useEffect(() => {
    if (!ticket?.id) return;
    localStorage.setItem(`zd_ticket_seen_${ticket.id}`, new Date().toISOString());
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
  }, [queryClient, ticket?.id]);

  useEffect(() => {
    if (!ticketId) return undefined;
    return subscribeToEvent<{ ticketId: string }>('ticket:event', (data) => {
      if (data.ticketId === ticketId) {
        void queryClient.invalidateQueries({ queryKey: ['ticket-timeline', ticketId] });
      }
    });
  }, [queryClient, ticketId]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setShowMore(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!ticket?.id) return undefined;
    const unsub = subscribeToEvent<{
      ticketId: string;
      authorId?: string;
      authorName?: string | null;
      isInternal?: boolean;
      comment?: { ticket_id?: string; user_id?: string | null; author_name?: string | null; is_internal?: boolean };
    }>('ticket:comment_added', (data) => {
      const receivedTicketId = data.ticketId ?? data.comment?.ticket_id;
      if (receivedTicketId !== ticket.id) return;
      const authorId = data.authorId ?? data.comment?.user_id ?? null;
      if (authorId === user?.id) return;
      void queryClient.invalidateQueries({ queryKey: ['ticket-comments', ticket.id] });
      const isInternal = data.isInternal ?? data.comment?.is_internal ?? false;
      if (!isInternal) {
        const author = data.authorName ?? data.comment?.author_name ?? 'agente';
        toast.info(`Novo comentário de ${author}`);
      }
    });
    return unsub;
  }, [ticket?.id, queryClient, toast, user?.id]);

  useEffect(() => {
    if (!ticketId) return undefined;
    return subscribeToEvent<{ ticketId: string }>('ticket:deleted', (data) => {
      if (data.ticketId !== ticketId) return;
      toast.info('Este ticket foi excluído');
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate('/tickets');
    });
  }, [navigate, queryClient, ticketId, toast]);

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof ticketsApi.update>[1]) => ticketsApi.update(ticketId!, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['ticket', ticketId], updated);
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: () => toast.error('Erro ao atualizar ticket'),
  });

  const uploadAttachmentMutation = useMutation({
    mutationFn: (file: File) => ticketsApi.uploadAttachment(ticketId!, file),
    onSuccess: async () => {
      setAttachmentFile(null);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
      await queryClient.invalidateQueries({ queryKey: ['ticket-attachments', ticketId] });
      toast.success('Anexo enviado');
    },
    onError: () => toast.error('Erro ao enviar anexo'),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) => ticketsApi.deleteAttachment(attachmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ticket-attachments', ticketId] });
      toast.success('Anexo excluído');
    },
    onError: () => toast.error('Você não pode excluir este anexo'),
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      if (!ticket) throw new Error('Ticket não encontrado');
      const payload: import('../../services/api').CreateTicketPayload = {
        title: `[Cópia] ${ticket.title}`,
        priority: ticket.priority,
        tags: ticket.tags,
      };
      if (ticket.description) payload.description = ticket.description;
      if (ticket.type_id) payload.type_id = ticket.type_id;
      if (ticket.contact_id) payload.contact_id = ticket.contact_id;
      if (ticket.organization_id) payload.organization_id = ticket.organization_id;
      if (ticket.category) payload.category = ticket.category;
      return ticketsApi.create(payload);
    },
    onSuccess: (created) => {
      toast.success('Ticket duplicado');
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/tickets/${created.id}`);
    },
    onError: () => toast.error('Erro ao duplicar ticket'),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!ticket) throw new Error('Ticket não encontrado');
      await ticketsApi.delete(ticket.id);
    },
    onSuccess: () => {
      toast.success('Ticket excluído');
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-stats'] });
      navigate('/tickets');
    },
    onError: () => toast.error('Erro ao excluir ticket'),
  });

  if (!ticketId) {
    return (
      <div className="zd-empty-state">
        <div className="zd-empty-icon" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="3.5" y="4" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M7 8h8M7 11h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </div>
        <p style={{ color: 'var(--txt-2)', fontSize: 13, margin: 0 }}>{t('tickets.noSelection')}</p>
      </div>
    );
  }

  if (isPending) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--txt-3)', fontSize: 13 }}>Carregando...</p>
      </div>
    );
  }

  if (!ticket) return null;

  const isResolved = ticket.status === 'resolved' || ticket.status === 'closed';
  const ticketContactName = ticket.contact_name ?? ticket.client_name;
  const tags = ticket.tags ?? [];
  const currentType = ticketTypes.find((item) => item.id === ticket.type_id);
  const activeTypeRules = {
    requireDueDateForUrgent: currentType?.require_due_date_for_urgent ?? true,
    requireCategoryForWaiting: currentType?.require_category_for_waiting ?? true,
  };
  const isOverdue = Boolean(
    ticket.due_date
    && new Date(ticket.due_date) < new Date()
    && ticket.status !== 'resolved'
    && ticket.status !== 'closed',
  );

  const updateTicket = (patch: Parameters<typeof ticketsApi.update>[1], successMessage?: string) => {
    updateMutation.mutate(patch);
    if (successMessage) toast.success(successMessage);
  };

  const updateTicketWithRules = (patch: Parameters<typeof ticketsApi.update>[1], successMessage?: string): boolean => {
    const hasTypeChange = Object.prototype.hasOwnProperty.call(patch, 'type_id');
    const hasDueDateChange = Object.prototype.hasOwnProperty.call(patch, 'due_date');
    const hasCategoryChange = Object.prototype.hasOwnProperty.call(patch, 'category');
    const nextTypeId = hasTypeChange
      ? (patch.type_id ?? null)
      : (ticket.type_id ?? null);

    const nextType = ticketTypes.find((item) => item.id === nextTypeId);
    const rules = {
      requireDueDateForUrgent: nextType?.require_due_date_for_urgent ?? true,
      requireCategoryForWaiting: nextType?.require_category_for_waiting ?? true,
    };

    const nextPriority = patch.priority ?? ticket.priority;
    const nextStatus = patch.status ?? ticket.status;
    const nextDueDate = hasDueDateChange ? (patch.due_date ?? null) : (ticket.due_date ?? null);
    const nextCategoryRaw = hasCategoryChange ? (patch.category ?? '') : (ticket.category ?? '');
    const nextCategory = nextCategoryRaw.trim();

    if (rules.requireDueDateForUrgent && nextPriority === 'urgent' && !nextDueDate) {
      toast.error('Prazo é obrigatório para prioridade urgente neste tipo de ticket');
      return false;
    }

    if (rules.requireCategoryForWaiting && nextStatus === 'waiting' && !nextCategory) {
      toast.error('Categoria é obrigatória quando o status é "Aguardando" neste tipo de ticket');
      return false;
    }

    updateTicket(patch, successMessage);
    return true;
  };

  function handleTitleSave() {
    if (!ticket) return;
    if (titleDraft.trim().length >= 3 && titleDraft.trim() !== ticket.title) {
      updateTicket({ title: titleDraft.trim() }, t('tickets.form.updated'));
    }
    setEditingTitle(false);
  }

  function formatAttachmentSize(bytes: number | null): string {
    if (!bytes || bytes <= 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleAttachmentDownload(attachmentId: string, fileName: string) {
    try {
      const blob = await ticketsApi.downloadAttachment(attachmentId);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast.error('Erro ao baixar anexo');
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--bg-2)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleTitleSave();
                if (event.key === 'Escape') setEditingTitle(false);
              }}
              style={{
                flex: 1,
                fontSize: 16,
                fontWeight: 600,
                background: 'var(--bg-3)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r)',
                padding: '4px 8px',
                color: 'var(--txt)',
                outline: 'none',
                fontFamily: 'var(--font)',
                boxShadow: '0 0 0 3px var(--teal-dim)',
              }}
            />
          ) : (
            <h2
              onClick={() => {
                setTitleDraft(ticket.title);
                setEditingTitle(true);
              }}
              style={{
                flex: 1,
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--txt)',
                cursor: 'text',
                lineHeight: 1.4,
              }}
              title="Clique para editar"
            >
              {ticket.title}
            </h2>
          )}

          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
            <div style={{ position: 'relative' }} ref={moreRef}>
              <button
                type="button"
                className="tb-icon-btn"
                onClick={() => setShowMore((prev) => !prev)}
                title="Mais ações"
                aria-label="Mais ações"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <circle cx="8" cy="4" r="1.2" fill="currentColor" />
                  <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                  <circle cx="8" cy="12" r="1.2" fill="currentColor" />
                </svg>
              </button>

              {showMore ? (
                <div className="more-menu">
                  <button
                    type="button"
                    className="more-menu-item"
                    disabled={duplicateMutation.isPending}
                    onClick={() => {
                      setShowMore(false);
                      duplicateMutation.mutate();
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                      <rect x="1" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M4 4V2.5A1.5 1.5 0 0 1 5.5 1h5A1.5 1.5 0 0 1 12 2.5v5A1.5 1.5 0 0 1 10.5 9H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    Duplicar ticket
                  </button>

                  {(user?.role === 'owner' || user?.role === 'admin') ? (
                    <>
                      <div className="more-menu-divider" />
                      <button
                        type="button"
                        className="more-menu-item danger"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          setShowMore(false);
                          const confirmed = window.confirm('Excluir permanentemente este ticket? Esta ação não pode ser desfeita.');
                          if (confirmed) deleteMutation.mutate();
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                          <path d="M2 3.5h9M5 3.5V2h3v1.5M10.5 3.5L10 11H3L2.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M5.5 6v3M7.5 6v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                        Excluir permanentemente
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            <button type="button" onClick={() => setAssignOpen(true)} className="zd-btn">
              {t('tickets.actions.assign')}
            </button>

            {ticket.assigned_to !== user?.id ? (
              <button
                type="button"
                className="zd-btn"
                onClick={() => {
                  if (user?.id) updateTicket({ assigned_to: user.id }, t('tickets.form.assigned'));
                }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                  <circle cx="6.5" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M1.5 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                A mim
              </button>
            ) : null}

            {!isResolved ? (
              <button
                type="button"
                onClick={() => updateTicketWithRules({ status: 'resolved' }, t('tickets.form.resolved'))}
                className="zd-btn"
                style={{ borderColor: 'var(--green)', background: 'var(--green-dim)', color: 'var(--green)' }}
              >
                {t('tickets.actions.resolve')}
              </button>
            ) : null}

            {ticket.status !== 'closed' ? (
              <button
                type="button"
                onClick={() => updateTicketWithRules({ status: 'closed' }, t('tickets.form.closed'))}
                className="zd-btn"
              >
                {t('tickets.actions.close')}
              </button>
            ) : null}

            {isResolved ? (
              <button
                type="button"
                onClick={() => updateTicketWithRules({ status: 'open' }, t('tickets.form.updated'))}
                className="zd-btn"
                style={{ borderColor: 'var(--teal)', background: 'var(--teal-dim)', color: 'var(--teal)' }}
              >
                {t('tickets.actions.reopen')}
              </button>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusBadgeDropdown
            status={ticket.status}
            onUpdate={(data) => updateTicketWithRules({ status: data.status }, t('tickets.form.updated'))}
          />

          <PriorityBadgeDropdown
            priority={ticket.priority}
            onUpdate={(data) => updateTicketWithRules({ priority: data.priority }, t('tickets.form.updated'))}
          />

          {ticket.type_name && ticket.type_color ? (
            <span
              className="ticket-type-badge"
              style={{
                background: `${ticket.type_color}22`,
                color: ticket.type_color,
                borderColor: `${ticket.type_color}44`,
              }}
            >
              {ticket.type_name}
            </span>
          ) : null}

          <SourceBadge source={ticket.source ?? 'manual'} />

          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-3)', marginLeft: 4 }}>
            #{ticket.id.slice(-6).toUpperCase()}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <div
          style={{
            width: 280,
            flexShrink: 0,
            borderRight: '1px solid var(--line)',
            padding: '14px 12px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-2)',
          }}
        >
          <SbField label={t('tickets.fields.type', { defaultValue: 'Tipo' })}>
            <select
              aria-label="Tipo do ticket"
              className="sb-select"
              value={ticket.type_id ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                updateTicketWithRules(value ? { type_id: value } : { type_id: null }, t('tickets.form.updated'));
              }}
            >
              <option value="">{t('tickets.form.selectType', { defaultValue: 'Selecione o tipo' })}</option>
              {ticketTypes.filter((item) => item.is_active).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--txt-3)' }}>
                Urgente exige prazo: {activeTypeRules.requireDueDateForUrgent ? 'Sim' : 'Não'}
              </span>
              <span style={{ fontSize: 10, color: 'var(--txt-3)' }}>
                Aguardando exige categoria: {activeTypeRules.requireCategoryForWaiting ? 'Sim' : 'Não'}
              </span>
            </div>
          </SbField>

          <SbField label="ATRIBUÍDO A">
            <select
              className="sb-select"
              value={ticket.assigned_to ?? ''}
              onChange={(event) => {
                const nextAssignee = event.target.value;
                updateTicket(
                  { assigned_to: nextAssignee || null },
                  nextAssignee ? t('tickets.form.assigned') : 'Ticket desatribuído',
                );
              }}
            >
              <option value="">Sem atribuição</option>
              {(agentsData?.data ?? []).map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            {ticket.assignee_name ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <Avatar name={ticket.assignee_name} />
                <span style={{ fontSize: 12, color: 'var(--txt)' }}>{ticket.assignee_name}</span>
              </span>
            ) : null}
          </SbField>

          <SbField label={t('tickets.fields.client')}>
            {ticketContactName && ticket.contact_id ? (
              <Link to={`/crm/contacts/${ticket.contact_id}?id=${ticket.contact_id}`} style={{ textDecoration: 'none' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 8px',
                    borderRadius: 'var(--r-pill)',
                    border: '1px solid var(--line)',
                    background: 'var(--bg-3)',
                    color: 'var(--teal)',
                  }}
                >
                  <ContactAvatar id={ticket.contact_id} name={ticketContactName} size={20} />
                  {ticketContactName}
                </span>
              </Link>
            ) : ticketContactName ? (
              <span style={{ color: 'var(--teal)' }}>{ticketContactName}</span>
            ) : (
              <span className="sb-empty">{t('tickets.fields.noClient')}</span>
            )}
          </SbField>

          <SbField label={t('tickets.organization', { defaultValue: 'Organização' })}>
            {ticket.organization_name && ticket.organization_id ? (
              <Link to={`/crm/organizations/${ticket.organization_id}?id=${ticket.organization_id}`} style={{ textDecoration: 'none' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 8px',
                    borderRadius: 'var(--r-pill)',
                    border: '1px solid var(--line)',
                    background: 'var(--bg-3)',
                    color: 'var(--txt)',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <rect x="1.5" y="3.2" width="9" height="7.3" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
                    <path d="M4.5 3.2V2.4a.9.9 0 0 1 .9-.9h1.2a.9.9 0 0 1 .9.9v.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                  </svg>
                  {ticket.organization_name}
                </span>
              </Link>
            ) : ticket.organization_name ? (
              <span>{ticket.organization_name}</span>
            ) : (
              <span className="sb-empty">{t('tickets.fields.noOrganization', { defaultValue: 'Não vinculada' })}</span>
            )}
          </SbField>

          <SbField label="PRAZO">
            <input
              type="date"
              className={`sb-date ${isOverdue ? 'overdue' : ''}`}
              value={ticket.due_date ? new Date(ticket.due_date).toISOString().split('T')[0] ?? '' : ''}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) {
                  return;
                }
                updateTicketWithRules({ due_date: `${value}T00:00:00.000Z` }, t('tickets.form.updated'));
              }}
            />
            {isOverdue ? (
              <div className="overdue-tag">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M5.5 3v3M5.5 8v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                Prazo vencido
              </div>
            ) : null}
          </SbField>

          <SbField label="CATEGORIA">
            {editCat ? (
              <input
                autoFocus
                value={catVal}
                onChange={(event) => setCatVal(event.target.value)}
                onBlur={() => {
                  if (updateTicketWithRules({ category: catVal || '' }, t('tickets.form.updated'))) {
                    setEditCat(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    if (updateTicketWithRules({ category: catVal || '' }, t('tickets.form.updated'))) {
                      setEditCat(false);
                    }
                  }
                  if (event.key === 'Escape') {
                    setCatVal(ticket.category ?? '');
                    setEditCat(false);
                  }
                }}
                className="sb-inline-input"
                placeholder="Ex: Infraestrutura"
              />
            ) : (
              <button type="button" className="sb-editable" onClick={() => setEditCat(true)}>
                {ticket.category ?? <span className="sb-empty">+ Adicionar</span>}
              </button>
            )}
          </SbField>

          <SbField label="TAGS">
            <div className="sb-tags">
              {tags.map((tag) => (
                <span key={tag} className="sb-tag">
                  {tag}
                  <button
                    type="button"
                    onClick={() => updateTicket({ tags: tags.filter((item) => item !== tag) }, t('tickets.form.updated'))}
                    aria-label={`Remover tag ${tag}`}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              ))}

              {showTagInput ? (
                <input
                  autoFocus
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && tagInput.trim()) {
                      if (!tags.includes(tagInput.trim())) {
                        updateTicket({ tags: [...tags, tagInput.trim()] }, t('tickets.form.updated'));
                      }
                      setTagInput('');
                      setShowTagInput(false);
                    }
                    if (event.key === 'Escape') {
                      setTagInput('');
                      setShowTagInput(false);
                    }
                  }}
                  onBlur={() => {
                    setTagInput('');
                    setShowTagInput(false);
                  }}
                  className="sb-tag-input"
                  placeholder="Nova tag"
                />
              ) : (
                <button type="button" className="sb-add-tag" onClick={() => setShowTagInput(true)}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  Tag
                </button>
              )}
            </div>
          </SbField>

          <SbField label="ORIGEM">
            <SourceBadge source={ticket.source ?? 'manual'} />
          </SbField>

          <div style={{ marginTop: 'auto' }}>
            <SbField label={t('tickets.fields.createdAt')}>
              <span className="sb-mono">{formatDate(ticket.created_at)}</span>
            </SbField>
            <SbField label={t('tickets.fields.updatedAt')}>
              <span className="sb-mono">{formatDate(ticket.updated_at)}</span>
            </SbField>
            <SbField label="RESOLVIDO EM">
              <span className="sb-mono">
                {ticket.resolved_at
                  ? new Date(ticket.resolved_at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  : '—'}
              </span>
            </SbField>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ticket-description-section">
            <div className="detail-section-head" style={{ marginBottom: 0 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--txt-3)',
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                }}
              >
                Descrição do ticket
              </span>
              {!editingDescription ? (
                <button
                  type="button"
                  className="tb-icon-btn"
                  onClick={() => setEditingDescription(true)}
                  title="Editar descrição"
                  aria-label="Editar descrição"
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                    <path d="M9.5 1.5L11.5 3.5 4.5 10.5H2.5V8.5L9.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : null}
            </div>

            {editingDescription ? (
              <div className="description-edit">
                <textarea
                  autoFocus
                  value={descValue}
                  onChange={(event) => setDescValue(event.target.value)}
                  className="description-edit-textarea"
                  rows={8}
                  placeholder="Detalhe o problema, impacto ou solução esperada"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setDescValue(ticket.description ?? '');
                      setEditingDescription(false);
                    }
                  }}
                />
                <div className="description-edit-footer">
                  <span className="description-hint">Pressione Esc para cancelar</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="zd-btn"
                      onClick={() => {
                        setDescValue(ticket.description ?? '');
                        setEditingDescription(false);
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="zd-btn zd-btn-primary"
                      onClick={() => {
                        updateTicket({ description: descValue || '' }, t('tickets.form.updated'));
                        setEditingDescription(false);
                      }}
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="description-display"
                onClick={() => setEditingDescription(true)}
                title="Clique para editar"
              >
                {ticket.description ? (
                  <p className="description-body">{ticket.description}</p>
                ) : (
                  <p className="description-placeholder">Clique para adicionar a descrição do ticket</p>
                )}
              </div>
            )}
          </div>

          <div>
            <h4
              style={{
                margin: '0 0 8px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--txt-3)',
                textTransform: 'uppercase',
                letterSpacing: 0.08,
              }}
            >
              Anexos
            </h4>

            <div className="ticket-attachments-toolbar">
              <input
                ref={attachmentInputRef}
                type="file"
                className="ticket-file-input"
                onChange={(event) => setAttachmentFile(event.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="zd-btn"
                onClick={() => attachmentInputRef.current?.click()}
              >
                Escolher arquivo
              </button>
              <span className="ticket-file-name" title={attachmentFile?.name ?? 'Nenhum arquivo selecionado'}>
                {attachmentFile?.name ?? 'Nenhum arquivo selecionado'}
              </span>
              <button
                type="button"
                className="zd-btn"
                disabled={!attachmentFile || uploadAttachmentMutation.isPending}
                onClick={() => {
                  if (attachmentFile) uploadAttachmentMutation.mutate(attachmentFile);
                }}
              >
                {uploadAttachmentMutation.isPending ? 'Enviando...' : 'Enviar anexo'}
              </button>
            </div>

            {attachments.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--txt-3)' }}>Sem anexos neste ticket.</p>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r)',
                      background: 'var(--bg-3)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => void handleAttachmentDownload(attachment.id, attachment.filename)}
                      style={{
                        color: 'var(--teal)',
                        fontSize: 12,
                        textDecoration: 'none',
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        fontFamily: 'var(--font)',
                      }}
                    >
                      {attachment.filename}
                    </button>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
                      {formatAttachmentSize(attachment.file_size)}
                    </span>
                    {attachment.user_id === user?.id ? (
                      <button
                        type="button"
                        onClick={() => deleteAttachmentMutation.mutate(attachment.id)}
                        style={{
                          border: 'none',
                          background: 'none',
                          color: 'var(--red)',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontFamily: 'var(--font)',
                        }}
                      >
                        Excluir
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <ChecklistSection ticketId={ticket.id} />
          <TimeTrackingSection ticketId={ticket.id} />
          <TicketRelations ticketId={ticket.id} />

          <div>
            <div style={{ display: 'flex', gap: 10, borderBottom: '1px solid var(--line)', marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setActiveTab('comments')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  color: activeTab === 'comments' ? 'var(--teal)' : 'var(--txt-3)',
                  borderBottom: activeTab === 'comments' ? '2px solid var(--teal)' : '2px solid transparent',
                  marginBottom: -1,
                  padding: '8px 0',
                }}
              >
                {t('tickets.comments.updates', { defaultValue: 'Atualizações' })}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('timeline')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  color: activeTab === 'timeline' ? 'var(--teal)' : 'var(--txt-3)',
                  borderBottom: activeTab === 'timeline' ? '2px solid var(--teal)' : '2px solid transparent',
                  marginBottom: -1,
                  padding: '8px 0',
                }}
              >
                {t('tickets.timeline.title')}
              </button>
            </div>

            {activeTab === 'comments' ? (
              <TicketComments ticketId={ticket.id} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0' }}>
                {timelineLoading ? (
                  <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>Carregando...</div>
                ) : timeline.length === 0 ? (
                  <div className="zd-empty-state" style={{ minHeight: 180 }}>
                    <div className="zd-empty-icon" aria-hidden>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M3.5 10h13M10 3.5v13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div style={{ color: 'var(--txt-2)', fontSize: 12, fontWeight: 500 }}>Sem eventos no histórico</div>
                  </div>
                ) : (
                  timeline.map((event, index) => (
                    <TimelineEvent key={event.id} event={event} showLine={index < timeline.length - 1} />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <AssignTicketModal ticketId={assignOpen ? ticket.id : null} onClose={() => setAssignOpen(false)} />
    </div>
  );
}

