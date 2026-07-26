import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface Agent {
  id: string;
  name: string;
}

interface Props {
  agents: Agent[];
  /** id do agente selecionado, ou '' para "todos". */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}

const DROPDOWN_MAX_HEIGHT = 240;
const VIEWPORT_MARGIN = 8;

export function AgentCombobox({ agents, value, onChange, placeholder }: Props) {
  const { t } = useTranslation('tickets');

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedAgent = agents.find((agent) => agent.id === value);

  const filtered = query.trim()
    ? agents.filter((agent) => agent.name.toLowerCase().includes(query.trim().toLowerCase()))
    : agents;

  // O header do kanban vive sob .tickets-page-v2 { overflow: hidden }, que
  // recortaria um dropdown absoluto — daí portal + position: fixed.
  const updatePosition = useCallback(() => {
    const trigger = containerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const openUpward =
      window.innerHeight - rect.bottom < DROPDOWN_MAX_HEIGHT && rect.top > DROPDOWN_MAX_HEIGHT;

    setPosition({
      top: openUpward
        ? Math.max(VIEWPORT_MARGIN, rect.top - DROPDOWN_MAX_HEIGHT - 4)
        : rect.bottom + 4,
      left: Math.min(
        Math.max(VIEWPORT_MARGIN, rect.left),
        Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN),
      ),
      width: rect.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      close();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      containerRef.current?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, open]);

  const openDropdown = () => {
    setOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelect = (agent: Agent | null) => {
    onChange(agent?.id ?? '');
    close();
  };

  const allAgentsLabel = t('tickets.filters.allAgents');

  return (
    <div className="agent-combobox">
      <div
        ref={containerRef}
        className={`agent-combobox-trigger${open ? ' open' : ''}`}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="agent-combobox-list"
        tabIndex={0}
        onClick={() => { if (!open) openDropdown(); }}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            event.preventDefault();
            openDropdown();
          }
        }}
      >
        {open ? (
          <input
            ref={inputRef}
            className="agent-combobox-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={selectedAgent?.name ?? placeholder ?? t('tickets.filters.searchAgent')}
            aria-label={t('tickets.filters.searchAgent')}
          />
        ) : (
          <span className={`agent-combobox-value${value ? '' : ' placeholder'}`}>
            {selectedAgent?.name ?? placeholder ?? allAgentsLabel}
          </span>
        )}
        <svg className="agent-combobox-chevron" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && position ? createPortal(
        <div
          ref={dropdownRef}
          id="agent-combobox-list"
          className="agent-combobox-dropdown"
          role="listbox"
          style={{ position: 'fixed', top: position.top, left: position.left, width: position.width }}
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className={`agent-combobox-option${value ? '' : ' selected'}`}
            onMouseDown={() => handleSelect(null)}
          >
            {allAgentsLabel}
          </button>

          {filtered.length === 0 ? (
            <div className="agent-combobox-empty">{t('tickets.filters.noAgentsFound')}</div>
          ) : (
            filtered.map((agent) => (
              <button
                key={agent.id}
                type="button"
                role="option"
                aria-selected={value === agent.id}
                className={`agent-combobox-option${value === agent.id ? ' selected' : ''}`}
                onMouseDown={() => handleSelect(agent)}
              >
                <span className="agent-combobox-avatar" aria-hidden>
                  {agent.name.slice(0, 2).toUpperCase()}
                </span>
                {agent.name}
              </button>
            ))
          )}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
