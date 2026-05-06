import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ticketsApi, type TicketComment } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { useToast } from '../../stores/toast.store';
import { subscribeToEvent } from '../../services/socket';
import { Button } from '../ui/Button';

interface Props {
  ticketId: string;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes}min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return (
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        flexShrink: 0,
        background: 'var(--bg-4)',
        border: '1px solid var(--line-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--txt-2)',
      }}
    >
      {initials}
    </span>
  );
}

export function TicketComments({ ticketId }: Props) {
  const { t } = useTranslation('tickets');
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [content, setContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const { data: comments = [], isPending } = useQuery({
    queryKey: ['ticket-comments', ticketId],
    queryFn: () => ticketsApi.listComments(ticketId),
    staleTime: 30_000,
  });

  useEffect(() => {
    const unsub = subscribeToEvent<{ comment?: TicketComment; ticketId?: string }>('ticket:comment_added', (data) => {
      const receivedTicketId = data.ticketId ?? data.comment?.ticket_id;
      if (receivedTicketId === ticketId) {
        void queryClient.invalidateQueries({ queryKey: ['ticket-comments', ticketId] });
      }
    });
    return unsub;
  }, [ticketId, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  const addMutation = useMutation({
    mutationFn: () => ticketsApi.addComment(ticketId, { content: content.trim(), is_internal: isInternal }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-comments', ticketId] });
      setContent('');
      setIsInternal(false);
    },
    onError: () => toast.error('Erro ao enviar comentário'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, nextContent }: { id: string; nextContent: string }) => ticketsApi.updateComment(ticketId, id, nextContent),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-comments', ticketId] });
      setEditingId(null);
      setEditContent('');
      toast.success('Comentário atualizado');
    },
    onError: () => toast.error('Erro ao atualizar comentário'),
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => ticketsApi.deleteComment(ticketId, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-comments', ticketId] });
      toast.success('Comentário excluído');
    },
    onError: () => toast.error('Erro ao excluir comentário'),
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;
    addMutation.mutate();
  }

  const canDeleteAsAdmin = user?.role === 'owner' || user?.role === 'admin';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <h4
        style={{
          margin: '0 0 12px',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--txt-2)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {t('tickets.comments.title')}
      </h4>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {isPending ? (
          <p style={{ color: 'var(--txt-3)', fontSize: 13, textAlign: 'center' }}>Carregando...</p>
        ) : null}

        {!isPending && comments.length === 0 ? (
          <p style={{ color: 'var(--txt-3)', fontSize: 13, textAlign: 'center', fontStyle: 'italic' }}>
            {t('tickets.comments.noComments')}
          </p>
        ) : null}

        {comments.map((comment) => (
          <div key={comment.id} className={`ticket-comment ${comment.is_internal ? 'internal' : 'public'}`}>
            <Avatar name={comment.author_name ?? 'U'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>
                  {comment.author_name ?? 'Usuário'}
                </span>
                <span className={`comment-visibility-badge ${comment.is_internal ? 'internal' : 'public'}`}>
                  {comment.is_internal ? 'Interno' : 'Público'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>
                  {formatRelative(comment.created_at)}
                </span>

                <div className="row-actions">
                  {comment.user_id === user?.id ? (
                    <button
                      type="button"
                      className="tb-icon-btn"
                      onClick={() => {
                        setEditingId(comment.id);
                        setEditContent(comment.content);
                      }}
                      title="Editar comentário"
                      aria-label="Editar comentário"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path d="M8.5 1.5L10.5 3.5 3.5 10.5H1.5V8.5L8.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : null}

                  {comment.user_id === user?.id || canDeleteAsAdmin ? (
                    <button
                      type="button"
                      className="tb-icon-btn danger"
                      onClick={() => deleteMutation.mutate(comment.id)}
                      disabled={deleteMutation.isPending}
                      title={t('tickets.comments.delete')}
                      aria-label={t('tickets.comments.delete')}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path d="M2 3.5h8M4.5 3.5V2h3v1.5M9.5 3.5L9 10H3L2.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </div>

              {editingId === comment.id ? (
                <div className="comment-edit-wrapper">
                  <textarea
                    autoFocus
                    value={editContent}
                    onChange={(event) => setEditContent(event.target.value)}
                    className="comment-edit-textarea"
                    rows={3}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setEditingId(null);
                        setEditContent('');
                      }
                    }}
                  />
                  <div className="comment-edit-actions">
                    <button
                      type="button"
                      className="tb-btn"
                      onClick={() => {
                        setEditingId(null);
                        setEditContent('');
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="tb-btn tb-btn-primary"
                      disabled={editMutation.isPending || !editContent.trim()}
                      onClick={() => editMutation.mutate({ id: comment.id, nextContent: editContent.trim() })}
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--txt)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {comment.content}
                </p>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit}>
        <div className={`comment-composer ${isInternal ? 'internal' : 'public'}`}>
          <div className="comment-type-toggle">
            <button
              type="button"
              className={!isInternal ? 'active' : ''}
              onClick={() => setIsInternal(false)}
            >
              Público
              <span className="toggle-hint">Visível ao cliente</span>
            </button>
            <button
              type="button"
              className={isInternal ? 'active' : ''}
              onClick={() => setIsInternal(true)}
            >
              Interno
              <span className="toggle-hint">Apenas equipe</span>
            </button>
          </div>

          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={isInternal ? 'Nota interna' : 'Comentário público'}
            className="zd-textarea comment-textarea"
            rows={3}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) handleSubmit(event);
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              resize: 'vertical',
              minHeight: 72,
              lineHeight: 1.5,
            }}
          />

          <div className="comment-footer">
            <Button type="submit" loading={addMutation.isPending} disabled={!content.trim()}>
              {addMutation.isPending ? t('tickets.comments.sending') : 'Comentar'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
