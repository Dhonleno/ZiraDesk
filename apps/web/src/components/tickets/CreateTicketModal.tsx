import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { ticketsApi, contactsApi, organizationsApi, adminApi } from '../../services/api';
import type { CrmContact, CrmOrganization } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { useDebounce } from '../../hooks/useDebounce';
import {
  buildCreateTicketPayload,
  getTicketConditionalRequirements,
  readTicketCreatePreferences,
  saveTicketCreatePreferences,
  validateTicketCreateDraft,
  type TicketCreateDraft,
} from './createTicketShared';

/* ── Schema ──────────────────────────────────────────────────────────────── */
const schema = z.object({
  title:       z.string().min(3, 'Mínimo 3 caracteres'),
  description: z.string().optional(),
  priority:    z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  status:      z.enum(['open', 'in_progress', 'waiting']).default('open'),
  category:    z.string().optional(),
  type_id:     z.string().uuid().optional().or(z.literal('')),
  due_date:    z.string().optional(),
  tags:        z.array(z.string()),
});
type FormValues = z.infer<typeof schema>;

/* ── Props ───────────────────────────────────────────────────────────────── */
interface Props {
  open:    boolean;
  onClose: () => void;
  defaultValues?: {
    contact_id?: string;
    contact_name?: string;
    organization_id?: string;
    organization_name?: string;
    title?: string;
    category?: string;
    source_conversation_id?: string;
    source_protocol?: string | null;
  };
  onCreated?: (ticket: import('../../services/api').Ticket) => void;
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt)',
  height: '2.5rem', borderRadius: 'var(--r)', padding: '0 0.75rem',
  fontSize: '0.875rem', width: '100%', outline: 'none', fontFamily: 'var(--font)',
};

/* ── Component ───────────────────────────────────────────────────────────── */
export function CreateTicketModal({ open, onClose, defaultValues, onCreated }: Props) {
  const { t } = useTranslation('tickets');
  const toast  = useToast();
  const queryClient = useQueryClient();

  const [contactSearch, setContactSearch] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedContactName, setSelectedContactName] = useState('');
  const [showContactDropdown, setShowContactDropdown] = useState(false);

  const [organizationSearch, setOrganizationSearch] = useState('');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [selectedOrganizationName, setSelectedOrganizationName] = useState('');
  const [showOrganizationDropdown, setShowOrganizationDropdown] = useState(false);

  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const initialPrefs = readTicketCreatePreferences();

  const debouncedContactSearch = useDebounce(contactSearch, 300);
  const debouncedOrganizationSearch = useDebounce(organizationSearch, 300);

  const { register, handleSubmit, watch, setValue, getValues, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { priority: initialPrefs.priority, status: initialPrefs.status, tags: [], type_id: initialPrefs.type_id },
  });

  const tags = watch('tags');
  const status = watch('status');
  const priority = watch('priority');
  const selectedTypeId = watch('type_id');
  const hasSourceConversation = Boolean(defaultValues?.source_conversation_id);
  const contactReadonly = hasSourceConversation;
  const organizationReadonly = hasSourceConversation;

  useEffect(() => {
    if (!open) return;

    setValue('title', defaultValues?.title ?? '');
    setValue('category', defaultValues?.category ?? '');
    setValue('priority', initialPrefs.priority);
    setValue('status', initialPrefs.status);
    setValue('type_id', initialPrefs.type_id);
    setAssigneeId(initialPrefs.assigned_to || null);
    setDepartmentId(null);

    if (defaultValues?.contact_id) {
      setSelectedContactId(defaultValues.contact_id);
      setSelectedContactName(defaultValues.contact_name ?? '');
      setShowContactDropdown(false);
      setContactSearch('');
    } else {
      setSelectedContactId(null);
      setSelectedContactName('');
      setShowContactDropdown(false);
      setContactSearch('');
    }

    if (defaultValues?.organization_id) {
      setSelectedOrganizationId(defaultValues.organization_id);
      setSelectedOrganizationName(defaultValues.organization_name ?? '');
      setShowOrganizationDropdown(false);
      setOrganizationSearch('');
    } else {
      setSelectedOrganizationId(null);
      setSelectedOrganizationName('');
      setShowOrganizationDropdown(false);
      setOrganizationSearch('');
    }
  }, [defaultValues, initialPrefs.assigned_to, initialPrefs.priority, initialPrefs.status, initialPrefs.type_id, open, setValue]);

  const { data: contactResults } = useQuery({
    queryKey: ['crm-contacts-search', debouncedContactSearch],
    queryFn: () => contactsApi.list({ search: debouncedContactSearch, per_page: 8 }),
    enabled: debouncedContactSearch.length > 1 && showContactDropdown,
    staleTime: 10_000,
  });

  const { data: usersData } = useQuery({
    queryKey: ['admin-users-select'],
    queryFn: () => adminApi.listUsers({ per_page: 50 }),
    staleTime: 60_000,
    enabled: open,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['create-ticket-departments'],
    queryFn: () => adminApi.departments.list(),
    staleTime: 60_000,
    enabled: open,
  });

  const { data: ticketTypes = [] } = useQuery({
    queryKey: ['ticket-types'],
    queryFn: adminApi.ticketTypes.list,
    staleTime: 60_000,
    enabled: open,
  });
  const selectedType = useMemo(
    () => ticketTypes.find((type) => type.id === selectedTypeId) ?? null,
    [selectedTypeId, ticketTypes],
  );
  const conditional = useMemo(
    () => getTicketConditionalRequirements(
      { priority, status },
      {
        requireDueDateForUrgent: selectedType?.require_due_date_for_urgent ?? true,
        requireCategoryForWaiting: selectedType?.require_category_for_waiting ?? true,
      },
    ),
    [priority, selectedType?.require_category_for_waiting, selectedType?.require_due_date_for_urgent, status],
  );

  const { data: organizationResults } = useQuery({
    queryKey: ['crm-organizations-search', debouncedOrganizationSearch],
    queryFn: () => organizationsApi.list({ search: debouncedOrganizationSearch, per_page: 8 }),
    enabled: debouncedOrganizationSearch.length > 1 && showOrganizationDropdown,
    staleTime: 10_000,
  });
  const { data: ticketCategories = [] } = useQuery({
    queryKey: ['ticket-categories'],
    queryFn: adminApi.ticketCategories.list,
    staleTime: 60_000,
    enabled: open,
  });
  const categoryOptions = useMemo(
    () => ticketCategories
      .filter((c) => c.is_active)
      .sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name, 'pt-BR');
      }),
    [ticketCategories],
  );

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const draft: TicketCreateDraft = {
        title: values.title,
        description: values.description,
        priority: values.priority,
        status: values.status,
        category: values.category,
        type_id: values.type_id,
        due_date: values.due_date || undefined,
        tags: values.tags,
        contact_id: selectedContactId ?? undefined,
        organization_id: selectedOrganizationId ?? undefined,
        assigned_to: assigneeId,
        department_id: departmentId,
        source_conversation_id: defaultValues?.source_conversation_id,
        require_due_date_for_urgent_override: selectedType?.require_due_date_for_urgent ?? true,
        require_category_for_waiting_override: selectedType?.require_category_for_waiting ?? true,
      };
      const validation = validateTicketCreateDraft(draft, { t });
      if (!validation.isValid) {
        throw new Error(validation.errors[0] ?? 'Dados inválidos para criar ticket');
      }

      const payload = buildCreateTicketPayload(draft);
      const createdTicket = await ticketsApi.create(payload);
      for (const file of files) {
        await ticketsApi.uploadAttachment(createdTicket.id, file);
      }

      saveTicketCreatePreferences({
        priority: values.priority,
        status: values.status,
        type_id: values.type_id ?? '',
        assigned_to: assigneeId ?? '',
      });

      return createdTicket;
    },
    onSuccess: (createdTicket) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-stats'] });
      toast.success(t('tickets.form.created'), {
        linkLabel: t('tickets.form.openCreatedTicket', { defaultValue: 'Abrir ticket' }),
        linkHref: `/tickets/${createdTicket.id}`,
      });
      onCreated?.(createdTicket);
      reset();
      setSelectedContactId(null);
      setSelectedContactName('');
      setSelectedOrganizationId(null);
      setSelectedOrganizationName('');
      setOrganizationSearch('');
      setAssigneeId(null);
      setDepartmentId(null);
      setTagInput('');
      setFiles([]);
      onClose();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Erro ao criar ticket'),
  });

  function addTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = tagInput.trim();
    if (!val || tags.includes(val)) return;
    setValue('tags', [...tags, val]);
    setTagInput('');
  }

  function removeTag(tag: string) {
    setValue('tags', getValues('tags').filter(t => t !== tag));
  }

  function handleContactSelect(contact: CrmContact) {
    setSelectedContactId(contact.id);
    setSelectedContactName(contact.name);
    setShowContactDropdown(false);

    if (contact.organization_id) {
      setSelectedOrganizationId(contact.organization_id);
      setSelectedOrganizationName(
        contact.organization_name
          ?? t('tickets.form.organizationLinked'),
      );
      setOrganizationSearch('');
      setShowOrganizationDropdown(false);
      return;
    }

    setSelectedOrganizationId(null);
    setSelectedOrganizationName('');
    setOrganizationSearch('');
    setShowOrganizationDropdown(false);
  }

  function handleClearContact() {
    if (contactReadonly) return;
    setSelectedContactId(null);
    setSelectedContactName('');
    setContactSearch('');
    setShowContactDropdown(false);
    setSelectedOrganizationId(null);
    setSelectedOrganizationName('');
    setOrganizationSearch('');
    setShowOrganizationDropdown(false);
  }

  function handleOrganizationSelect(org: CrmOrganization) {
    setSelectedOrganizationId(org.id);
    setSelectedOrganizationName(org.name);
    setShowOrganizationDropdown(false);
  }

  function handleClearOrganization() {
    if (organizationReadonly) return;
    setSelectedOrganizationId(null);
    setSelectedOrganizationName('');
    setOrganizationSearch('');
    setShowOrganizationDropdown(false);
  }

  function handleFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) return;
    setFiles((prev) => [...prev, ...selected]);
    event.target.value = '';
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== index));
  }

  const users = usersData?.data ?? [];
  const filesLabel = files.length > 0
    ? (files.length === 1 ? files[0]?.name ?? '' : t('tickets.filesSelected', { count: files.length }))
    : t('tickets.noFileSelected');

  return (
    <Modal open={open} onClose={onClose} title={t('tickets.form.create')} maxWidth="md">
      <form onSubmit={handleSubmit((values: FormValues) => mutation.mutate(values))}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {hasSourceConversation ? (
            <div style={{
              padding: '8px 10px',
              borderRadius: 'var(--r)',
              border: '1px solid rgba(96,165,250,.35)',
              background: 'var(--blue-dim)',
              color: 'var(--blue)',
              fontSize: 12,
              fontWeight: 500,
            }}>
              {t('tickets.sourceConversation', {
                protocol: defaultValues?.source_protocol ?? defaultValues?.source_conversation_id ?? '—',
                defaultValue: 'Originado do atendimento {{protocol}}',
              })}
            </div>
          ) : null}

          {conditional.hints.length > 0 ? (
            <div style={{
              border: '1px solid var(--line-2)',
              background: 'var(--bg-3)',
              borderRadius: 'var(--r)',
              padding: '8px 10px',
              display: 'grid',
              gap: 4,
            }}>
              {conditional.hints.map((hint) => (
                <p key={hint} style={{ margin: 0, fontSize: 11, color: 'var(--txt-2)' }}>{hint}</p>
              ))}
            </div>
          ) : null}

          <Input label={t('tickets.fields.title')} error={errors.title?.message} autoFocus {...register('title')} />

          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
              {t('tickets.fields.description')}
            </label>
            <textarea {...register('description')} rows={3} style={{
              ...selectStyle, height: 'auto', padding: '8px 10px',
              resize: 'vertical', lineHeight: 1.5,
            }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
                {t('tickets.fields.priority')}
              </label>
              <select style={selectStyle} {...register('priority')}>
                <option value="low">{t('tickets.priority.low')}</option>
                <option value="medium">{t('tickets.priority.medium')}</option>
                <option value="high">{t('tickets.priority.high')}</option>
                <option value="urgent">{t('tickets.priority.urgent')}</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
                {t('tickets.fields.status')}
              </label>
              <select style={selectStyle} {...register('status')}>
                <option value="open">{t('tickets.status.open')}</option>
                <option value="in_progress">{t('tickets.status.in_progress')}</option>
                <option value="waiting">{t('tickets.status.waiting')}</option>
              </select>
            </div>
          </div>

          {/* Contact search */}
          <div style={{ position: 'relative' }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
              {t('tickets.fields.client')}
            </label>
            {selectedContactId ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                borderRadius: 'var(--r)',
                background: contactReadonly ? 'var(--bg-3)' : 'var(--teal-dim)',
                border: '1px solid var(--teal)',
                fontSize: 13, color: 'var(--txt)' }}>
                <span style={{ flex: 1 }}>{selectedContactName}</span>
                {!contactReadonly ? (
                  <button type="button" onClick={handleClearContact}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt-3)', lineHeight: 1 }}>
                    ×
                  </button>
                ) : null}
              </div>
            ) : (
              <input
                type="text"
                placeholder={t('tickets.form.searchClient')}
                value={contactSearch}
                onChange={(e) => { setContactSearch(e.target.value); setShowContactDropdown(true); }}
                onFocus={() => setShowContactDropdown(true)}
                onBlur={() => setTimeout(() => setShowContactDropdown(false), 150)}
                disabled={contactReadonly}
                style={{ ...selectStyle, display: 'block' }}
              />
            )}
            {showContactDropdown && !selectedContactId && !contactReadonly && contactResults && contactResults.data.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                background: 'var(--bg-3)', border: '1px solid var(--line)',
                borderRadius: 'var(--r)', boxShadow: '0 8px 24px rgba(0,0,0,.4)',
                maxHeight: 200, overflowY: 'auto', marginTop: 2,
              }}>
                {contactResults.data.map((c) => (
                  <button key={c.id} type="button" onMouseDown={() => handleContactSelect(c)} style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
                    color: 'var(--txt)', fontFamily: 'var(--font)',
                  }}>
                    <span style={{ fontWeight: 500 }}>{c.name}</span>
                    {c.email && <span style={{ marginLeft: 8, color: 'var(--txt-3)', fontSize: 11 }}>{c.email}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Organization search (optional) */}
          <div style={{ position: 'relative' }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
              {t('tickets.organization')}
            </label>
            {selectedOrganizationId ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                borderRadius: 'var(--r)',
                background: organizationReadonly ? 'var(--bg-3)' : 'var(--blue-dim)',
                border: `1px solid ${organizationReadonly ? 'var(--teal)' : 'var(--blue)'}`,
                fontSize: 13, color: 'var(--txt)' }}>
                <span style={{ flex: 1 }}>{selectedOrganizationName}</span>
                {!organizationReadonly ? (
                  <button
                    type="button"
                    onClick={handleClearOrganization}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt-3)', lineHeight: 1 }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ) : (
              <input
                type="text"
                placeholder={t('tickets.form.searchOrganization')}
                value={organizationSearch}
                onChange={(e) => {
                  setOrganizationSearch(e.target.value);
                  setShowOrganizationDropdown(true);
                }}
                onFocus={() => setShowOrganizationDropdown(true)}
                onBlur={() => setTimeout(() => setShowOrganizationDropdown(false), 150)}
                disabled={organizationReadonly}
                style={{ ...selectStyle, display: 'block' }}
              />
            )}
            {showOrganizationDropdown && !selectedOrganizationId && !organizationReadonly && organizationResults && organizationResults.data.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                background: 'var(--bg-3)', border: '1px solid var(--line)',
                borderRadius: 'var(--r)', boxShadow: '0 8px 24px rgba(0,0,0,.4)',
                maxHeight: 200, overflowY: 'auto', marginTop: 2,
              }}>
                {organizationResults.data.map((org) => (
                  <button key={org.id} type="button" onMouseDown={() => handleOrganizationSelect(org)} style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
                    color: 'var(--txt)', fontFamily: 'var(--font)',
                  }}>
                    <span style={{ fontWeight: 500 }}>{org.name}</span>
                    {org.email && <span style={{ marginLeft: 8, color: 'var(--txt-3)', fontSize: 11 }}>{org.email}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {/* Assignee */}
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
                {t('tickets.fields.assignedTo')}
              </label>
              <select style={selectStyle} value={assigneeId ?? ''} onChange={(e) => setAssigneeId(e.target.value || null)}>
                <option value="">{t('tickets.form.noUser')}</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
                {t('tickets.fields.department')}
              </label>
              <select style={selectStyle} value={departmentId ?? ''} onChange={(e) => setDepartmentId(e.target.value || null)}>
                <option value="">{t('tickets.form.noDepartment')}</option>
                {departments.filter((department) => department.isActive).map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
                {t('tickets.fields.type', { defaultValue: 'Tipo' })}
              </label>
              <select style={selectStyle} {...register('type_id')}>
                <option value="">{t('tickets.form.selectType', { defaultValue: 'Selecione o tipo' })}</option>
                {ticketTypes.filter((type) => type.is_active).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.icon} {type.name}
                  </option>
                ))}
              </select>
            </div>
            {categoryOptions.length > 0 ? (
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
                  {conditional.categoryRequired ? `${t('tickets.fields.category')} *` : t('tickets.fields.category')}
                </label>
                <select style={selectStyle} {...register('category')}>
                  <option value="">{t('tickets.form.selectCategory', { defaultValue: 'Selecione a categoria' })}</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat.id} value={cat.name}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <Input
                label={conditional.categoryRequired ? `${t('tickets.fields.category')} *` : t('tickets.fields.category')}
                {...register('category')}
              />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
                {t('tickets.fields.dueDate')}
              </label>
              {conditional.dueDateRequired ? (
                <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 6 }}>{t('tickets.form.urgentDueDateRequired')}</div>
              ) : null}
              <input type="date" {...register('due_date')} style={selectStyle} />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
              {t('tickets.fields.tags')}
            </label>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {tags.map((tag) => (
                  <span key={tag} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
                    borderRadius: 'var(--r-pill)', background: 'var(--teal-dim)', color: 'var(--teal)',
                    border: '1px solid rgba(0,201,167,.25)', fontSize: 12,
                  }}>
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} style={{
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)',
                      display: 'flex', alignItems: 'center', padding: 0, lineHeight: 1,
                    }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                        <path d="M7.5 2.5l-5 5M2.5 2.5l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input type="text" placeholder={t('tickets.form.tagPlaceholder')} value={tagInput}
              onChange={(e) => setTagInput(e.target.value)} onKeyDown={addTag}
              style={{ ...selectStyle, display: 'block' }} />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt-2)', display: 'block', marginBottom: 6 }}>
              {t('tickets.form.attachments')}
            </label>
            <label className="file-upload-btn">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                <path d="M11 6.5 6 11.5a3.5 3.5 0 1 1-5-5l5.5-5.5a2 2 0 1 1 2.8 2.8L4 9.1a1 1 0 1 1-1.4-1.4l4.6-4.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{t('tickets.chooseFile')}</span>
              <input type="file" hidden multiple onChange={handleFilesChange} />
            </label>
            <div className="file-upload-meta">{filesLabel}</div>
            {files.length > 0 ? (
              <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderRadius: 'var(--r)', border: '1px solid var(--line-2)', background: 'var(--bg-3)' }}>
                    <span style={{ fontSize: 12, color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                    <button type="button" onClick={() => removeFile(index)} style={{ background: 'none', border: 'none', color: 'var(--txt-2)', cursor: 'pointer', lineHeight: 1 }}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <button type="button" className="zd-btn" onClick={onClose}>{t('tickets.cancel')}</button>
            <button type="submit" className="zd-btn zd-btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? t('tickets.form.creating') : t('tickets.form.create')}
            </button>
          </div>

        </div>
      </form>
    </Modal>
  );
}
