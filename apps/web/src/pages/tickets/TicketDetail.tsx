import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import type { TFunction } from 'i18next';
import {
  adminApi,
  ticketsApi,
  type CreateTicketPayload,
  type TicketAttachment,
  type TicketPriority,
  type TicketStatus,
  type TicketTimelineEvent,
} from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { useToast } from '../../stores/toast.store';
import { useDebounce } from '../../hooks/useDebounce';
import { PageShell } from '../../components/layout/PageShell';
import { ContactAvatar } from '../../components/crm/ContactAvatar';
import { SourceBadge } from '../../components/tickets/SourceBadge';
import ChecklistSection from '../../components/tickets/ChecklistSection';
import TimeTrackingSection from '../../components/tickets/TimeTrackingSection';
import { TicketComments } from '../../components/tickets/TicketComments';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { getSlaBg, getSlaColor, getSlaInfo, type SlaInfo } from '../../utils/sla';

const TICKET_STATUS_TRANSITIONS: Record<string, string[]> = {
  open:        ['in_progress', 'waiting'],
  in_progress: ['open', 'waiting', 'resolved'],
  waiting:     ['open', 'in_progress'],
  resolved:    ['open', 'in_progress', 'closed'],
  closed:      ['open'],
};

type DetailTab = 'comments' | 'history';

function useAppTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
  ));

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const nextTheme = document.documentElement.getAttribute('data-theme');
      setTheme(nextTheme === 'light' ? 'light' : 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function sanitizeTicketTitle(value: string): string {
  return value
    .replace(/[`*_~>#\[\]\(\)!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMonoDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTicketNumber(n: number): string {
  return `#${String(n).padStart(5, '0')}`;
}

function statusLabel(status: TicketStatus, t: (key: string) => string): string {
  if (status === 'open') return t('tickets.kanban.open');
  if (status === 'in_progress') return t('tickets.kanban.inProgress');
  if (status === 'waiting') return t('tickets.kanban.waiting');
  if (status === 'resolved') return t('tickets.kanban.resolved');
  return t('tickets.status.closed');
}

function priorityLabel(priority: TicketPriority, t: (key: string) => string): string {
  if (priority === 'urgent') return t('tickets.priority.urgent');
  if (priority === 'high') return t('tickets.priority.high');
  if (priority === 'medium') return t('tickets.priority.medium');
  return t('tickets.priority.low');
}

function priorityColor(priority: TicketPriority): string {
  if (priority === 'urgent') return '#EF4444';
  if (priority === 'high') return '#F59E0B';
  if (priority === 'medium') return '#8B5CF6';
  return 'var(--txt-2)';
}

function dueTone(value: string | null): 'normal' | 'near' | 'overdue' {
  if (!value) return 'normal';

  const due = new Date(value);
  const now = new Date();
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor((dueStart - nowStart) / (24 * 60 * 60 * 1000));

  if (diffDays < 0) return 'overdue';
  if (diffDays <= 3) return 'near';
  return 'normal';
}

function getSlaLabel(sla: SlaInfo, t: TFunction<'tickets'>): string | null {
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

function AuthedImage({ src, alt }: { src: string; alt: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!token) return;
    let revoke: string | null = null;
    fetch(src, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        revoke = url;
        setObjectUrl(url);
      })
      .catch(() => {});
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [src, token]);

  if (!objectUrl) return null;
  return <img src={objectUrl} alt={alt} />;
}

function AttachmentCard({
  attachment,
  canDelete,
  onDelete,
}: {
  attachment: TicketAttachment;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const isImage = (attachment.mime_type ?? '').startsWith('image/');

  return (
    <div className="ticket-attachment-item">
      {isImage ? (
        <a href={attachment.file_url} target="_blank" rel="noreferrer" className="ticket-attachment-thumb">
          <AuthedImage src={attachment.file_url} alt={attachment.filename} />
        </a>
      ) : (
        <a href={attachment.file_url} target="_blank" rel="noreferrer" className="ticket-attachment-file">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <path d="M4 2.5h6l4 4v9A1.5 1.5 0 0 1 12.5 17h-8A1.5 1.5 0 0 1 3 15.5v-11A2 2 0 0 1 4 2.5Z" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10 2.5v4h4" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </a>
      )}

      <div className="ticket-attachment-meta">
        <span title={attachment.filename}>{attachment.filename}</span>
        {canDelete ? (
          <button type="button" onClick={onDelete}>
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TicketDetailPage() {
  const { t } = useTranslation('tickets');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const user = useAuthStore((state) => state.user);
  const appTheme = useAppTheme();

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [activeTab, setActiveTab] = useState<DetailTab>('comments');

  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);

  const [sidebarTypeId, setSidebarTypeId] = useState('');
  const [sidebarAssignedTo, setSidebarAssignedTo] = useState('');
  const [sidebarDueDate, setSidebarDueDate] = useState('');
  const [sidebarCategory, setSidebarCategory] = useState('');
  const [sidebarTagInput, setSidebarTagInput] = useState('');
  const [sidebarTags, setSidebarTags] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [showWaitingModal, setShowWaitingModal] = useState(false);
  const [waitingReason, setWaitingReason] = useState<'customer' | 'internal' | 'third_party' | ''>('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [pendingPatch, setPendingPatch] = useState<Partial<CreateTicketPayload>>({});
  const debouncedPatch = useDebounce(pendingPatch, 500);

  const statusRef = useRef<HTMLDivElement | null>(null);
  const priorityRef = useRef<HTMLDivElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const { data: ticket, isPending } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => ticketsApi.get(id ?? ''),
    enabled: Boolean(id),
    staleTime: 20_000,
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ['ticket-timeline', id],
    queryFn: () => ticketsApi.getTimeline(id ?? ''),
    enabled: Boolean(id),
    staleTime: 15_000,
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ['ticket-attachments', id],
    queryFn: () => ticketsApi.listAttachments(id ?? ''),
    enabled: Boolean(id),
    staleTime: 15_000,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['ticket-detail-agents-v2'],
    queryFn: () => adminApi.listUsers({ per_page: 100, status: 'active' }),
    staleTime: 60_000,
  });

  const { data: ticketTypes = [] } = useQuery({
    queryKey: ['ticket-types'],
    queryFn: adminApi.ticketTypes.list,
    staleTime: 60_000,
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['ticket-categories-options'],
    queryFn: () => ticketsApi.list({ per_page: 100, sort_by: 'updated_at', sort_order: 'desc' }),
    staleTime: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: (patch: Partial<CreateTicketPayload>) => ticketsApi.update(id ?? '', patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['ticket', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-timeline', id] });
    },
    onError: () => {
      toast.error(t('tickets.errorUpdate'));
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => ticketsApi.uploadAttachment(id ?? '', file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ticket-attachments', id] });
      toast.success(t('tickets.attachmentUploaded'));
    },
    onError: () => {
      toast.error(t('tickets.errorAttachmentUpload'));
    },
  });

  const removeAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) => ticketsApi.deleteAttachment(attachmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ticket-attachments', id] });
    },
  });

  const deleteTicketMutation = useMutation({
    mutationFn: () => ticketsApi.delete(id ?? ''),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tickets'] });
      await queryClient.invalidateQueries({ queryKey: ['tickets-board'] });
      await queryClient.invalidateQueries({ queryKey: ['tickets-board-closed'] });
      toast.success(t('tickets.deleteSuccess'));
      navigate('/tickets');
    },
    onError: () => {
      toast.error(t('tickets.errorUpdate'));
    },
  });

  useEffect(() => {
    if (!ticket) return;

    setTitleDraft(sanitizeTicketTitle(ticket.title));
    setDescriptionDraft(ticket.description ?? '');
    setSidebarTypeId(ticket.type_id ?? '');
    setSidebarAssignedTo(ticket.assigned_to ?? '');
    setSidebarDueDate(ticket.due_date ? new Date(ticket.due_date).toISOString().slice(0, 10) : '');
    setSidebarCategory(ticket.category ?? '');
    setSidebarTags(ticket.tags ?? []);
  }, [ticket]);

  useEffect(() => {
    if (!titleEditing || !titleInputRef.current) return;
    titleInputRef.current.focus();
    titleInputRef.current.select();
  }, [titleEditing]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(event.target as Node)) {
        setStatusMenuOpen(false);
      }

      if (priorityRef.current && !priorityRef.current.contains(event.target as Node)) {
        setPriorityMenuOpen(false);
      }

      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setActionsMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!ticket) return;
    if (!debouncedPatch || Object.keys(debouncedPatch).length === 0) return;

    updateMutation.mutate(debouncedPatch);
    setPendingPatch({});
  }, [debouncedPatch, ticket, updateMutation]);

  const truncatedTitle = useMemo(() => {
    if (!ticket) return '';
    const title = sanitizeTicketTitle(ticket.title);
    if (title.length <= 42) return title;
    return `${title.slice(0, 39)}...`;
  }, [ticket]);

  const categoryOptions = useMemo(() => {
    const values = new Set<string>();
    (categoriesData?.data ?? []).forEach((item) => {
      if (item.category) values.add(item.category);
    });
    if (sidebarCategory) values.add(sidebarCategory);
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [categoriesData?.data, sidebarCategory]);

  function queuePatch(patch: Partial<CreateTicketPayload>) {
    setPendingPatch((prev) => ({ ...prev, ...patch }));
  }

  function patchStatus(status: TicketStatus) {
    updateMutation.mutate({ status });
  }

  function patchPriority(priority: TicketPriority) {
    updateMutation.mutate({ priority });
  }

  function saveTitle() {
    if (!ticket) return;

    const sanitized = sanitizeTicketTitle(titleDraft);
    if (!sanitized) {
      setTitleDraft(sanitizeTicketTitle(ticket.title));
      setTitleEditing(false);
      return;
    }

    if (sanitized !== ticket.title) {
      updateMutation.mutate({ title: sanitized });
    }

    setTitleEditing(false);
  }

  function saveDescription() {
    if (!ticket) return;

    if ((ticket.description ?? '') !== descriptionDraft) {
      updateMutation.mutate({ description: descriptionDraft });
    }

    setDescriptionEditing(false);
  }

  function updateTags(nextTags: string[]) {
    setSidebarTags(nextTags);
    queuePatch({ tags: nextTags });
  }

  function addTagsFromInput(rawInput: string) {
    const values = rawInput
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (values.length === 0) {
      setSidebarTagInput('');
      return;
    }

    const unique = values.filter((value) => !sidebarTags.includes(value));
    if (unique.length > 0) {
      updateTags([...sidebarTags, ...unique]);
    }

    setSidebarTagInput('');
  }

  async function handleDelete() {
    await deleteTicketMutation.mutateAsync();
    setShowDeleteConfirm(false);
  }

  if (!id) {
    return <Navigate to="/tickets" replace />;
  }

  if (isPending || !ticket) {
    return (
      <PageShell>
        <div className="ticket-detail-loading">{t('common.loading', { ns: 'admin', defaultValue: 'Carregando...' })}</div>
      </PageShell>
    );
  }

  const currentTitle = sanitizeTicketTitle(ticket.title) || ticket.title;
  const dueState = dueTone(ticket.due_date ?? null);
  const sla = getSlaInfo(ticket.due_date, ticket.status, now);
  const slaLabel = getSlaLabel(sla, t);
  const dueDateFormatted = ticket.due_date
    ? new Date(ticket.due_date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;
  const slaProgress = (() => {
    if (!ticket.due_date || !ticket.created_at || sla.status === 'none') return null;
    const total = new Date(ticket.due_date).getTime() - new Date(ticket.created_at).getTime();
    if (!Number.isFinite(total) || total <= 0) return null;
    const elapsed = now.getTime() - new Date(ticket.created_at).getTime();
    const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
    return pct;
  })();
  const timelineMessage = (event: TicketTimelineEvent): string => {
    if (event.event_type === 'created') return t('tickets.timeline.created');
    if (event.event_type === 'status_changed') {
      return t('tickets.timeline.status_changed', {
        old: event.old_value ?? '—',
        new: event.new_value ?? '—',
      });
    }
    if (event.event_type === 'priority_changed') {
      return t('tickets.timeline.priority_changed', {
        old: event.old_value ?? '—',
        new: event.new_value ?? '—',
      });
    }
    if (event.event_type === 'assigned') {
      return event.new_value
        ? t('tickets.timeline.assigned', { name: event.new_value })
        : t('tickets.timeline.unassigned');
    }
    if (event.event_type === 'comment_added') return t('tickets.timeline.comment_added');
    if (event.event_type === 'resolved') return t('tickets.timeline.resolved');
    if (event.event_type === 'tag_added') {
      return t('tickets.timeline.tag_added', { tag: event.new_value ?? '—' });
    }
    if (event.event_type === 'tag_removed') {
      return t('tickets.timeline.tag_removed', { tag: event.old_value ?? '—' });
    }
    return event.event_type;
  };

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <section className="ticket-detail-v2-page">
        <header className="ticket-detail-v2-topbar">
          <div className="ticket-detail-v2-topbar-left">
            <button type="button" className="ticket-back-btn" onClick={() => navigate('/tickets')}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M9.5 2.5 4.5 7l5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('tickets.detail.backToList')}
            </button>

            <div className="ticket-detail-v2-breadcrumb">
              <span>{t('tickets.title')}</span>
              <span>/</span>
              <strong>{formatTicketNumber(ticket.ticket_number)} - {truncatedTitle}</strong>
            </div>
          </div>

          <div className="ticket-detail-v2-topbar-right">
            <div className="ticket-dropdown-wrap" ref={statusRef}>
              <button type="button" className="ticket-inline-badge" onClick={() => setStatusMenuOpen((v) => !v)}>
                {statusLabel(ticket.status, t)}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>

              {statusMenuOpen ? (
                <div className="ticket-inline-menu">
                  {(TICKET_STATUS_TRANSITIONS[ticket.status] ?? []).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => {
                        if (status === 'waiting') {
                          setWaitingReason('');
                          setShowWaitingModal(true);
                          setStatusMenuOpen(false);
                          return;
                        }

                        patchStatus(status as TicketStatus);
                        setStatusMenuOpen(false);
                      }}
                    >
                      {statusLabel(status as TicketStatus, t)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="ticket-dropdown-wrap" ref={priorityRef}>
              <button
                type="button"
                className="ticket-inline-badge"
                onClick={() => setPriorityMenuOpen((v) => !v)}
                style={{ color: priorityColor(ticket.priority) }}
              >
                {priorityLabel(ticket.priority, t)}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>

              {priorityMenuOpen ? (
                <div className="ticket-inline-menu">
                  {(['urgent', 'high', 'medium', 'low'] as TicketPriority[]).map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      onClick={() => {
                        patchPriority(priority);
                        setPriorityMenuOpen(false);
                      }}
                    >
                      {priorityLabel(priority, t)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {ticket.status === 'open' ? (
              <button type="button" className="zd-btn" onClick={() => document.getElementById('ticket-assignee-select')?.focus()}>
                {t('tickets.actions.assign')}
              </button>
            ) : null}

            {ticket.status === 'in_progress' ? (
              <button type="button" className="zd-btn zd-btn-primary" onClick={() => setShowResolveModal(true)}>
                {t('tickets.actions.resolve')}
              </button>
            ) : null}

            {ticket.status === 'resolved' ? (
              <>
                <button type="button" className="zd-btn zd-btn-secondary" onClick={() => setShowReopenConfirm(true)}>
                  {t('tickets.actions.reopen')}
                </button>
                <button type="button" className="zd-btn zd-btn-primary" onClick={() => setShowCloseConfirm(true)}>
                  {t('tickets.actions.close')}
                </button>
              </>
            ) : null}

            {ticket.status === 'closed' ? (
              <button type="button" className="zd-btn zd-btn-secondary" onClick={() => setShowReopenConfirm(true)}>
                {t('tickets.actions.reopen')}
              </button>
            ) : null}

            <div className="ticket-actions-wrap" ref={actionsMenuRef}>
              <button
                type="button"
                className="ticket-actions-trigger"
                aria-label={t('tickets.actions.edit')}
                title={t('tickets.actions.edit')}
                onClick={() => setActionsMenuOpen((v) => !v)}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <circle cx="7" cy="2.5" r="1.2" fill="currentColor" />
                  <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                  <circle cx="7" cy="11.5" r="1.2" fill="currentColor" />
                </svg>
              </button>

              {actionsMenuOpen ? (
                <div className="ticket-actions-menu">
                  <PermissionGate permission="tickets:delete">
                    <button
                      type="button"
                      className="ticket-actions-menu-item danger"
                      onClick={() => {
                        setActionsMenuOpen(false);
                        setShowDeleteConfirm(true);
                      }}
                    >
                      {t('tickets.delete')}
                    </button>
                  </PermissionGate>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="ticket-detail-v2-layout">
          <main className="ticket-detail-v2-main">
            <section className="ticket-detail-v2-title-block">
              {titleEditing ? (
                <input
                  ref={titleInputRef}
                  className="ticket-title-input"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      saveTitle();
                    }

                    if (event.key === 'Escape') {
                      setTitleDraft(currentTitle);
                      setTitleEditing(false);
                    }
                  }}
                  onBlur={saveTitle}
                  aria-label={t('tickets.detail.editTitle')}
                />
              ) : (
                <h1 onClick={() => setTitleEditing(true)}>{currentTitle}</h1>
              )}
            </section>

            <section className="ticket-detail-section-v2 description-section-v2">
              <header className="ticket-detail-section-head">
                <span>{t('tickets.fields.description')}</span>
                {!descriptionEditing ? (
                  <button
                    type="button"
                    className="tb-icon-btn"
                    onClick={() => setDescriptionEditing(true)}
                    aria-label={t('tickets.fields.description')}
                    title={t('tickets.fields.description')}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                      <path d="M9.5 1.5 11.5 3.5 4.5 10.5H2.5V8.5L9.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : null}
              </header>

              {descriptionEditing ? (
                <div className="ticket-description-editor" data-color-mode={appTheme}>
                  <MDEditor
                    value={descriptionDraft}
                    onChange={(val) => setDescriptionDraft(val ?? '')}
                    height={300}
                    preview="live"
                    visibleDragbar={false}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className="zd-btn zd-btn-secondary"
                      onClick={() => {
                        setDescriptionDraft(ticket.description ?? '');
                        setDescriptionEditing(false);
                      }}
                    >
                      {t('tickets.actions.cancel')}
                    </button>
                    <button
                      type="button"
                      className="zd-btn zd-btn-primary"
                      disabled={updateMutation.isPending}
                      onClick={saveDescription}
                    >
                      {t('tickets.detail.saveDescription')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ticket-description-render" data-color-mode={appTheme}>
                  <MDEditor.Markdown
                    source={ticket.description ?? ''}
                    style={{ background: 'transparent', color: 'var(--txt)' }}
                  />
                </div>
              )}
            </section>

            <ChecklistSection ticketId={ticket.id} />
            <TimeTrackingSection ticketId={ticket.id} />

            <section className="ticket-detail-section-v2">
              <header className="ticket-detail-section-head">
                <span>{t('tickets.detail.addAttachment')}</span>
                <button type="button" className="zd-btn" onClick={() => attachmentInputRef.current?.click()}>
                  {t('tickets.detail.addAttachment')}
                </button>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    uploadMutation.mutate(file);
                    event.target.value = '';
                  }}
                />
              </header>

              {attachments.length === 0 ? (
                <div className="ticket-empty-inline">{t('tickets.detail.noAttachments')}</div>
              ) : (
                <div className="ticket-attachments-grid">
                  {attachments.map((attachment) => (
                    <AttachmentCard
                      key={attachment.id}
                      attachment={attachment}
                      canDelete={attachment.user_id === user?.id}
                      onDelete={() => removeAttachmentMutation.mutate(attachment.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="ticket-detail-section-v2">
              <div className="ticket-tabs-v2">
                <button
                  type="button"
                  className={activeTab === 'comments' ? 'active' : ''}
                  onClick={() => setActiveTab('comments')}
                >
                  {t('tickets.detail.comments')}
                </button>
                <button
                  type="button"
                  className={activeTab === 'history' ? 'active' : ''}
                  onClick={() => setActiveTab('history')}
                >
                  {t('tickets.detail.history')}
                </button>
              </div>

              {activeTab === 'comments' ? (
                <TicketComments ticketId={ticket.id} />
              ) : (
                <div className="ticket-history-list">
                  {timeline.length === 0 ? (
                    <div className="ticket-empty-inline">{t('tickets.kanban.empty')}</div>
                  ) : (
                    timeline.map((event) => (
                      <div key={event.id} className="ticket-history-item">
                        <span className="ticket-history-dot" />
                        <div>
                          <div className="ticket-history-title">{timelineMessage(event)}</div>
                          <div className="ticket-history-meta">
                            <span>{event.user_name ?? t('tickets.detail.systemUser')}</span>
                            <span>{formatMonoDate(event.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          </main>

          <aside className="ticket-detail-v2-sidebar">
            <section className="ticket-sidebar-section">
              <h2>{t('tickets.detail.sections.details')}</h2>
              <label className="ticket-sidebar-field">
                <span>{t('tickets.fields.type')}</span>
                <select
                  value={sidebarTypeId}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSidebarTypeId(value);
                    queuePatch({ type_id: value || null });
                  }}
                >
                  <option value="">—</option>
                  {ticketTypes.map((type) => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              </label>

              <div className="ticket-sidebar-field">
                <span>{t('tickets.fields.source')}</span>
                <SourceBadge source={ticket.source ?? 'manual'} />
              </div>

              {ticket.status === 'waiting' && ticket.waiting_reason ? (
                <div className="ticket-sidebar-field">
                  <span>{t('tickets.waiting.title')}</span>
                  <strong>{t(`tickets.waiting.reasons.${ticket.waiting_reason}`)}</strong>
                </div>
              ) : null}

              <div className="ticket-sidebar-field">
                <span>{t('tickets.fields.createdAt')}</span>
                <strong className="mono">{formatMonoDate(ticket.created_at)}</strong>
              </div>

              <div className="ticket-sidebar-field">
                <span>{t('tickets.fields.updatedAt')}</span>
                <strong className="mono">{formatMonoDate(ticket.updated_at)}</strong>
              </div>
            </section>

            <section className="ticket-sidebar-section">
              <h2>{t('tickets.detail.sections.assignment')}</h2>
              <label className="ticket-sidebar-field">
                <span>{t('tickets.fields.assignedTo')}</span>
                <select
                  id="ticket-assignee-select"
                  value={sidebarAssignedTo}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSidebarAssignedTo(value);
                    queuePatch({ assigned_to: value || null });
                  }}
                >
                  <option value="">{t('tickets.fields.noResponsible')}</option>
                  {(agentsData?.data ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="zd-btn"
                onClick={() => {
                  if (!user?.id) return;
                  setSidebarAssignedTo(user.id);
                  queuePatch({ assigned_to: user.id });
                }}
              >
                {t('tickets.actions.assignToMe')}
              </button>
            </section>

            <section className="ticket-sidebar-section">
              <h2>{t('tickets.detail.sections.contact')}</h2>
              <div className="ticket-sidebar-contact">
                <Link to={ticket.contact_id ? `/crm/contacts/${ticket.contact_id}?id=${ticket.contact_id}` : '/crm/contacts'}>
                  <ContactAvatar id={ticket.contact_id ?? ticket.id} name={ticket.contact_name ?? t('tickets.fields.noClient')} size={26} />
                  <span>{ticket.contact_name ?? t('tickets.fields.noClient')}</span>
                </Link>
                {ticket.organization_name ? <small>{ticket.organization_name}</small> : null}
              </div>
            </section>

            <section className="ticket-sidebar-section">
              <h2>{t('tickets.detail.sections.dueDate')}</h2>
              <label className={`ticket-sidebar-field ${dueState}`}>
                <span>{t('tickets.fields.dueDate')}</span>
                <input
                  className="ticket-due-date-input"
                  type="date"
                  value={sidebarDueDate}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSidebarDueDate(value);
                    queuePatch({ due_date: value ? `${value}T00:00:00.000Z` : '' });
                  }}
                />

                {ticket.due_date && (sla.status === 'warning' || sla.status === 'overdue') ? (
                  <span
                    className={`ticket-sla-badge ${sla.status}`}
                    style={{
                      background: getSlaBg(sla.status),
                      color: getSlaColor(sla.status),
                      borderColor: `${getSlaColor(sla.status)}40`,
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                      <circle cx="5.5" cy="5.5" r="4.2" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M5.5 3.2v2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      <circle cx="5.5" cy="7.6" r=".6" fill="currentColor" />
                    </svg>
                    {slaLabel}
                  </span>
                ) : null}

                {dueDateFormatted ? (
                  <span className="ticket-sla-date">{dueDateFormatted}</span>
                ) : null}

                {slaProgress !== null ? (
                  <div className="ticket-sla-progress-track">
                    <div
                      className="ticket-sla-progress-fill"
                      style={{
                        width: `${slaProgress}%`,
                        background: getSlaColor(sla.status),
                      }}
                    />
                  </div>
                ) : null}
              </label>
            </section>

            <section className="ticket-sidebar-section">
              <h2>{t('tickets.detail.sections.classification')}</h2>
              <label className="ticket-sidebar-field">
                <span>{t('tickets.fields.category')}</span>
                <select
                  value={sidebarCategory}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSidebarCategory(value);
                    queuePatch({ category: value || '' });
                  }}
                >
                  <option value="">{t('tickets.fields.category')}</option>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>

              <div className="ticket-sidebar-field">
                <span>{t('tickets.fields.tags')}</span>
                <div className="ticket-tags-wrap">
                  {sidebarTags.map((tag) => (
                    <span key={tag} className="ticket-tag-chip">
                      {tag}
                      <button
                        type="button"
                        onClick={() => updateTags(sidebarTags.filter((item) => item !== tag))}
                        aria-label={`Remover ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                <input
                  value={sidebarTagInput}
                  onChange={(event) => setSidebarTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault();
                      addTagsFromInput(sidebarTagInput);
                    }
                  }}
                  placeholder={t('tickets.detail.newTagPlaceholder')}
                />
              </div>
            </section>
          </aside>
        </div>
      </section>

      <ConfirmModal
        open={showDeleteConfirm}
        title={t('tickets.deleteTitle')}
        message={t('tickets.deleteMsg', { title: currentTitle })}
        confirmLabel={t('tickets.delete')}
        confirmVariant="danger"
        loading={deleteTicketMutation.isPending}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {showWaitingModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ticket-waiting-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background: 'var(--backdrop)',
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowWaitingModal(false);
              setWaitingReason('');
            }
          }}
        >
          <div
            style={{
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
              width: '100%',
              maxWidth: 460,
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              boxShadow: 'var(--shadow-pop)',
            }}
          >
            <div>
              <h3
                id="ticket-waiting-title"
                style={{ fontSize: 16, fontWeight: 600, color: 'var(--txt)', margin: 0 }}
              >
                {t('tickets.waiting.title')}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--txt-2)', marginTop: 4, marginBottom: 0 }}>
                {t('tickets.waiting.subtitle')}
              </p>
            </div>

            <div role="radiogroup" aria-labelledby="ticket-waiting-title" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(['customer', 'internal', 'third_party'] as const).map((reason) => (
                <label
                  key={reason}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 42,
                    padding: '10px 12px',
                    border: `1px solid ${waitingReason === reason ? 'var(--teal)' : 'var(--line)'}`,
                    borderRadius: 8,
                    background: waitingReason === reason ? 'var(--teal-dim)' : 'var(--bg-3)',
                    color: 'var(--txt)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="ticket-waiting-reason"
                    value={reason}
                    checked={waitingReason === reason}
                    onChange={() => setWaitingReason(reason)}
                    style={{ accentColor: 'var(--teal)' }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {t(`tickets.waiting.reasons.${reason}`)}
                  </span>
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="zd-btn zd-btn-secondary"
                onClick={() => {
                  setShowWaitingModal(false);
                  setWaitingReason('');
                }}
              >
                {t('tickets.actions.cancel')}
              </button>
              <button
                type="button"
                className="zd-btn zd-btn-primary"
                disabled={!waitingReason || updateMutation.isPending}
                onClick={async () => {
                  if (!waitingReason) return;

                  await updateMutation.mutateAsync({
                    status: 'waiting',
                    waiting_reason: waitingReason,
                  });
                  setShowWaitingModal(false);
                  setWaitingReason('');
                  setStatusMenuOpen(false);
                }}
              >
                {t('tickets.waiting.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showResolveModal ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background: 'var(--backdrop)',
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowResolveModal(false);
              setResolutionNotes('');
            }
          }}
        >
          <div
            style={{
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 12,
              width: '100%',
              maxWidth: 480,
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: 'var(--shadow-pop)',
            }}
          >
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--txt)', margin: 0 }}>
                {t('tickets.resolve.title')}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--txt-2)', marginTop: 4, marginBottom: 0 }}>
                {t('tickets.resolve.subtitle')}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label
                htmlFor="ticket-resolution-notes"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--txt-2)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                }}
              >
                {t('tickets.resolve.notesLabel')} *
              </label>
              <textarea
                id="ticket-resolution-notes"
                value={resolutionNotes}
                onChange={(event) => setResolutionNotes(event.target.value)}
                placeholder={t('tickets.resolve.notesPlaceholder')}
                rows={4}
                style={{
                  background: 'var(--bg-3)',
                  border: `1px solid ${resolutionNotes.trim().length === 0 ? 'var(--red)' : 'var(--line)'}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: 'var(--txt)',
                  fontSize: 13,
                  resize: 'vertical',
                  outline: 'none',
                  width: '100%',
                  boxSizing: 'border-box',
                  fontFamily: 'var(--font)',
                }}
              />
              {resolutionNotes.trim().length === 0 ? (
                <span style={{ fontSize: 11, color: 'var(--red)' }}>
                  {t('tickets.resolve.notesRequired')}
                </span>
              ) : null}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="zd-btn zd-btn-secondary"
                onClick={() => {
                  setShowResolveModal(false);
                  setResolutionNotes('');
                }}
              >
                {t('tickets.actions.cancel')}
              </button>
              <button
                type="button"
                className="zd-btn zd-btn-primary"
                disabled={resolutionNotes.trim().length === 0 || updateMutation.isPending}
                onClick={async () => {
                  await updateMutation.mutateAsync({
                    status: 'resolved',
                    resolution_notes: resolutionNotes.trim(),
                  } as Partial<CreateTicketPayload> & { resolution_notes: string });
                  setShowResolveModal(false);
                  setResolutionNotes('');
                }}
              >
                {t('tickets.actions.resolve')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={showCloseConfirm}
        title={t('tickets.close.title')}
        message={t('tickets.close.subtitle')}
        confirmLabel={t('tickets.actions.close')}
        loading={updateMutation.isPending}
        onConfirm={async () => {
          await updateMutation.mutateAsync({ status: 'closed' });
          setShowCloseConfirm(false);
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />

      <ConfirmModal
        open={showReopenConfirm}
        title={t('tickets.reopen.title')}
        message={t('tickets.reopen.subtitle')}
        confirmLabel={t('tickets.actions.reopen')}
        loading={updateMutation.isPending}
        onConfirm={async () => {
          await updateMutation.mutateAsync({ status: 'open' });
          setShowReopenConfirm(false);
        }}
        onCancel={() => setShowReopenConfirm(false)}
      />
    </PageShell>
  );
}
