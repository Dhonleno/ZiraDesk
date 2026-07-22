import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { portalApi, type PortalTicketDetail } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { PortalStatusBadge } from './PortalStatusBadge';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PortalTicketDetailInline({ ticket }: { ticket: PortalTicketDetail }) {
  const { t, i18n } = useTranslation('portal');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [csatScore, setCsatScore] = useState(0);
  const [csatComment, setCsatComment] = useState('');

  const invalidateTicket = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['portal-ticket', ticket.id] }),
      queryClient.invalidateQueries({ queryKey: ['portal-tickets'] }),
    ]);

  const addCommentMutation = useMutation({
    mutationFn: (content: string) => portalApi.addComment(ticket.id, content),
    onSuccess: async () => {
      setComment('');
      await invalidateTicket();
      toast.success(t('ticket.messages.commentSuccess'));
    },
    onError: () => toast.error(t('ticket.messages.commentError')),
  });

  const reopenMutation = useMutation({
    mutationFn: () => portalApi.reopenTicket(ticket.id),
    onSuccess: async () => {
      await invalidateTicket();
      toast.success(t('ticket.reopenSuccess'));
    },
    onError: () => toast.error(t('ticket.reopenError')),
  });

  const csatMutation = useMutation({
    mutationFn: () =>
      portalApi.submitCsat(ticket.id, { score: csatScore, ...(csatComment.trim() ? { comment: csatComment.trim() } : {}) }),
    onSuccess: async () => {
      await invalidateTicket();
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

  const canReopen = ticket.status === 'resolved';
  const csatExpired = Boolean(ticket.csat_expires_at) && new Date(ticket.csat_expires_at!) < new Date();
  const showCsat = ticket.status === 'resolved' && !ticket.csat_responded_at && !csatExpired;
  const alreadyRated = Boolean(ticket.csat_responded_at);

  return (
    <div className="portal-ticket-detail-inline">
      <h2 className="portal-detail-title">{ticket.title}</h2>
      <div className="portal-detail-meta">
        <PortalStatusBadge status={ticket.status} />
        <span>{t(`ticket.priorityLabel.${ticket.priority}`, { defaultValue: ticket.priority })}</span>
        <span aria-hidden>·</span>
        <span>{ticket.assigned_name ?? t('ticket.details.assigneeFallback')}</span>
        <span aria-hidden>·</span>
        <span>{new Date(ticket.created_at).toLocaleString(i18n.language)}</span>
      </div>

      <div className="portal-detail-desc">
        {ticket.description || t('ticket.noDescription')}
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

        <div className="portal-comment-form">
          <label className="sr-only" htmlFor="portal-ticket-comment">{t('ticket.addComment')}</label>
          <textarea
            id="portal-ticket-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t('ticket.commentPlaceholder')}
            aria-label={t('ticket.addComment')}
            rows={3}
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
    </div>
  );
}
