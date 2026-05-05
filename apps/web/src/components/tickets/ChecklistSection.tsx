import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsApi, type TicketChecklistItem } from '../../services/api';

interface ChecklistSectionProps {
  ticketId: string;
}

export default function ChecklistSection({ ticketId }: ChecklistSectionProps) {
  const queryClient = useQueryClient();
  const [newItem, setNewItem] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: items = [] } = useQuery<TicketChecklistItem[]>({
    queryKey: ['ticket-checklist', ticketId],
    queryFn: () => ticketsApi.listChecklist(ticketId),
    enabled: !!ticketId,
  });

  const doneCount = items.filter((item) => item.is_done).length;
  const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  const addMutation = useMutation({
    mutationFn: (title: string) => ticketsApi.addChecklist(ticketId, title),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ticket-checklist', ticketId] });
      setNewItem('');
      inputRef.current?.focus();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ itemId, isDone }: { itemId: string; isDone: boolean }) =>
      ticketsApi.updateChecklist(ticketId, itemId, { is_done: isDone }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ticket-checklist', ticketId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => ticketsApi.deleteChecklist(ticketId, itemId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ticket-checklist', ticketId] });
    },
  });

  function handleAdd() {
    if (!newItem.trim()) return;
    addMutation.mutate(newItem.trim());
  }

  return (
    <div className="ticket-section">
      <div className="ticket-section-header">
        <span className="ticket-section-title">☑️ Checklist</span>
        {items.length > 0 ? (
          <span className="checklist-progress-text">{doneCount}/{items.length} ({progress}%)</span>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="checklist-progress-bar">
          <div
            className="checklist-progress-fill"
            style={{
              width: `${progress}%`,
              background: progress === 100 ? 'var(--green)' : 'var(--teal)',
            }}
          />
        </div>
      ) : null}

      <div className="checklist-items">
        {items.map((item) => (
          <div key={item.id} className="checklist-item">
            <input
              type="checkbox"
              checked={item.is_done}
              onChange={(e) => {
                toggleMutation.mutate({ itemId: item.id, isDone: e.target.checked });
              }}
              className="checklist-checkbox"
            />
            <span className={`checklist-label ${item.is_done ? 'done' : ''}`}>
              {item.title}
            </span>
            {item.is_done && item.done_by_name ? (
              <span className="checklist-done-by" title={item.done_at ?? undefined}>
                ✓ {item.done_by_name}
              </span>
            ) : null}
            <button
              type="button"
              className="checklist-delete"
              onClick={() => deleteMutation.mutate(item.id)}
              aria-label="Remover item"
              title="Remover item"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {isAdding ? (
        <div className="checklist-add">
          <input
            ref={inputRef}
            autoFocus
            placeholder="Descrição da tarefa..."
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') {
                setIsAdding(false);
                setNewItem('');
              }
            }}
            className="checklist-input"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newItem.trim() || addMutation.isPending}
            className="zd-btn zd-btn-primary"
          >
            Adicionar
          </button>
          <button
            type="button"
            onClick={() => {
              setIsAdding(false);
              setNewItem('');
            }}
            className="zd-btn"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="checklist-add-trigger"
          onClick={() => setIsAdding(true)}
        >
          + Adicionar tarefa
        </button>
      )}
    </div>
  );
}
