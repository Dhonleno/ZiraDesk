import { useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  contactsApi,
  organizationsApi,
  ticketsApi,
  type CrmContact,
  type CrmOrganization,
  type TicketPriority,
} from '../../services/api';
import { PageShell } from '../../components/layout/PageShell';
import { useToast } from '../../stores/toast.store';
import {
  buildCreateTicketPayload,
  getTicketConditionalRequirements,
  readTicketCreatePreferences,
  saveTicketCreatePreferences,
  validateTicketCreateDraft,
  type TicketCreateDraft,
  type TicketCreateStatus,
} from '../../components/tickets/createTicketShared';

interface CreateTicketForm {
  title: string;
  description: string;
  status: TicketCreateStatus;
  priority: TicketPriority;
  type_id: string;
  contact_id: string;
  organization_id: string;
  assigned_to: string;
  category: string;
  due_date: string;
  tags: string[];
}

type SubmitMode = 'open' | 'new';

function buildDraft(form: CreateTicketForm): TicketCreateDraft {
  return {
    title: form.title,
    description: form.description,
    status: form.status,
    priority: form.priority,
    type_id: form.type_id,
    contact_id: form.contact_id || undefined,
    organization_id: form.organization_id || undefined,
    assigned_to: form.assigned_to || null,
    category: form.category,
    due_date: form.due_date || undefined,
    tags: form.tags,
  };
}

export default function CreateTicket() {
  const { t } = useTranslation('tickets');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const [submitMode, setSubmitMode] = useState<SubmitMode>('open');

  const initialPrefs = useMemo(() => readTicketCreatePreferences(), []);
  const [form, setForm] = useState<CreateTicketForm>({
    title: searchParams.get('title') ?? '',
    description: '',
    status: initialPrefs.status,
    priority: initialPrefs.priority,
    type_id: initialPrefs.type_id,
    contact_id: searchParams.get('contact_id') ?? '',
    organization_id: searchParams.get('org_id') ?? '',
    assigned_to: initialPrefs.assigned_to,
    category: '',
    due_date: '',
    tags: [],
  });

  const [contactSearch, setContactSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [contactName, setContactName] = useState(searchParams.get('contact_name') ?? '');
  const [orgName, setOrgName] = useState(searchParams.get('org_name') ?? '');
  const [files, setFiles] = useState<File[]>([]);

  const { data: ticketTypes = [] } = useQuery({
    queryKey: ['ticket-types'],
    queryFn: adminApi.ticketTypes.list,
    staleTime: 60_000,
  });
  const { data: categoriesData } = useQuery({
    queryKey: ['ticket-categories-options'],
    queryFn: () => ticketsApi.list({ per_page: 100, sort_by: 'updated_at', sort_order: 'desc' }),
    staleTime: 60_000,
  });
  const selectedType = useMemo(
    () => ticketTypes.find((item) => item.id === form.type_id) ?? null,
    [form.type_id, ticketTypes],
  );
  const conditional = useMemo(
    () => getTicketConditionalRequirements(
      { priority: form.priority, status: form.status },
      {
        requireDueDateForUrgent: selectedType?.require_due_date_for_urgent ?? true,
        requireCategoryForWaiting: selectedType?.require_category_for_waiting ?? true,
      },
    ),
    [form.priority, form.status, selectedType?.require_category_for_waiting, selectedType?.require_due_date_for_urgent],
  );
  const categoryOptions = useMemo(() => {
    const values = new Set<string>();
    (categoriesData?.data ?? []).forEach((item) => {
      if (item.category) values.add(item.category);
    });
    if (form.category) values.add(form.category);
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [categoriesData?.data, form.category]);

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
    mutationFn: async (mode: SubmitMode) => {
      const draft = {
        ...buildDraft(form),
        require_due_date_for_urgent_override: selectedType?.require_due_date_for_urgent ?? true,
        require_category_for_waiting_override: selectedType?.require_category_for_waiting ?? true,
      };
      const validation = validateTicketCreateDraft(draft);
      if (!validation.isValid) {
        throw new Error(validation.errors[0] ?? 'Dados inválidos para criar ticket');
      }

      const payload = buildCreateTicketPayload(draft);
      const ticket = await ticketsApi.create(payload);

      for (const file of files) {
        await ticketsApi.uploadAttachment(ticket.id, file);
      }

      saveTicketCreatePreferences({
        priority: form.priority,
        status: form.status,
        type_id: form.type_id,
        assigned_to: form.assigned_to,
      });

      return { ticket, mode };
    },
    onSuccess: ({ ticket, mode }) => {
      toast.success('Ticket criado com sucesso!');
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      void qc.invalidateQueries({ queryKey: ['ticket-stats'] });
      if (mode === 'open') {
        navigate(`/tickets/${ticket.id}`);
        return;
      }

      setForm((prev) => ({
        ...prev,
        title: '',
        description: '',
        contact_id: '',
        organization_id: '',
        category: '',
        due_date: '',
        tags: [],
      }));
      setContactName('');
      setOrgName('');
      setContactSearch('');
      setOrgSearch('');
      setTagInput('');
      setFiles([]);
      titleRef.current?.focus();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar ticket');
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createMutation.mutate(submitMode);
  };

  const handleAddTag = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !tagInput.trim()) return;
    event.preventDefault();
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

  const handleFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) return;
    setFiles((prev) => [...prev, ...selected]);
    event.target.value = '';
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== index));
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
              className="create-ticket-btn create-ticket-btn-ghost"
              disabled={createMutation.isPending}
              onClick={() => setSubmitMode('new')}
            >
              {createMutation.isPending && submitMode === 'new' ? 'Salvando...' : 'Criar e novo'}
            </button>
            <button
              type="submit"
              className="create-ticket-btn create-ticket-btn-primary"
              disabled={createMutation.isPending}
              onClick={() => setSubmitMode('open')}
            >
              {createMutation.isPending && submitMode === 'open' ? 'Salvando...' : 'Criar e abrir'}
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
                ref={titleRef}
                autoFocus
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Descreva o problema ou solicitação..."
                className="ct-input ct-input-lg"
              />
            </div>

            <div className="ct-field">
              <label className="ct-label" htmlFor="ct-description">Descrição</label>
              <textarea
                id="ct-description"
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
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
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={handleAddTag}
                  placeholder={form.tags.length ? '' : 'Digite e pressione Enter...'}
                  className="ct-tags-field"
                />
              </div>
            </div>

            <div className="ct-field">
              <label className="ct-label" htmlFor="ct-attachments">Anexos na abertura</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label
                  htmlFor="ct-attachments"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    background: 'var(--bg-4)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r)',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: 'var(--txt)',
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                    <path d="M11 6.5 6 11.5a3.5 3.5 0 1 1-5-5l5.5-5.5a2 2 0 1 1 2.8 2.8L4 9.1a1 1 0 1 1-1.4-1.4l4.6-4.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t('tickets.attachFile')}
                  <input
                    id="ct-attachments"
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFilesChange}
                  />
                </label>
              </div>
              {files.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {files.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        maxWidth: '100%',
                        padding: '3px 8px',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-pill)',
                        background: 'var(--bg-3)',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--txt-2)' }}>
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        aria-label={`Remover ${file.name}`}
                        style={{ border: 'none', background: 'transparent', color: 'var(--txt-3)', cursor: 'pointer', lineHeight: 1 }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <aside className="create-ticket-sidebar">
            {conditional.hints.length > 0 ? (
              <div className="ct-conditional-hints">
                {conditional.hints.map((hint) => (
                  <p key={hint}>{hint}</p>
                ))}
              </div>
            ) : null}

            <div className="ct-field">
              <label className="ct-label" htmlFor="ct-type">Tipo</label>
              <select
                id="ct-type"
                value={form.type_id}
                onChange={(event) => setForm((prev) => ({ ...prev, type_id: event.target.value }))}
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
                  onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value as TicketPriority }))}
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
                  onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as TicketCreateStatus }))}
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
                    onChange={(event) => setContactSearch(event.target.value)}
                    placeholder="Buscar contato..."
                    className="ct-input"
                  />

                  {contacts.length > 0 && contactSearch.length >= 2 ? (
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
                  ) : null}
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
                    onChange={(event) => setOrgSearch(event.target.value)}
                    placeholder="Buscar organização..."
                    className="ct-input"
                  />

                  {orgs.length > 0 && orgSearch.length >= 2 ? (
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
                  ) : null}
                </div>
              )}
            </div>

            <div className="ct-field">
              <label className="ct-label" htmlFor="ct-assignee">Atribuído a</label>
              <select
                id="ct-assignee"
                value={form.assigned_to}
                onChange={(event) => setForm((prev) => ({ ...prev, assigned_to: event.target.value }))}
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
              {conditional.dueDateRequired ? <span className="ct-rule-required">Obrigatório para urgente</span> : null}
              <input
                id="ct-due-date"
                type="date"
                value={form.due_date}
                onChange={(event) => setForm((prev) => ({ ...prev, due_date: event.target.value }))}
                className="ct-input"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            <div className="ct-field">
              <label className="ct-label" htmlFor="ct-category">
                Categoria
                {conditional.categoryRequired ? <span className="required"> *</span> : null}
              </label>
              {conditional.categoryRequired ? <span className="ct-rule-required">Obrigatório para status aguardando</span> : null}
              <select
                id="ct-category"
                value={form.category}
                onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                className="ct-select"
                style={{
                  background: 'var(--bg-2)',
                  border: '1px solid var(--line)',
                  color: 'var(--txt)',
                }}
              >
                <option value="">Selecione a categoria</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
          </aside>
        </div>
      </form>
    </PageShell>
  );
}
