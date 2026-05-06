import { useState, useRef, useEffect, type ReactNode, type RefObject } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ticketsApi, type TicketComment } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { useToast } from '../../stores/toast.store';
import { subscribeToEvent } from '../../services/socket';
import { parseMarkdown } from '../../utils/markdown';

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

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="4" cy="4" r="1" fill="currentColor" />
        <path d="M1 8l3-3 2 2 2-2 3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (mimeType.includes('pdf')) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M2 1.5h5l3 3V10.5A.5.5 0 019.5 11h-7A.5.5 0 012 10.5v-9A.5.5 0 012 1.5z" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7 1.5v3h3" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3.5 7h5M3.5 9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2 1.5h5l3 3V10.5A.5.5 0 019.5 11h-7A.5.5 0 012 10.5v-9A.5.5 0 012 1.5z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 1.5v3h3" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function FormatToolbar({ textareaRef }: { textareaRef: RefObject<HTMLTextAreaElement | null> }) {
  const applyFormat = (prefix: string, suffix: string) => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = el.value.substring(start, end);
    const before = el.value.substring(0, start);
    const after = el.value.substring(end);

    if (selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= prefix.length + suffix.length) {
      const newVal = before + selected.slice(prefix.length, -suffix.length) + after;
      el.value = newVal;
      el.setSelectionRange(start, Math.max(start, end - prefix.length - suffix.length));
    } else {
      const newVal = before + prefix + selected + suffix + after;
      el.value = newVal;
      el.setSelectionRange(start + prefix.length, end + prefix.length);
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  };

  const tools: Array<{ label: string; prefix: string; suffix: string; icon: ReactNode }> = [
    {
      label: 'Negrito',
      prefix: '**',
      suffix: '**',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M3.5 2.5H7a2 2 0 010 4H3.5V2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M3.5 6.5H7.5a2.5 2.5 0 010 5H3.5V6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: 'Itálico',
      prefix: '_',
      suffix: '_',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M5 2.5h5M3 10.5h5M7.5 2.5L5.5 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      label: 'Código',
      prefix: '`',
      suffix: '`',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M4.5 4L1.5 6.5 4.5 9M8.5 4L11.5 6.5 8.5 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: 'Tachado',
      prefix: '~~',
      suffix: '~~',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M2 6.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M4.5 3.5C4.5 3.5 5 2 6.5 2s2.5 1 2.5 2-1 1.5-2.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M4 9c0 1 1 2 2.5 2s2.5-1 2.5-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  return (
    <div className="format-toolbar">
      {tools.map((tool) => (
        <button
          key={tool.label}
          type="button"
          className="format-btn"
          onClick={() => applyFormat(tool.prefix, tool.suffix)}
          title={tool.label}
          aria-label={tool.label}
        >
          {tool.icon}
        </button>
      ))}
      <div className="format-divider" />
      <span className="format-hint">Selecione texto e clique para formatar</span>
    </div>
  );
}

export function TicketComments({ ticketId }: Props) {
  const { t } = useTranslation('tickets');
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [comment, setComment] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
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

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!comment.trim() && commentFiles.length === 0) return;

      const createdComment = await ticketsApi.addComment(ticketId, {
        content: comment.trim() || 'Arquivo(s) anexado(s)',
        is_internal: isInternal,
      });

      if (commentFiles.length > 0) {
        await Promise.all(commentFiles.map((file) => ticketsApi.uploadAttachment(ticketId, file, createdComment.id)));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-comments', ticketId] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-attachments', ticketId] });
      setComment('');
      setIsInternal(false);
      setShowPreview(false);
      setCommentFiles([]);
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

  async function handleSubmit() {
    if (!comment.trim() && commentFiles.length === 0) return;
    await submitMutation.mutateAsync();
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
                      className="zd-btn"
                      onClick={() => {
                        setEditingId(null);
                        setEditContent('');
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="zd-btn zd-btn-primary"
                      disabled={editMutation.isPending || !editContent.trim()}
                      onClick={() => editMutation.mutate({ id: comment.id, nextContent: editContent.trim() })}
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="comment-body"
                    dangerouslySetInnerHTML={{ __html: parseMarkdown(comment.content) }}
                  />

                  {comment.attachments?.length ? (
                    <div className="comment-attachments">
                      {comment.attachments.map((attachment) => {
                        const mimeType = attachment.mime_type ?? 'application/octet-stream';
                        return (
                          <a
                            key={attachment.id}
                            href={attachment.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="comment-attachment-chip"
                            download
                          >
                            <AttachmentIcon mimeType={mimeType} />
                            <span className="att-filename" title={attachment.filename}>
                              {attachment.filename.length > 24 ? `${attachment.filename.slice(0, 21)}...` : attachment.filename}
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
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

          <div className="comment-composer-tabs">
            <button
              type="button"
              className={`composer-tab ${!showPreview ? 'active' : ''}`}
              onClick={() => setShowPreview(false)}
            >
              Escrever
            </button>
            <button
              type="button"
              className={`composer-tab ${showPreview ? 'active' : ''}`}
              onClick={() => setShowPreview(true)}
            >
              Pré-visualizar
            </button>
          </div>

          {showPreview ? (
            <div className="comment-preview">
              {comment.trim() ? (
                <div
                  className="comment-body preview"
                  dangerouslySetInnerHTML={{ __html: parseMarkdown(comment) }}
                />
              ) : (
                <p className="preview-empty">Nada para pré-visualizar</p>
              )}
            </div>
          ) : (
            <>
              <FormatToolbar textareaRef={textareaRef} />
              <textarea
                ref={textareaRef}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={isInternal ? 'Nota interna - não visível ao cliente...' : 'Comentário público - visível ao cliente...'}
                className="zd-textarea comment-textarea"
                rows={4}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  minHeight: 72,
                  lineHeight: 1.5,
                  marginBottom: 0,
                }}
              />
            </>
          )}

          <div className="composer-footer">
            <div className="composer-left">
              <button
                type="button"
                className="composer-action-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Anexar arquivo"
                aria-label="Anexar arquivo"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M12 6.5L6.5 12A3.5 3.5 0 012 7.5L7.5 2A2.5 2.5 0 0111 5.5L5.5 11A1.5 1.5 0 013.5 9L9 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  setCommentFiles((previous) => [...previous, ...files]);
                  event.target.value = '';
                }}
                style={{ display: 'none' }}
                aria-hidden="true"
              />

              {commentFiles.length > 0 ? (
                <div className="composer-files">
                  {commentFiles.map((file, index) => (
                    <span key={`${file.name}-${index}`} className="composer-file-chip">
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                        <path d="M2 1.5h5l2.5 2.5V9.5A.5.5 0 019 10H2a.5.5 0 01-.5-.5v-8A.5.5 0 012 1.5z" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M7 1.5v3h2.5" stroke="currentColor" strokeWidth="1.2" />
                      </svg>
                      {file.name.length > 16 ? `${file.name.slice(0, 13)}...` : file.name}
                      <button
                        type="button"
                        onClick={() => setCommentFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}
                        aria-label={`Remover ${file.name}`}
                      >
                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
                          <path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="composer-right">
              <span className="composer-shortcut">Ctrl+Enter para enviar</span>
              <button
                type="submit"
                className="zd-btn zd-btn-primary"
                disabled={submitMutation.isPending || (!comment.trim() && commentFiles.length === 0)}
              >
                {submitMutation.isPending ? t('tickets.comments.sending') : (isInternal ? 'Adicionar nota' : 'Comentar')}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

