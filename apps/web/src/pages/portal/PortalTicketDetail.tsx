import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { portalApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PortalTicketDetail() {
  const { t, i18n } = useTranslation('portal');
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [csatScore, setCsatScore] = useState(0);
  const [csatComment, setCsatComment] = useState('');

  const { data: ticket, isLoading, isError, refetch } = useQuery({
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

  const reopenMutation = useMutation({
    mutationFn: () => portalApi.reopenTicket(id!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal-ticket', id] });
      toast.success(t('ticket.reopenSuccess'));
    },
    onError: () => toast.error(t('ticket.reopenError')),
  });

  const csatMutation = useMutation({
    mutationFn: () => portalApi.submitCsat(id!, { score: csatScore, ...(csatComment.trim() ? { comment: csatComment.trim() } : {}) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal-ticket', id] });
      toast.success(t('csat.submitSuccess'));
    },
    onError: () => toast.error(t('csat.submitError')),
  });

  const handleOpenAttachment = async (attachmentId: string, filename: string) => {
    try {
      const blob = await portalApi.downloadAttachment(attachmentId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error(t('ticket.messages.attachmentError'));
    }
  };

  if (isLoading) {
    return (
      <div className="portal-section">
        <p className="portal-empty">{t('ticket.loading')}</p>
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="portal-section">
        <div className="portal-empty-state">
          <div className="portal-empty-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 8v5M12 16h.01M10.3 3.9 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="portal-empty-title">{t('ticket.errorTitle')}</p>
          <p className="portal-empty-subtitle">{t('ticket.errorSubtitle')}</p>
          <button type="button" className="portal-btn-primary portal-btn-inline" onClick={() => void refetch()}>
            {t('ticket.retry')}
          </button>
        </div>
      </div>
    );
  }

  const canReopen = ticket.status === 'resolved';
  const csatExpired = Boolean(ticket.csat_expires_at) && new Date(ticket.csat_expires_at!) < new Date();
  const showCsat = ticket.status === 'resolved' && !ticket.csat_responded_at && !csatExpired;
  const alreadyRated = Boolean(ticket.csat_responded_at);

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

      {canReopen && (
        <div className="portal-reopen-bar">
          <span>{t('ticket.reopenHint')}</span>
          <button
            type="button"
            className="portal-btn-primary portal-btn-inline"
            disabled={reopenMutation.isPending}
            onClick={() => reopenMutation.mutate()}
          >
            {reopenMutation.isPending ? t('ticket.reopenLoading') : t('ticket.reopen')}
          </button>
        </div>
      )}

      <div className="portal-description">
        <h3>{t('ticket.descriptionTitle')}</h3>
        <p>{ticket.description || t('ticket.noDescription')}</p>
      </div>

      {ticket.attachments.length > 0 && (
        <div className="portal-attachments">
          <h3>{t('ticket.attachmentsTitle')}</h3>
          <ul className="portal-attachment-list">
            {ticket.attachments.map((attachment) => (
              <li key={attachment.id}>
                <button
                  type="button"
                  className="portal-attachment-link"
                  onClick={() => void handleOpenAttachment(attachment.id, attachment.filename)}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M4 2.5h6l4 4v9H4v-13Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  </svg>
                  {attachment.filename}
                </button>
                <span className="portal-attachment-size">{formatFileSize(attachment.file_size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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

      {showCsat && (
        <div className="portal-csat-section">
          <h3>{t('csat.title')}</h3>
          <p>{t('csat.description')}</p>
          <div className="portal-csat-stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className={`portal-csat-star${csatScore >= star ? ' active' : ''}`}
                onClick={() => setCsatScore(star)}
                aria-label={t('csat.starLabel', { count: star })}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            placeholder={t('csat.commentPlaceholder')}
            value={csatComment}
            onChange={(event) => setCsatComment(event.target.value)}
            rows={3}
          />
          <button
            type="button"
            className="portal-btn-primary portal-btn-inline"
            disabled={!csatScore || csatMutation.isPending}
            onClick={() => csatMutation.mutate()}
          >
            {csatMutation.isPending ? t('csat.submitLoading') : t('csat.submit')}
          </button>
        </div>
      )}

      {alreadyRated && (
        <div className="portal-csat-section portal-csat-done">
          <h3>{t('csat.thanksTitle')}</h3>
          <div className="portal-csat-stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <span key={star} className={`portal-csat-star${(ticket.csat_score ?? 0) >= star ? ' active' : ''}`}>★</span>
            ))}
          </div>
          {ticket.csat_comment ? <p className="portal-csat-comment">{ticket.csat_comment}</p> : null}
        </div>
      )}
    </div>
  );
}
