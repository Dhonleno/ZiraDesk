import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { Badge } from '../../ui/Badge';

interface Conversation {
  id: string;
  status: string;
  channel_type: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  assigned_name: string | null;
  channel_name: string | null;
  subject: string | null;
  created_at: string;
  resolved_at: string | null;
}

const CHANNEL_VARIANT: Record<string, 'success' | 'info' | 'neutral'> = {
  whatsapp: 'success',
  email: 'info',
  live_chat: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Aberto',
  in_service: 'Em atendimento',
  resolved: 'Resolvido',
};

interface Props {
  conversationId: string;
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1.5 text-sm">
      <span className="mt-0.5 shrink-0 text-txt-3">{icon}</span>
      <div>
        <p className="text-xs text-txt-3">{label}</p>
        <p className="text-txt-2">{value}</p>
      </div>
    </div>
  );
}

export function InfoPanel({ conversationId }: Props) {
  const { data } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { conversation: Conversation; messages: unknown[] };
      }>(`/tenant/conversations/${conversationId}`);
      return res.data.data;
    },
  });

  const conv = data?.conversation;

  return (
    <div className="flex w-[300px] shrink-0 flex-col border-l border-line bg-bg-2 overflow-y-auto">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center border-b border-line px-4">
        <p className="text-sm font-medium text-txt">Informações</p>
      </div>

      <div className="p-4 space-y-5">
        {/* Contact */}
        <div>
          <div className="mb-3 flex flex-col items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-4 text-lg font-bold text-txt-2">
              {(conv?.client_name ?? 'V').charAt(0).toUpperCase()}
            </div>
            <p className="mt-2 text-sm font-medium text-txt">
              {conv?.client_name ?? 'Visitante desconhecido'}
            </p>
          </div>

          <InfoRow
            icon={
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="22,6 12,13 2,6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            label="E-mail"
            value={conv?.client_email}
          />
          <InfoRow
            icon={
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.22 1.18 2 2 0 012.18 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.18 6.18l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            label="Telefone"
            value={conv?.client_phone}
          />
        </div>

        <div className="border-t border-line" />

        {/* Channel & status */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-txt-3 uppercase tracking-wide">Canal</p>
          {conv && (
            <Badge variant={CHANNEL_VARIANT[conv.channel_type] ?? 'neutral'}>
              {conv.channel_name ?? conv.channel_type}
            </Badge>
          )}
        </div>

        <div className="border-t border-line" />

        {/* Metadata */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-txt-3 uppercase tracking-wide">Conversa</p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-txt-3">Status</span>
            <span className="text-txt-2">{conv ? (STATUS_LABEL[conv.status] ?? conv.status) : '—'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-txt-3">Agente</span>
            <span className="text-txt-2">{conv?.assigned_name ?? 'Não atribuído'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-txt-3">Criado em</span>
            <span className="text-txt-2">
              {conv ? new Date(conv.created_at).toLocaleDateString('pt-BR') : '—'}
            </span>
          </div>
          {conv?.resolved_at && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-txt-3">Resolvido em</span>
              <span className="text-txt-2">
                {new Date(conv.resolved_at).toLocaleDateString('pt-BR')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
