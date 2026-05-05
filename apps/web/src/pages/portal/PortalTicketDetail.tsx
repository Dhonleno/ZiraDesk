import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { portalApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

export function PortalTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');

  const { data: ticket } = useQuery({
    queryKey: ['portal-ticket', id],
    queryFn: () => portalApi.getTicket(id!),
    enabled: !!id,
  });

  const addCommentMutation = useMutation({
    mutationFn: (content: string) => portalApi.addComment(id!, content),
    onSuccess: async () => {
      setComment('');
      await queryClient.invalidateQueries({ queryKey: ['portal-ticket', id] });
      toast.success('Comentário adicionado');
    },
    onError: () => toast.error('Erro ao adicionar comentário'),
  });

  if (!ticket) return null;

  return (
    <div className="portal-section">
      <Link to="/portal/tickets" className="portal-back-link">← Voltar para tickets</Link>

      <div className="portal-ticket-detail-header">
        <h2>{ticket.title}</h2>
        <span className={`portal-status portal-status-${ticket.status}`}>{ticket.status}</span>
      </div>

      <div className="portal-ticket-detail-grid">
        <div><strong>Tipo:</strong> {ticket.type_icon ?? '🎫'} {ticket.type_name ?? '—'}</div>
        <div><strong>Prioridade:</strong> {ticket.priority}</div>
        <div><strong>Responsável:</strong> {ticket.assigned_name ?? 'Não atribuído'}</div>
        <div><strong>Abertura:</strong> {new Date(ticket.created_at).toLocaleString('pt-BR')}</div>
      </div>

      <div className="portal-description">
        <h3>Descrição</h3>
        <p>{ticket.description || 'Sem descrição'}</p>
      </div>

      <div className="portal-comments">
        <h3>Comentários</h3>
        {ticket.comments.map((item) => (
          <div key={item.id} className="portal-comment-item">
            <div className="portal-comment-head">
              <strong>{item.user_name ?? 'Equipe'}</strong>
              <span>{new Date(item.created_at).toLocaleString('pt-BR')}</span>
            </div>
            <p>{item.content}</p>
          </div>
        ))}
        {ticket.comments.length === 0 ? <p className="portal-empty">Nenhum comentário ainda</p> : null}
      </div>

      <div className="portal-comment-form">
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Adicionar comentário"
          rows={4}
        />
        <button
          type="button"
          className="portal-btn-primary portal-btn-inline"
          disabled={!comment.trim() || addCommentMutation.isPending}
          onClick={() => addCommentMutation.mutate(comment.trim())}
        >
          Adicionar comentário
        </button>
      </div>
    </div>
  );
}
