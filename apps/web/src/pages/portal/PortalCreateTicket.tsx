import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { portalApi, type TicketPriority } from '../../services/api';
import { useToast } from '../../stores/toast.store';

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 16V4M7 9l5-5 5 5M5 20h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PortalCreateTicket() {
  const { t } = useTranslation('portal');
  const navigate = useNavigate();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    type_id: '',
    priority: 'medium' as TicketPriority,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);

  const { data: ticketTypes = [] } = useQuery({
    queryKey: ['portal-ticket-types'],
    queryFn: () => portalApi.getTicketTypes(),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      portalApi.createTicket({
        title: form.title.trim(),
        priority: form.priority,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.type_id ? { type_id: form.type_id } : {}),
      }),
    onSuccess: async (ticket) => {
      if (files.length > 0) {
        setIsUploadingAttachments(true);
        for (const file of files) {
          try {
            await portalApi.addAttachment(ticket.id, file);
          } catch {
            toast.error(t('ticket.messages.attachmentUploadError', { name: file.name }));
          }
        }
        setIsUploadingAttachments(false);
      }
      toast.success(t('ticket.messages.createSuccess'));
      navigate(`/portal/tickets/${ticket.id}`, { replace: true });
    },
    onError: () => toast.error(t('ticket.messages.createError')),
  });

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selected.length === 0) return;

    const tooLarge = selected.filter((file) => file.size > MAX_ATTACHMENT_SIZE);
    if (tooLarge.length > 0) {
      toast.error(t('ticket.messages.attachmentTooLarge'));
    }

    const accepted = selected.filter((file) => file.size <= MAX_ATTACHMENT_SIZE);
    setFiles((prev) => {
      const merged = [...prev, ...accepted];
      if (merged.length > MAX_ATTACHMENTS) {
        toast.error(t('ticket.messages.attachmentLimit', { count: MAX_ATTACHMENTS }));
      }
      return merged.slice(0, MAX_ATTACHMENTS);
    });
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const isSubmitting = createMutation.isPending || isUploadingAttachments;

  return (
    <div className="portal-page portal-page-narrow">
      <div className="portal-form-header">
        <button type="button" className="portal-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeftIcon />
          {t('tickets.backToList')}
        </button>
        <h1>{t('tickets.newTitle')}</h1>
      </div>

      <div className="portal-form-card">
        <div className="portal-field">
          <label htmlFor="portal-ticket-title">{t('ticket.title')}</label>
          <input
            id="portal-ticket-title"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder={t('ticket.titlePlaceholder')}
          />
        </div>

        <div className="portal-field-row">
          <div className="portal-field">
            <label htmlFor="portal-ticket-type">{t('ticket.type')}</label>
            <select
              id="portal-ticket-type"
              value={form.type_id}
              onChange={(event) => setForm((prev) => ({ ...prev, type_id: event.target.value }))}
            >
              <option value="">{t('ticket.typePlaceholder')}</option>
              {ticketTypes.map((type) => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </select>
          </div>

          <div className="portal-field">
            <label htmlFor="portal-ticket-priority">{t('ticket.priority')}</label>
            <select
              id="portal-ticket-priority"
              value={form.priority}
              onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value as TicketPriority }))}
            >
              <option value="low">{t('ticket.priorityLabel.low')}</option>
              <option value="medium">{t('ticket.priorityLabel.medium')}</option>
              <option value="high">{t('ticket.priorityLabel.high')}</option>
              <option value="urgent">{t('ticket.priorityLabel.urgent')}</option>
            </select>
          </div>
        </div>

        <div className="portal-field">
          <label htmlFor="portal-ticket-description">{t('ticket.description')}</label>
          <textarea
            id="portal-ticket-description"
            rows={5}
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            placeholder={t('ticket.descriptionPlaceholder')}
          />
        </div>

        <div className="portal-field">
          <label>{t('ticket.attachments')}</label>
          <div
            className="portal-file-drop"
            onClick={() => files.length < MAX_ATTACHMENTS && fileInputRef.current?.click()}
          >
            <UploadIcon />
            <span>{t('tickets.fields.attachmentsHint')}</span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif"
              onChange={handleFilesSelected}
            />
          </div>

          {files.length > 0 && (
            <ul className="portal-attachment-list">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <span className="portal-attachment-link" style={{ cursor: 'default' }}>
                    {file.name}
                  </span>
                  <button type="button" className="portal-attachment-remove" onClick={() => removeFile(index)}>
                    {t('ticket.removeAttachment')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="portal-form-actions">
          <button type="button" className="portal-btn-ghost" onClick={() => navigate(-1)}>
            {t('common.cancel', { defaultValue: 'Cancelar' })}
          </button>
          <button
            type="button"
            className="portal-btn-primary portal-btn-inline"
            disabled={!form.title.trim() || isSubmitting}
            onClick={() => createMutation.mutate()}
          >
            {isSubmitting ? t('ticket.submitLoading') : t('ticket.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
