import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { searchApi, type GlobalSearchResult } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { Skeleton } from './Skeleton';

type ResultType = 'contact' | 'ticket' | 'conversation';

interface FlatResult {
  key: string;
  type: ResultType;
  title: string;
  subtitle: string;
  href: string;
}

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
}

function iconPath(type: ResultType) {
  if (type === 'contact') {
    return <><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>;
  }
  if (type === 'ticket') {
    return <><path d="M4 6V4h2l12 12-2 2L4 6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M6 6h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>;
  }
  return <path d="M4 15V5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H9l-5 4v-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />;
}

function flatten(data: GlobalSearchResult | undefined): FlatResult[] {
  if (!data) return [];
  return [
    ...data.contacts.map((client) => ({
      key: `contact:${client.id}`,
      type: 'contact' as const,
      title: client.name,
      subtitle: client.email ?? client.phone ?? 'Contato',
      href: `/crm/contacts?id=${client.id}`,
    })),
    ...data.tickets.map((ticket) => ({
      key: `ticket:${ticket.id}`,
      type: 'ticket' as const,
      title: ticket.title,
      subtitle: `Ticket ${ticket.status}`,
      href: `/tickets/${ticket.id}`,
    })),
    ...data.conversations.map((conversation) => ({
      key: `conversation:${conversation.id}`,
      type: 'conversation' as const,
      title: conversation.contact_name ?? 'Contato não identificado',
      subtitle: conversation.last_message ?? 'Conversa',
      href: `/omnichannel/conversations?conversation=${conversation.id}`,
    })),
  ];
}

const GROUPS: Array<{ type: ResultType; label: string }> = [
  { type: 'contact', label: 'Contatos' },
  { type: 'ticket', label: 'Tickets' },
  { type: 'conversation', label: 'Conversas' },
];

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const debouncedQuery = useDebounce(query, 300);

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debouncedQuery],
    queryFn: () => searchApi.global(debouncedQuery, 5),
    enabled: open && debouncedQuery.trim().length > 0,
  });

  const results = useMemo(() => flatten(data), [data]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery]);

  if (!open) return null;

  function select(result: FlatResult) {
    navigate(result.href);
    onClose();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      select(results[activeIndex]);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--backdrop)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 'min(680px, calc(100vw - 32px))', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-pop)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--txt-3)' }} aria-hidden>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar contatos, tickets e conversas..."
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--txt)', fontSize: 15, fontFamily: 'var(--font)' }}
          />
          <span style={{ fontSize: 11, color: 'var(--txt-3)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px' }}>ESC</span>
        </div>

        <div style={{ maxHeight: 460, overflowY: 'auto', padding: 10 }}>
          {isFetching && (
            <div style={{ padding: 8 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10 }}>
                  <Skeleton style={{ width: 32, height: 32, borderRadius: 8 }} />
                  <div style={{ flex: 1 }}>
                    <Skeleton style={{ width: '45%', height: 12, marginBottom: 8 }} />
                    <Skeleton style={{ width: '70%', height: 10 }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isFetching && query.trim().length === 0 && (
            <div style={{ padding: 34, textAlign: 'center', color: 'var(--txt-3)', fontSize: 13 }}>Digite para buscar em todo o ZiraDesk</div>
          )}

          {!isFetching && query.trim().length > 0 && results.length === 0 && (
            <div style={{ padding: 34, textAlign: 'center' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Nada encontrado</div>
              <div style={{ color: 'var(--txt-3)', fontSize: 13 }}>Tente buscar por outro nome, assunto ou mensagem.</div>
            </div>
          )}

          {!isFetching && GROUPS.map((group) => {
            const groupResults = results.filter((item) => item.type === group.type);
            if (groupResults.length === 0) return null;
            return (
              <div key={group.type} style={{ paddingBottom: 8 }}>
                <div style={{ padding: '8px 10px 5px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', fontWeight: 700 }}>{group.label}</div>
                {groupResults.map((result) => {
                  const index = results.findIndex((item) => item.key === result.key);
                  const active = index === activeIndex;
                  return (
                    <button
                      key={result.key}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(result)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px', border: 'none', borderRadius: 'var(--r)', background: active ? 'var(--bg-4)' : 'transparent', color: 'var(--txt)', textAlign: 'left', cursor: 'pointer' }}
                    >
                      <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-3)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>{iconPath(result.type)}</svg>
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <strong style={{ display: 'block', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{result.title}</strong>
                        <span style={{ display: 'block', color: 'var(--txt-3)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{result.subtitle}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
