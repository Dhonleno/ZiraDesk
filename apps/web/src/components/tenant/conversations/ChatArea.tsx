import { useRef, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { Badge } from '../../ui/Badge';
import { useToast } from '../../../stores/toast.store';

interface Message {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  content: string;
  content_type: string;
  status: string;
  is_internal: boolean;
  created_at: string;
}

interface Conversation {
  id: string;
  status: string;
  channel_type: string;
  client_name: string | null;
  assigned_name: string | null;
  subject: string | null;
  created_at: string;
  resolved_at: string | null;
}

const STATUS_VARIANT: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  open: 'warning',
  in_service: 'success',
  resolved: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Aberto',
  in_service: 'Em atendimento',
  resolved: 'Resolvido',
};

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  conversationId: string;
}

export function ChatArea({ conversationId }: Props) {
  const [content, setContent] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { conversation: Conversation; messages: Message[] };
      }>(`/tenant/conversations/${conversationId}`);
      return res.data.data;
    },
  });

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages]);

  const sendMutation = useMutation({
    mutationFn: async (text: string) =>
      api.post(`/tenant/conversations/${conversationId}/messages`, {
        content: text,
        contentType: 'text',
      }),
    onSuccess: () => {
      setContent('');
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: () => toast.error('Erro ao enviar mensagem'),
  });

  const resolveMutation = useMutation({
    mutationFn: async () =>
      api.patch(`/tenant/conversations/${conversationId}`, { status: 'resolved' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Conversa marcada como resolvida');
    },
    onError: () => toast.error('Erro ao atualizar conversa'),
  });

  function handleSend() {
    const text = content.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }

  const conv = data?.conversation;
  const messages = data?.messages ?? [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-bg-4 text-xs font-bold text-txt-2">
            {(conv?.client_name ?? 'V').charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium text-txt">{conv?.client_name ?? 'Visitante'}</p>
            {conv && (
              <Badge variant={STATUS_VARIANT[conv.status] ?? 'neutral'}>
                {STATUS_LABEL[conv.status] ?? conv.status}
              </Badge>
            )}
          </div>
        </div>
        {conv && conv.status !== 'resolved' && (
          <button
            onClick={() => resolveMutation.mutate()}
            disabled={resolveMutation.isPending}
            className="rounded-lg border border-line-2 bg-bg-4 px-3 py-1.5 text-xs font-medium text-txt-2 transition-colors hover:bg-bg-5 hover:text-txt disabled:opacity-50"
          >
            Marcar como resolvida
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-txt-3">Nenhuma mensagem ainda</p>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg) => {
              const isAgent = msg.sender_type === 'agent';
              return (
                <div key={msg.id} className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'}`}>
                  <div
                    className={[
                      'max-w-[70%] rounded-2xl px-4 py-2 text-sm',
                      isAgent
                        ? 'rounded-tr-sm bg-teal text-bg'
                        : 'rounded-tl-sm border border-line bg-bg-3 text-txt',
                    ].join(' ')}
                  >
                    {msg.content}
                  </div>
                  <span className={`mt-0.5 text-xs text-txt-3 ${isAgent ? 'text-right' : 'text-left'}`}>
                    {formatTime(msg.created_at)}
                  </span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-line p-4">
        <div className="flex gap-3">
          <textarea
            rows={2}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escreva uma mensagem... (Ctrl+Enter para enviar)"
            disabled={conv?.status === 'resolved'}
            className="flex-1 resize-none rounded-lg border border-line-2 bg-bg-4 px-3 py-2 text-sm text-txt placeholder-txt-3 focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!content.trim() || sendMutation.isPending || conv?.status === 'resolved'}
            className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-lg bg-teal text-bg transition-colors hover:bg-teal-hover disabled:opacity-40"
            aria-label="Enviar"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
              <path
                d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
