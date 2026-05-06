import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminApi,
  contactsApi,
  organizationsApi,
  ticketsApi,
  type CrmContact,
  type CrmOrganization,
  type CreateTicketPayload,
  type TicketPriority,
  type TicketStatus,
} from '../../services/api';
import { PageShell } from '../../components/layout/PageShell';
import { useToast } from '../../stores/toast.store';

interface CreateTicketForm {
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  type_id: string;
  contact_id: string;
  organization_id: string;
  assigned_to: string;
  category: string;
  due_date: string;
  tags: string[];
}

export default function CreateTicket() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();

  const [form, setForm] = useState<CreateTicketForm>({
    title: searchParams.get('title') ?? '',
    description: '',
    status: 'open',
    priority: 'medium',
    type_id: '',
    contact_id: searchParams.get('contact_id') ?? '',
    organization_id: searchParams.get('org_id') ?? '',
    assigned_to: '',
    category: '',
    due_date: '',
    tags: [],
  });

  const [contactSearch, setContactSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [contactName, setContactName] = useState(searchParams.get('contact_name') ?? '');
  const [orgName, setOrgName] = useState(searchParams.get('org_name') ?? '');

  const { data: ticketTypes = [] } = useQuery({
    queryKey: ['ticket-types'],
    queryFn: adminApi.ticketTypes.list,
    staleTime: 60_000,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['create-ticket-agents'],
    queryFn: () => adminApi.listUsers({ per_page: 100, status: 'active' }),
    staleTime: 60_000,
  });
  const agents = agentsData?.data ?? [];

  const { data: contactsData } = useQuery({
    queryKey: ['create-ticket-contacts-search', contactSearch],
    queryFn: () => contactsApi.list({ search: contactSearch, per_page: 10 }),
    enabled: contactSearch.length >= 2,
    staleTime: 10_000,
  });
  const contacts = contactsData?.data ?? [];

  const { data: orgsData } = useQuery({
    queryKey: ['create-ticket-orgs-search', orgSearch],
    queryFn: () => organizationsApi.list({ search: orgSearch, per_page: 10 }),
    enabled: orgSearch.length >= 2,
    staleTime: 10_000,
  });
  const orgs = orgsData?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: CreateTicketPayload = {
        title: form.title.trim(),
        status: form.status,
        priority: form.priority,
      };
      const description = form.description.trim();
      const category = form.category.trim();
      if (description) payload.description = description;
      if (form.type_id) payload.type_id = form.type_id;
      if (form.contact_id) payload.contact_id = form.contact_id;
      if (form.organization_id) payload.organization_id = form.organization_id;
      if (form.assigned_to) payload.assigned_to = form.assigned_to;
      if (form.due_date) payload.due_date = new Date(form.due_date).toISOString();
      if (category) payload.category = category;
      if (form.tags.length > 0) payload.tags = form.tags;
      return ticketsApi.create(payload);
    },
    onSuccess: (ticket) => {
      toast.success('Ticket criado com sucesso!');
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      void qc.invalidateQueries({ queryKey: ['ticket-stats'] });
      navigate(`/tickets/${ticket.id}`);
    },
    onError: () => {
      toast.error('Erro ao criar ticket');
    },
  });

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Título é obrigatório');
      return;
    }
    createMutation.mutate();
  };

  const handleAddTag = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !tagInput.trim()) return;
    e.preventDefault();
    const trimmed = tagInput.trim();
    if (!form.tags.includes(trimmed)) {
      setForm((prev) => ({ ...prev, tags: [...prev.tags, trimmed] }));
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setForm((prev) => ({ ...prev, tags: prev.tags.filter((item) => item !== tag) }));
  };

  const handleContactSelect = (contact: CrmContact) => {
    setForm((prev) => ({
      ...prev,
      contact_id: contact.id,
      organization_id: contact.organization_id || prev.organization_id,
    }));
    setContactName(contact.name);
    if (contact.organization_name) setOrgName(contact.organization_name);
    setContactSearch('');
  };

  const handleOrganizationSelect = (org: CrmOrganization) => {
    setForm((prev) => ({ ...prev, organization_id: org.id }));
    setOrgName(org.name);
    setOrgSearch('');
  };

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <form className="create-ticket-page" onSubmit={handleSubmit}>
        <div className="create-ticket-header">
          <button type="button" className="back-btn" onClick={() => navigate('/tickets')}>
            Voltar
          </button>

          <h1>Criar ticket</h1>

          <div className="header-actions">
            <button
              type="button"
              className="create-ticket-btn create-ticket-btn-ghost"
              onClick={() => navigate('/tickets')}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="create-ticket-btn create-ticket-btn-primary"
              disabled={createMutation.isPending || !form.title.trim()}
            >
              {createMutation.isPending ? 'Salvando...' : 'Criar ticket'}
            </button>
          </div>
        </div>

        <div className="create-ticket-layout">
          <div className="create-ticket-main">
          <div className="ct-field">
            <label className="ct-label" htmlFor="ct-title">
              Título <span className="required">*</span>
            </label>
            <input
              id="ct-title"
              autoFocus
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Descreva o problema ou solicitação..."
              className="ct-input ct-input-lg"
            />
          </div>

          <div className="ct-field">
            <label className="ct-label" htmlFor="ct-description">Descrição</label>
            <textarea
              id="ct-description"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Adicione detalhes, passos para reproduzir e contexto..."
              className="ct-textarea"
              rows={10}
            />
          </div>

          <div className="ct-field">
            <label className="ct-label" htmlFor="ct-tags">Tags</label>
            <div className="ct-tags-input">
              {form.tags.map((tag) => (
                <span key={tag} className="ct-tag">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} aria-label={`Remover tag ${tag}`}>
                    ×
                  </button>
                </span>
              ))}
              <input
                id="ct-tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                placeholder={form.tags.length ? '' : 'Digite e pressione Enter...'}
                className="ct-tags-field"
              />
            </div>
          </div>
        </div>

          <aside className="create-ticket-sidebar">
          <div className="ct-field">
            <label className="ct-label" htmlFor="ct-type">Tipo</label>
            <select
              id="ct-type"
              value={form.type_id}
              onChange={(e) => setForm((prev) => ({ ...prev, type_id: e.target.value }))}
              className="ct-select"
            >
              <option value="">Selecione o tipo</option>
              {ticketTypes.filter((type) => type.is_active).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.icon} {type.name}
                </option>
              ))}
            </select>
          </div>

          <div className="ct-row-2">
            <div className="ct-field">
              <label className="ct-label" htmlFor="ct-priority">Prioridade</label>
              <select
                id="ct-priority"
                value={form.priority}
                onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value as TicketPriority }))}
                className="ct-select"
              >
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <div className="ct-field">
              <label className="ct-label" htmlFor="ct-status">Status</label>
              <select
                id="ct-status"
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as TicketStatus }))}
                className="ct-select"
              >
                <option value="open">Aberto</option>
                <option value="in_progress">Em andamento</option>
                <option value="waiting">Aguardando</option>
              </select>
            </div>
          </div>

          <div className="ct-field">
            <label className="ct-label" htmlFor="ct-contact">Contato</label>
            {form.contact_id && contactName ? (
              <div className="ct-selected-item">
                <span>{contactName}</span>
                <button
                  type="button"
                  onClick={() => {
                    setForm((prev) => ({ ...prev, contact_id: '' }));
                    setContactName('');
                  }}
                  aria-label="Remover contato"
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="ct-search-field">
                <input
                  id="ct-contact"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Buscar contato..."
                  className="ct-input"
                />

                {contacts.length > 0 && contactSearch.length >= 2 && (
                  <div className="ct-dropdown">
                    {contacts.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        className="ct-dropdown-item"
                        onClick={() => handleContactSelect(contact)}
                      >
                        <span className="ct-dropdown-name">{contact.name}</span>
                        {contact.organization_name ? (
                          <span className="ct-dropdown-sub">{contact.organization_name}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ct-field">
            <label className="ct-label" htmlFor="ct-org">Organização</label>
            {form.organization_id && orgName ? (
              <div className="ct-selected-item">
                <span>{orgName}</span>
                <button
                  type="button"
                  onClick={() => {
                    setForm((prev) => ({ ...prev, organization_id: '' }));
                    setOrgName('');
                  }}
                  aria-label="Remover organização"
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="ct-search-field">
                <input
                  id="ct-org"
                  value={orgSearch}
                  onChange={(e) => setOrgSearch(e.target.value)}
                  placeholder="Buscar organização..."
                  className="ct-input"
                />

                {orgs.length > 0 && orgSearch.length >= 2 && (
                  <div className="ct-dropdown">
                    {orgs.map((org) => (
                      <button
                        key={org.id}
                        type="button"
                        className="ct-dropdown-item"
                        onClick={() => handleOrganizationSelect(org)}
                      >
                        <span className="ct-dropdown-name">{org.name}</span>
                        <span className="ct-dropdown-sub">{org.status}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ct-field">
            <label className="ct-label" htmlFor="ct-assignee">Atribuído a</label>
            <select
              id="ct-assignee"
              value={form.assigned_to}
              onChange={(e) => setForm((prev) => ({ ...prev, assigned_to: e.target.value }))}
              className="ct-select"
            >
              <option value="">Sem atribuição</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>

          <div className="ct-field">
            <label className="ct-label" htmlFor="ct-due-date">Prazo</label>
            <input
              id="ct-due-date"
              type="date"
              value={form.due_date}
              onChange={(e) => setForm((prev) => ({ ...prev, due_date: e.target.value }))}
              className="ct-input"
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          <div className="ct-field">
            <label className="ct-label" htmlFor="ct-category">Categoria</label>
            <input
              id="ct-category"
              value={form.category}
              onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
              placeholder="Ex: Infraestrutura, Financeiro..."
              className="ct-input"
            />
          </div>
          </aside>
        </div>
      </form>
    </PageShell>
  );
}
