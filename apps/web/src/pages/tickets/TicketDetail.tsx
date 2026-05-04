import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ticketsApi, type Ticket, type TicketTimelineEvent } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { TicketStatusBadge } from '../../components/tickets/TicketStatusBadge';
import { TicketPriorityBadge } from '../../components/tickets/TicketPriorityBadge';
import { TicketComments } from '../../components/tickets/TicketComments';
import { AssignTicketModal } from '../../components/tickets/AssignTicketModal';
import { ContactAvatar } from '../../components/crm/ContactAvatar';
import { subscribeToEvent } from '../../services/socket';


interface Props {
  ticketId: string | null;
}

const selectStyle: React.CSSProperties = {
  background:   'var(--bg-3)',
  border:       '1px solid var(--line)',
  color:        'var(--txt)',
  height:       '1.875rem',
  borderRadius: 'var(--r)',
  padding:      '0 0.5rem',
  fontSize:     12,
  outline:      'none',
  fontFamily:   'var(--font)',
  cursor:       'pointer',
};

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      <div style={{ fontSize: 12, color: 'var(--txt)' }}>{children}</div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <span style={{
      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, var(--purple), #8B5CF6)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 9, fontWeight: 700, color: '#fff',
    }}>
      {initials}
    </span>
  );
}

function TimelineEvent({
  event,
  showLine,
}: {
  event: TicketTimelineEvent;
  showLine: boolean;
}) {
  const { t } = useTranslation('tickets');
  const icons: Record<string, string> = {
    created: '🎫',
    status_changed: '🔄',
    priority_changed: '⚡',
    assigned: '👤',
    tag_added: '🏷️',
    tag_removed: '🏷️',
    comment_added: '💬',
    resolved: '✅',
  };

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
    return event.event_type;
  })();

  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 0', position: 'relative' }}>
      <div style={{
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
      }}>
        <span>{icons[event.event_type] ?? '•'}</span>
      </div>
      {showLine ? (
        <div style={{
          position: 'absolute',
          left: 14,
          top: 32,
          bottom: -10,
          width: 1,
          background: 'var(--line)',
        }} />
      ) : null}
      <div style={{ flex: 1, paddingTop: 4, position: 'relative' }}>
        <div style={{ fontSize: 13, color: 'var(--txt)' }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2, fontSize: 11, color: 'var(--txt-3)' }}>
          <span style={{ fontWeight: 500 }}>{event.user_name ?? 'Sistema'}</span>
          <span>{formatRelativeDate(event.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

export function TicketDetail({ ticketId }: Props) {
  const { t } = useTranslation('tickets');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'comments' | 'timeline'>('comments');

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

  useEffect(() => {
    if (!ticketId) return undefined;
    return subscribeToEvent<{ ticketId: string }>('ticket:event', (data) => {
      if (data.ticketId === ticketId) {
        void queryClient.invalidateQueries({ queryKey: ['ticket-timeline', ticketId] });
      }
    });
  }, [queryClient, ticketId]);

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof ticketsApi.update>[1]) =>
      ticketsApi.update(ticketId!, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['ticket', ticketId], updated);
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: () => toast.error('Erro ao atualizar ticket'),
  });

  if (!ticketId) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden style={{ opacity: 0.25 }}>
          <rect x="6" y="8" width="36" height="32" rx="4" stroke="var(--txt-3)" strokeWidth="2" />
          <path d="M14 18h20M14 26h14" stroke="var(--txt-3)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <p style={{ color: 'var(--txt-3)', fontSize: 13 }}>{t('tickets.noSelection')}</p>
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

  function handleTitleSave() {
    if (titleDraft.trim().length >= 3 && titleDraft !== ticket!.title) {
      updateMutation.mutate({ title: titleDraft.trim() });
    }
    setEditingTitle(false);
  }

  function quickUpdate(patch: Parameters<typeof ticketsApi.update>[1]) {
    updateMutation.mutate(patch);
    const msg =
      'status' in patch && patch.status === 'resolved' ? t('tickets.form.resolved') :
      'status' in patch && patch.status === 'closed'   ? t('tickets.form.closed')   :
      t('tickets.form.updated');
    toast.success(msg);
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--bg-2)' }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); if (e.key === 'Escape') setEditingTitle(false); }}
              style={{
                flex: 1, fontSize: 16, fontWeight: 600, background: 'var(--bg-3)',
                border: '1px solid var(--teal)', borderRadius: 'var(--r)', padding: '4px 8px',
                color: 'var(--txt)', outline: 'none', fontFamily: 'var(--font)',
              }}
            />
          ) : (
            <h2
              onClick={() => { setTitleDraft(ticket.title); setEditingTitle(true); }}
              style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--txt)',
                cursor: 'text', lineHeight: 1.4 }}
              title="Clique para editar"
            >
              {ticket.title}
            </h2>
          )}

          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={() => setAssignOpen(true)} style={{
              padding: '4px 10px', borderRadius: 'var(--r)', border: '1px solid var(--line)',
              background: 'transparent', color: 'var(--txt-2)', fontSize: 12, cursor: 'pointer',
              fontFamily: 'var(--font)', fontWeight: 500,
            }}>
              {t('tickets.actions.assign')}
            </button>

            {!isResolved && (
              <button onClick={() => quickUpdate({ status: 'resolved' })} style={{
                padding: '4px 10px', borderRadius: 'var(--r)', border: '1px solid var(--green)',
                background: 'var(--green-dim)', color: 'var(--green)', fontSize: 12, cursor: 'pointer',
                fontFamily: 'var(--font)', fontWeight: 600,
              }}>
                {t('tickets.actions.resolve')}
              </button>
            )}

            {ticket.status !== 'closed' && (
              <button onClick={() => quickUpdate({ status: 'closed' })} style={{
                padding: '4px 10px', borderRadius: 'var(--r)', border: '1px solid var(--line)',
                background: 'transparent', color: 'var(--txt-3)', fontSize: 12, cursor: 'pointer',
                fontFamily: 'var(--font)', fontWeight: 500,
              }}>
                {t('tickets.actions.close')}
              </button>
            )}

            {isResolved && (
              <button onClick={() => quickUpdate({ status: 'open' })} style={{
                padding: '4px 10px', borderRadius: 'var(--r)', border: '1px solid var(--blue)',
                background: 'var(--blue-dim)', color: 'var(--blue)', fontSize: 12, cursor: 'pointer',
                fontFamily: 'var(--font)', fontWeight: 500,
              }}>
                {t('tickets.actions.reopen')}
              </button>
            )}
          </div>
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-3)', marginLeft: 4 }}>
            #{ticket.id.slice(-6).toUpperCase()}
          </span>
        </div>
      </div>

      {/* ── Body: sidebar + main ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* Sidebar */}
        <div style={{
          width: 220, flexShrink: 0, borderRight: '1px solid var(--line)',
          padding: '16px 14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16,
          background: 'var(--bg-2)',
        }}>
          <Field label={t('tickets.fields.status')}>
            <select style={selectStyle} value={ticket.status}
              onChange={(e) => quickUpdate({ status: e.target.value as Ticket['status'] })}>
              <option value="open">{t('tickets.status.open')}</option>
              <option value="in_progress">{t('tickets.status.in_progress')}</option>
              <option value="waiting">{t('tickets.status.waiting')}</option>
              <option value="resolved">{t('tickets.status.resolved')}</option>
              <option value="closed">{t('tickets.status.closed')}</option>
            </select>
          </Field>

          <Field label={t('tickets.fields.priority')}>
            <select style={selectStyle} value={ticket.priority}
              onChange={(e) => quickUpdate({ priority: e.target.value as Ticket['priority'] })}>
              <option value="low">{t('tickets.priority.low')}</option>
              <option value="medium">{t('tickets.priority.medium')}</option>
              <option value="high">{t('tickets.priority.high')}</option>
              <option value="urgent">{t('tickets.priority.urgent')}</option>
            </select>
          </Field>

          <Field label={t('tickets.fields.assignedTo')}>
            {ticket.assignee_name
              ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Avatar name={ticket.assignee_name} />
                  {ticket.assignee_name}
                </span>
              : <span style={{ color: 'var(--txt-3)', fontStyle: 'italic' }}>
                  {t('tickets.fields.noResponsible')}
                </span>
            }
          </Field>

          <Field label={t('tickets.fields.client')}>
            {ticketContactName && ticket.contact_id
              ? (
                <Link to={`/crm/contacts/${ticket.contact_id ?? ''}?id=${ticket.contact_id ?? ''}`} style={{ textDecoration: 'none' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 8px',
                    borderRadius: 'var(--r-pill)',
                    border: '1px solid var(--line)',
                    background: 'var(--bg-3)',
                    color: 'var(--teal)',
                  }}>
                    <ContactAvatar id={ticket.contact_id ?? undefined} name={ticketContactName} size={20} />
                    {ticketContactName}
                  </span>
                </Link>
              )
              : ticketContactName
                ? <span style={{ color: 'var(--teal)' }}>{ticketContactName}</span>
              : <span style={{ color: 'var(--txt-3)', fontStyle: 'italic' }}>{t('tickets.fields.noClient')}</span>
            }
          </Field>

          <Field label={t('tickets.organization', { defaultValue: 'Organização' })}>
            {ticket.organization_name && ticket.organization_id
              ? (
                <Link to={`/crm/organizations/${ticket.organization_id ?? ''}?id=${ticket.organization_id ?? ''}`} style={{ textDecoration: 'none' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 8px',
                    borderRadius: 'var(--r-pill)',
                    border: '1px solid var(--line)',
                    background: 'var(--bg-3)',
                    color: 'var(--txt)',
                  }}>
                    <span aria-hidden>🏢</span>
                    {ticket.organization_name}
                  </span>
                </Link>
              )
              : ticket.organization_name
                ? <span>{ticket.organization_name}</span>
              : <span style={{ color: 'var(--txt-3)', fontStyle: 'italic' }}>{t('tickets.fields.noOrganization', { defaultValue: 'Não vinculada' })}</span>
            }
          </Field>

          {ticket.category && (
            <Field label={t('tickets.fields.category')}>
              {ticket.category}
            </Field>
          )}

          <Field label={t('tickets.fields.dueDate')}>
            {ticket.due_date
              ? <span style={{ color: new Date(ticket.due_date) < new Date() ? 'var(--red)' : 'var(--txt)' }}>
                  {formatDate(ticket.due_date)}
                </span>
              : <span style={{ color: 'var(--txt-3)', fontStyle: 'italic' }}>{t('tickets.fields.noDueDate')}</span>
            }
          </Field>

          {ticket.tags.length > 0 && (
            <Field label={t('tickets.fields.tags')}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                {ticket.tags.map((tag) => (
                  <span key={tag} style={{
                    padding: '1px 6px', borderRadius: 'var(--r-pill)', fontSize: 10,
                    background: 'var(--teal-dim)', color: 'var(--teal)',
                    border: '1px solid rgba(0,201,167,.2)',
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
            </Field>
          )}

          <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Field label={t('tickets.fields.createdAt')}>{formatDate(ticket.created_at)}</Field>
            <Field label={t('tickets.fields.updatedAt')}>{formatDate(ticket.updated_at)}</Field>
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {ticket.description && (
            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--txt-2)',
                textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('tickets.fields.description')}
              </h4>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--txt)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {ticket.description}
              </p>
            </div>
          )}

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
                {t('tickets.comments.title')}
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
                  <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>Sem eventos no histórico</div>
                ) : (
                  timeline.map((event, index) => (
                    <TimelineEvent
                      key={event.id}
                      event={event}
                      showLine={index < timeline.length - 1}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <AssignTicketModal
        ticketId={assignOpen ? ticket.id : null}
        onClose={() => setAssignOpen(false)}
      />
    </div>
  );
}
