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
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'agora';
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <span style={{
      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, var(--teal), var(--purple))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: 700, color: '#fff',
    }}>
      {initials}
    </span>
  );
}

export function TicketComments({ ticketId }: Props) {
  const { t } = useTranslation('tickets');
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [content, setContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);

  const { data: comments = [], isPending } = useQuery({
    queryKey: ['ticket-comments', ticketId],
    queryFn: () => ticketsApi.listComments(ticketId),
    staleTime: 30_000,
  });

  useEffect(() => {
    const unsub = subscribeToEvent<{ comment: TicketComment; ticketId: string }>(
      'ticket:comment_added',
      (data) => {
        if (data.comment.ticket_id === ticketId) {
          void queryClient.invalidateQueries({ queryKey: ['ticket-comments', ticketId] });
        }
      },
    );
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

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => ticketsApi.deleteComment(ticketId, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-comments', ticketId] });
      toast.success('Comentário excluído');
    },
    onError: () => toast.error('Erro ao excluir comentário'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    addMutation.mutate();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, color: 'var(--txt-2)',
        textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {t('tickets.comments.title')}
      </h4>

      {/* Comment list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {isPending && (
          <p style={{ color: 'var(--txt-3)', fontSize: 13, textAlign: 'center' }}>Carregando...</p>
        )}
        {!isPending && comments.length === 0 && (
          <p style={{ color: 'var(--txt-3)', fontSize: 13, textAlign: 'center', fontStyle: 'italic' }}>
            {t('tickets.comments.noComments')}
          </p>
        )}
        {comments.map((c) => (
          <div key={c.id} style={{
            display: 'flex', gap: 10,
            opacity: c.is_internal ? 0.85 : 1,
            background: c.is_internal ? 'var(--amber-dim)' : 'transparent',
            borderRadius: c.is_internal ? 'var(--r)' : 0,
            padding: c.is_internal ? '8px 10px' : 0,
            border: c.is_internal ? '1px solid rgba(245,158,11,.2)' : 'none',
          }}>
            <Avatar name={c.author_name ?? 'U'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>
                  {c.author_name ?? 'Usuário'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>{formatRelative(c.created_at)}</span>
                {c.is_internal && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 'var(--r-pill)',
                    background: 'var(--amber-dim)', color: 'var(--amber)',
                  }}>
                    {t('tickets.comments.internal')}
                  </span>
                )}
                {c.user_id === user?.id && (
                  <button
                    onClick={() => deleteMutation.mutate(c.id)}
                    disabled={deleteMutation.isPending}
                    title={t('tickets.comments.delete')}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--txt-3)', display: 'flex', alignItems: 'center', padding: 2,
                      borderRadius: 4, lineHeight: 1 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M2 3h8M5 3V2h2v1M4 3v6h4V3H4z" stroke="currentColor" strokeWidth="1.2"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--txt)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {c.content}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t('tickets.comments.placeholder')}
          rows={3}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e); }}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 72,
            padding: '8px 10px', borderRadius: 'var(--r)', fontSize: 13,
            background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt)',
            outline: 'none', fontFamily: 'var(--font)', lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--txt-2)' }}>
            <input
              type="checkbox"
              checked={isInternal}
              onChange={(e) => setIsInternal(e.target.checked)}
              style={{ accentColor: 'var(--amber)', width: 14, height: 14 }}
            />
            {t('tickets.comments.internal')}
          </label>
          <div style={{ marginLeft: 'auto' }}>
            <Button type="submit" loading={addMutation.isPending} disabled={!content.trim()}>
              {addMutation.isPending ? t('tickets.comments.sending') : t('tickets.comments.send')}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
