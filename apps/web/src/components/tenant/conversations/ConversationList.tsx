import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { useDebounce } from '../../../hooks/useDebounce';
import { Badge } from '../../ui/Badge';

interface ConversationItem {
  id: string;
  status: string;
  channel_type: string;
  subject: string | null;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
  client_name: string | null;
  client_email: string | null;
  assigned_name: string | null;
  channel_name: string | null;
}

type StatusFilter = '' | 'open' | 'in_service' | 'resolved';

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'open', label: 'Abertos' },
  { value: 'in_service', label: 'Em atendimento' },
  { value: 'resolved', label: 'Resolvidos' },
];

const CHANNEL_VARIANT: Record<string, 'success' | 'info' | 'neutral'> = {
  whatsapp: 'success',
  email: 'info',
  live_chat: 'neutral',
};

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function statusDot(status: string) {
  const colors: Record<string, string> = {
    open: '#F59E0B',
    in_service: '#00C9A7',
    resolved: '#5C6370',
  };
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: colors[status] ?? '#5C6370' }}
    />
  );
}

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ selectedId, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', { status, search: debouncedSearch }],
    queryFn: async () => {
      const params = new URLSearchParams({ perPage: '50' });
      if (status) params.set('status', status);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await api.get<{ success: boolean; data: ConversationItem[] }>(
        `/tenant/conversations?${params}`,
      );
      return res.data.data;
    },
    staleTime: 30_000,
  });

  return (
    <div className="flex w-[280px] shrink-0 flex-col border-r border-line bg-bg-2">
      {/* Search */}
      <div className="border-b border-line p-3">
        <input
          type="text"
          placeholder="Buscar conversas..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-line-2 bg-bg-4 px-3 py-2 text-sm text-txt placeholder-txt-3 focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
        />
      </div>

      {/* Status tabs */}
      <div className="flex gap-0.5 border-b border-line p-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatus(tab.value)}
            className={[
              'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              status === tab.value ? 'bg-teal-dim text-teal' : 'text-txt-3 hover:text-txt-2',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-b border-line px-4 py-3">
                <div className="mb-2 h-4 w-32 animate-pulse rounded bg-bg-3" />
                <div className="h-3 w-48 animate-pulse rounded bg-bg-3" />
              </div>
            ))
          : (data ?? []).length === 0
          ? (
              <div className="py-12 text-center text-sm text-txt-3">
                Nenhuma conversa encontrada
              </div>
            )
          : (data ?? []).map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={[
                  'w-full border-b border-line px-4 py-3 text-left transition-colors hover:bg-bg-3',
                  selectedId === conv.id ? 'bg-bg-3' : '',
                ].join(' ')}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {statusDot(conv.status)}
                    <span className="truncate text-sm font-medium text-txt">
                      {conv.client_name ?? 'Visitante'}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant={CHANNEL_VARIANT[conv.channel_type] ?? 'neutral'}>
                      {conv.channel_type}
                    </Badge>
                    <span className="text-xs text-txt-3">
                      {relativeTime(conv.last_message_at ?? conv.created_at)}
                    </span>
                  </div>
                </div>
                <p className="truncate text-xs text-txt-3">
                  {conv.last_message ?? conv.subject ?? '—'}
                </p>
              </button>
            ))}
      </div>
    </div>
  );
}
