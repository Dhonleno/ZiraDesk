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

function normalizeEditorHtml(value: string): string {
  return value
    .replace(/<div><br><\/div>/gi, '<br>')
    .replace(/<\/div><div>/gi, '<br>')
    .replace(/<div>/gi, '')
    .replace(/<\/div>/gi, '')
    .replace(/&nbsp;/gi, ' ');
}

function extractPlainTextFromHtml(value: string): string {
  if (typeof window === 'undefined') {
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const container = document.createElement('div');
  container.innerHTML = value;
  return (container.textContent ?? '').replace(/\u00a0/g, ' ').trim();
}

function serializeChildrenToMarkdown(node: Node): string {
  return Array.from(node.childNodes).map(serializeNodeToMarkdown).join('');
}

function serializeNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\u00a0/g, ' ');
  }

  if (!(node instanceof HTMLElement)) return '';

  const content = serializeChildrenToMarkdown(node);
  const tagName = node.tagName.toLowerCase();

  if (tagName === 'strong' || tagName === 'b') return `**${content}**`;
  if (tagName === 'em' || tagName === 'i') return `_${content}_`;
  if (tagName === 'del' || tagName === 'strike' || tagName === 's') return `~~${content}~~`;
  if (tagName === 'code') return `\`${content}\``;
  if (tagName === 'a') {
    const href = node.getAttribute('href')?.trim();
    return href ? `[${content}](${href})` : content;
  }
  if (tagName === 'blockquote') {
    const quoted = content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => `> ${line}`)
      .join('\n');
    return quoted ? `${quoted}\n` : '';
  }
  if (tagName === 'ul') {
    const items = Array.from(node.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((child) => `- ${serializeChildrenToMarkdown(child).trim()}`);
    return items.length ? `${items.join('\n')}\n` : '';
  }
  if (tagName === 'ol') {
    const items = Array.from(node.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((child, index) => `${index + 1}. ${serializeChildrenToMarkdown(child).trim()}`);
    return items.length ? `${items.join('\n')}\n` : '';
  }
  if (tagName === 'li') return content;
  if (tagName === 'br') return '\n';
  if (tagName === 'div' || tagName === 'p') return `${content}\n`;

  return content;
}

function editorHtmlToMarkdown(value: string): string {
  if (!value.trim()) return '';
  if (typeof window === 'undefined') return value;

  const container = document.createElement('div');
  container.innerHTML = value;

  return Array.from(container.childNodes)
    .map(serializeNodeToMarkdown)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function unwrapElement(element: HTMLElement) {
  const parent = element.parentNode;
  if (!parent) return;

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

function FormatToolbar({
  editorRef,
  onChange,
  floating = false,
}: {
  editorRef: RefObject<HTMLDivElement | null>;
  onChange: (value: string) => void;
  floating?: boolean;
}) {
  const syncEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(normalizeEditorHtml(editor.innerHTML));
    editor.focus();
  };

  const applyExecCommand = (command: 'bold' | 'italic' | 'strikeThrough') => {
    const editor = editorRef.current;
    if (!editor) return;
    if (document.activeElement !== editor) editor.focus();
    document.execCommand(command, false);
    syncEditor();
  };

  const applyListCommand = (command: 'insertUnorderedList' | 'insertOrderedList') => {
    const editor = editorRef.current;
    if (!editor) return;
    if (document.activeElement !== editor) editor.focus();
    document.execCommand(command, false);
    syncEditor();
  };

  const applyBlockquote = () => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      editor.focus();
      return;
    }

    const anchorElement = selection.anchorNode instanceof HTMLElement
      ? selection.anchorNode
      : selection.anchorNode?.parentElement ?? null;
    const focusElement = selection.focusNode instanceof HTMLElement
      ? selection.focusNode
      : selection.focusNode?.parentElement ?? null;
    const sharedQuote = anchorElement?.closest('blockquote');

    if (sharedQuote && sharedQuote === focusElement?.closest('blockquote')) {
      unwrapElement(sharedQuote);
      syncEditor();
      return;
    }

    document.execCommand('formatBlock', false, 'blockquote');
    syncEditor();
  };

  const applyLink = () => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      editor.focus();
      return;
    }

    const anchorElement = selection.anchorNode instanceof HTMLElement
      ? selection.anchorNode
      : selection.anchorNode?.parentElement ?? null;
    const focusElement = selection.focusNode instanceof HTMLElement
      ? selection.focusNode
      : selection.focusNode?.parentElement ?? null;
    const sharedLink = anchorElement?.closest('a');

    if (sharedLink && sharedLink === focusElement?.closest('a')) {
      document.execCommand('unlink', false);
      syncEditor();
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      editor.focus();
      return;
    }

    const hrefInput = window.prompt('Informe a URL do link', 'https://');
    if (!hrefInput) {
      editor.focus();
      return;
    }

    const href = hrefInput.trim();
    if (!href) {
      editor.focus();
      return;
    }

    document.execCommand('createLink', false, href);
    syncEditor();
  };

  const applyCodeFormat = () => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      editor.focus();
      return;
    }

    const range = selection.getRangeAt(0);
    const anchorElement = selection.anchorNode instanceof HTMLElement
      ? selection.anchorNode
      : selection.anchorNode?.parentElement ?? null;
    const focusElement = selection.focusNode instanceof HTMLElement
      ? selection.focusNode
      : selection.focusNode?.parentElement ?? null;
    const sharedCode = anchorElement?.closest('code');

    if (sharedCode && sharedCode === focusElement?.closest('code')) {
      unwrapElement(sharedCode);
      syncEditor();
      return;
    }

    const extracted = range.extractContents();
    if (!extracted.textContent?.trim()) {
      range.insertNode(extracted);
      editor.focus();
      return;
    }

    const code = document.createElement('code');
    code.appendChild(extracted);
    range.insertNode(code);
    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(code);
    selection.addRange(nextRange);
    syncEditor();
  };

  const tools: Array<{ label: string; action: 'bold' | 'italic' | 'code' | 'strike' | 'bullet' | 'number' | 'quote' | 'link'; icon: ReactNode }> = [
    {
      label: 'Negrito',
      action: 'bold',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M3.5 2.5H7a2 2 0 010 4H3.5V2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M3.5 6.5H7.5a2.5 2.5 0 010 5H3.5V6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: 'Itálico',
      action: 'italic',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M5 2.5h5M3 10.5h5M7.5 2.5L5.5 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      label: 'Código',
      action: 'code',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M4.5 4L1.5 6.5 4.5 9M8.5 4L11.5 6.5 8.5 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: 'Tachado',
      action: 'strike',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M2 6.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M4.5 3.5C4.5 3.5 5 2 6.5 2s2.5 1 2.5 2-1 1.5-2.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M4 9c0 1 1 2 2.5 2s2.5-1 2.5-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      label: 'Lista',
      action: 'bullet',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <circle cx="2.5" cy="3.2" r=".8" fill="currentColor" />
          <circle cx="2.5" cy="6.5" r=".8" fill="currentColor" />
          <circle cx="2.5" cy="9.8" r=".8" fill="currentColor" />
          <path d="M5 3.2h5.5M5 6.5h5.5M5 9.8h5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      label: 'Lista numerada',
      action: 'number',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M1.8 2.8h1v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M1.6 6.1c.2-.4.6-.7 1.1-.7.7 0 1.2.4 1.2 1 0 .4-.2.7-.6 1L1.8 8.6h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M1.8 10.2h1c.5 0 .8-.2.8-.6s-.3-.7-.8-.7h-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.2 3.2h5.2M5.2 6.5h5.2M5.2 9.8h5.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      label: 'Citação',
      action: 'quote',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M4.8 4.2H3.3c-.7 0-1.2.5-1.2 1.2v1.3c0 .7.5 1.2 1.2 1.2h1.5c.7 0 1.2-.5 1.2-1.2V5.4c0-.7-.5-1.2-1.2-1.2Z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M10 4.2H8.5c-.7 0-1.2.5-1.2 1.2v1.3c0 .7.5 1.2 1.2 1.2H10c.7 0 1.2-.5 1.2-1.2V5.4c0-.7-.5-1.2-1.2-1.2Z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4.2 4.2V3.6c0-.7.5-1.3 1.2-1.4M9.4 4.2V3.6c0-.7.5-1.3 1.2-1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      label: 'Link',
      action: 'link',
      icon: (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M5.2 7.8 7.8 5.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M4.2 8.8H3.5A2 2 0 1 1 3.5 4h1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M8.8 4.2h.7A2 2 0 1 1 9.5 9H8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  return (
    <div className={`format-toolbar${floating ? ' floating' : ''}`}>
      {tools.map((tool) => (
        <button
          key={tool.label}
          type="button"
          className="format-btn"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (tool.action === 'bold') applyExecCommand('bold');
            if (tool.action === 'italic') applyExecCommand('italic');
            if (tool.action === 'strike') applyExecCommand('strikeThrough');
            if (tool.action === 'code') applyCodeFormat();
            if (tool.action === 'bullet') applyListCommand('insertUnorderedList');
            if (tool.action === 'number') applyListCommand('insertOrderedList');
            if (tool.action === 'quote') applyBlockquote();
            if (tool.action === 'link') applyLink();
          }}
          title={tool.label}
          aria-label={tool.label}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}

export function TicketComments({ ticketId }: Props) {
  const { t } = useTranslation('tickets');
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const bottomRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editorHtml, setEditorHtml] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [selectionToolbar, setSelectionToolbar] = useState<{ visible: boolean; top: number; left: number }>({
    visible: false,
    top: 0,
    left: 0,
  });
  const comment = editorHtmlToMarkdown(editorHtml);
  const hasCommentContent = extractPlainTextFromHtml(editorHtml).length > 0;

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

  useEffect(() => {
    const updateSelectionToolbar = () => {
      const editor = editorRef.current;
      if (!editor) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setSelectionToolbar((current) => (current.visible ? { ...current, visible: false } : current));
        return;
      }

      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if (!anchorNode || !focusNode || !editor.contains(anchorNode) || !editor.contains(focusNode)) {
        setSelectionToolbar((current) => (current.visible ? { ...current, visible: false } : current));
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSelectionToolbar((current) => (current.visible ? { ...current, visible: false } : current));
        return;
      }

      setSelectionToolbar({
        visible: true,
        top: Math.max(16, rect.top - 46),
        left: rect.left + (rect.width / 2),
      });
    };

    document.addEventListener('selectionchange', updateSelectionToolbar);
    window.addEventListener('resize', updateSelectionToolbar);
    window.addEventListener('scroll', updateSelectionToolbar, true);

    return () => {
      document.removeEventListener('selectionchange', updateSelectionToolbar);
      window.removeEventListener('resize', updateSelectionToolbar);
      window.removeEventListener('scroll', updateSelectionToolbar, true);
    };
  }, []);

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
      setEditorHtml('');
      setIsInternal(false);
      setCommentFiles([]);
      setSelectionToolbar({ visible: false, top: 0, left: 0 });
      if (editorRef.current) editorRef.current.innerHTML = '';
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

          <div className="comment-editor-shell">
            <div className="comment-editor-head">
              <span className="comment-editor-title">{isInternal ? 'Nota interna' : 'Comentário público'}</span>
              <span className={`comment-editor-visibility ${isInternal ? 'internal' : 'public'}`}>
                {isInternal ? 'Apenas equipe' : 'Visível ao cliente'}
              </span>
            </div>

            {selectionToolbar.visible ? (
              <div
                className="comment-selection-toolbar"
                style={{ top: selectionToolbar.top, left: selectionToolbar.left }}
              >
                <FormatToolbar editorRef={editorRef} onChange={setEditorHtml} floating />
              </div>
            ) : null}

            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              data-placeholder={isInternal ? 'Nota interna - não visível ao cliente...' : 'Comentário público - visível ao cliente...'}
              className="comment-rich-editor"
              onInput={(event) => {
                const value = normalizeEditorHtml(event.currentTarget.innerHTML);
                if (!extractPlainTextFromHtml(value)) {
                  event.currentTarget.innerHTML = '';
                  setEditorHtml('');
                  setSelectionToolbar({ visible: false, top: 0, left: 0 });
                  return;
                }
                setEditorHtml(value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void handleSubmit();
                }

                if (event.key.toLowerCase() === 'b' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  document.execCommand('bold', false);
                  setEditorHtml(normalizeEditorHtml(event.currentTarget.innerHTML));
                }

                if (event.key.toLowerCase() === 'i' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  document.execCommand('italic', false);
                  setEditorHtml(normalizeEditorHtml(event.currentTarget.innerHTML));
                }
              }}
            />
          </div>

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
                disabled={submitMutation.isPending || (!hasCommentContent && commentFiles.length === 0)}
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
