import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { portalApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

export function PortalTicketDetail() {
  const { t, i18n } = useTranslation('portal');
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['portal-ticket', id],
    queryFn: () => portalApi.getTicket(id!),
    enabled: !!id,
  });

  const addCommentMutation = useMutation({
    mutationFn: (content: string) => portalApi.addComment(id!, content),
    onSuccess: async () => {
      setComment('');
      await queryClient.invalidateQueries({ queryKey: ['portal-ticket', id] });
      toast.success(t('ticket.messages.commentSuccess'));
    },
    onError: () => toast.error(t('ticket.messages.commentError')),
  });

  if (!ticket) {
    return isLoading ? (
      <div className="portal-section">
        <p className="portal-empty">{t('ticket.loading')}</p>
      </div>
    ) : null;
  }

  return (
    <div className="portal-section">
      <Link to="/portal/tickets" className="portal-back-link">← {t('ticket.backToTickets')}</Link>

      <div className="portal-ticket-detail-header">
        <h2>{ticket.title}</h2>
        <span className={`portal-status portal-status-${ticket.status}`}>
          {t(`ticket.status.${ticket.status}`, { defaultValue: ticket.status })}
        </span>
      </div>

      <div className="portal-ticket-detail-grid">
        <div><strong>{t('ticket.details.type')}:</strong> {ticket.type_name ?? t('ticket.typeFallback')}</div>
        <div><strong>{t('ticket.details.priority')}:</strong> {t(`ticket.priorityLabel.${ticket.priority}`, { defaultValue: ticket.priority })}</div>
        <div><strong>{t('ticket.details.assignee')}:</strong> {ticket.assigned_name ?? t('ticket.details.assigneeFallback')}</div>
        <div><strong>{t('ticket.details.createdAt')}:</strong> {new Date(ticket.created_at).toLocaleString(i18n.language)}</div>
      </div>

      <div className="portal-description">
        <h3>{t('ticket.descriptionTitle')}</h3>
        <p>{ticket.description || t('ticket.noDescription')}</p>
      </div>

      <div className="portal-comments">
        <h3>{t('ticket.commentsTitle')}</h3>
        {ticket.comments.map((item) => (
          <div key={item.id} className="portal-comment-item">
            <div className="portal-comment-head">
              <strong>{item.user_name ?? t('ticket.commenterFallback')}</strong>
              <span>{new Date(item.created_at).toLocaleString(i18n.language)}</span>
            </div>
            <p>{item.content}</p>
          </div>
        ))}
        {ticket.comments.length === 0 ? <p className="portal-empty">{t('ticket.noComments')}</p> : null}
      </div>

      <div className="portal-comment-form">
        <label className="sr-only" htmlFor="portal-ticket-comment">{t('ticket.addComment')}</label>
        <textarea
          id="portal-ticket-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t('ticket.commentPlaceholder')}
          aria-label={t('ticket.addComment')}
          rows={4}
        />
        <button
          type="button"
          className="portal-btn-primary portal-btn-inline"
          disabled={!comment.trim() || addCommentMutation.isPending}
          onClick={() => addCommentMutation.mutate(comment.trim())}
        >
          {addCommentMutation.isPending ? t('ticket.addCommentLoading') : t('ticket.addComment')}
        </button>
      </div>
    </div>
  );
}
