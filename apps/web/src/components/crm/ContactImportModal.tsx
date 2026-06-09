import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { contactsApi, type ContactImportDuplicateAction, type ContactImportMapping, type ContactImportPreview, type ContactImportResult } from '../../services/api';
import { subscribeToEvent } from '../../services/socket';
import './ContactImportModal.css';

const MAX_IMPORT_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.vcf'];

type ImportStep = 'upload' | 'mapping' | 'progress' | 'done';
type MappingKey = keyof ContactImportMapping;

const MAPPING_FIELDS: Array<{ key: MappingKey; labelKey: string; required?: boolean }> = [
  { key: 'name', labelKey: 'import.fields.name', required: true },
  { key: 'email', labelKey: 'import.fields.email' },
  { key: 'phone', labelKey: 'import.fields.phone' },
  { key: 'whatsapp', labelKey: 'import.fields.whatsapp' },
  { key: 'organization_name', labelKey: 'import.fields.organization' },
  { key: 'role', labelKey: 'import.fields.role' },
  { key: 'department', labelKey: 'import.fields.department' },
  { key: 'tags', labelKey: 'import.fields.tags' },
  { key: 'custom_fields', labelKey: 'import.fields.customFields' },
];

interface ContactImportModalProps {
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

function fileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index).toLowerCase() : '';
}

function extractErrorMessage(error: unknown): string | null {
  return (error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? null;
}

function guessColumn(columns: string[], candidates: string[]): string {
  const normalized = columns.map((column) => ({ column, value: column.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') }));
  for (const candidate of candidates) {
    const match = normalized.find((item) => item.value.includes(candidate));
    if (match) return match.column;
  }
  return '';
}

function buildInitialMapping(columns: string[]): ContactImportMapping {
  return {
    name: guessColumn(columns, ['nome', 'name', 'fn']),
    email: guessColumn(columns, ['email', 'e-mail']),
    phone: guessColumn(columns, ['telefone', 'phone', 'tel']),
    whatsapp: guessColumn(columns, ['whatsapp']),
    organization_name: guessColumn(columns, ['empresa', 'organizacao', 'organization', 'company']),
    role: guessColumn(columns, ['cargo', 'role', 'title']),
    department: guessColumn(columns, ['departamento', 'department']),
    tags: guessColumn(columns, ['tags', 'etiquetas']),
    custom_fields: guessColumn(columns, ['custom', 'campos']),
  };
}

export function ContactImportModal({ open, onClose, onRefresh }: ContactImportModalProps) {
  const { t } = useTranslation('crm');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<ImportStep>('upload');
  const [preview, setPreview] = useState<ContactImportPreview | null>(null);
  const [mapping, setMapping] = useState<ContactImportMapping>({ name: '' });
  const [duplicateAction, setDuplicateAction] = useState<ContactImportDuplicateAction>('skip');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<ContactImportResult | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    return subscribeToEvent<ContactImportResult>('contacts:import:done', (payload) => {
      if (jobId && payload.jobId !== jobId) return;
      setResult(payload);
      setStep('done');
    });
  }, [jobId, open]);

  useEffect(() => {
    if (!open) {
      setStep('upload');
      setPreview(null);
      setMapping({ name: '' });
      setDuplicateAction('skip');
      setIsDragging(false);
      setIsUploading(false);
      setIsConfirming(false);
      setError(null);
      setJobId(null);
      setResult(null);
    }
  }, [open]);

  const canConfirm = Boolean(preview?.importId && mapping.name);
  const previewColumns = preview?.columns ?? [];

  const resultCards = useMemo(() => {
    if (!result) return [];
    return [
      ['import.result.total', result.total],
      ['import.result.inserted', result.inserted],
      ['import.result.updated', result.updated],
      ['import.result.skipped', result.skipped],
      ['import.result.errors', result.errors],
    ] as Array<[string, number]>;
  }, [result]);

  if (!open) return null;

  async function handleFile(file: File) {
    setError(null);

    if (file.size > MAX_IMPORT_SIZE_BYTES) {
      setError(t('import.error.sizeLimit'));
      return;
    }

    if (!ACCEPTED_EXTENSIONS.includes(fileExtension(file.name))) {
      setError(t('import.error.format'));
      return;
    }

    setIsUploading(true);
    try {
      const data = await contactsApi.previewImport(file);
      setPreview(data);
      setMapping(buildInitialMapping(data.columns));
      setStep('mapping');
    } catch (err) {
      setError(extractErrorMessage(err) ?? t('import.error.generic'));
    } finally {
      setIsUploading(false);
    }
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = '';
  }

  function handleDrop(event: React.DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function updateMapping(key: MappingKey, value: string) {
    setMapping((current) => ({
      ...current,
      [key]: value || undefined,
    }));
  }

  async function handleConfirm() {
    if (!preview || !canConfirm) return;
    setIsConfirming(true);
    setError(null);
    try {
      const data = await contactsApi.confirmImport({
        importId: preview.importId,
        mapping,
        duplicateAction,
      });
      setJobId(data.jobId);
      setStep('progress');
    } catch (err) {
      setError(extractErrorMessage(err) ?? t('import.error.generic'));
    } finally {
      setIsConfirming(false);
    }
  }

  function downloadTemplate() {
    const headers = MAPPING_FIELDS.map((field) => t(field.labelKey).replace('*', ''));
    const csv = `${headers.join(',')}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'contatos-modelo.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  function closeAndRefresh() {
    onRefresh();
    onClose();
  }

  return (
    <div className="contact-import-overlay" role="dialog" aria-modal="true" aria-labelledby="contact-import-title">
      <div className="contact-import-modal">
        <header className="contact-import-head">
          <h2 id="contact-import-title">{t('import.title')}</h2>
          <button type="button" className="tb-icon-btn" onClick={onClose} aria-label={t('import.close')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="contact-import-body">
          {step === 'upload' && (
            <>
              <button
                type="button"
                className={`contact-import-dropzone${isDragging ? ' is-dragging' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                disabled={isUploading}
              >
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
                  <path d="M14 19V6M9.5 10.5L14 6l4.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6 18v3.5A2.5 2.5 0 008.5 24h11A2.5 2.5 0 0022 21.5V18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                <span>
                  <strong>{isUploading ? t('contacts.loading') : t('import.dropzone')}</strong>
                  <span className="contact-import-hint">{t('import.formats')}</span>
                </span>
                <span className="contact-import-hint">{t('import.sizeLimit')}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.vcf"
                hidden
                onChange={handleFileInputChange}
              />
              <div className="contact-import-upload-actions">
                <button type="button" className="tb-btn" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                  {t('import.selectFile')}
                </button>
                <button type="button" className="contact-import-link" onClick={downloadTemplate}>
                  {t('import.downloadTemplate')}
                </button>
              </div>
            </>
          )}

          {step === 'mapping' && preview && (
            <div className="contact-import-grid">
              <div className="contact-import-mapping">
                <p className="contact-import-hint">{t('import.totalRows', { count: preview.totalRows })}</p>
                <h3 style={{ margin: 0, color: 'var(--txt)', fontSize: 13 }}>{t('import.mapping.title')}</h3>
                {MAPPING_FIELDS.map((field) => (
                  <label key={field.key} className="contact-import-field">
                    <span>{t(field.labelKey)}</span>
                    <select
                      className="contact-import-select"
                      value={mapping[field.key] ?? ''}
                      onChange={(event) => updateMapping(field.key, event.target.value)}
                    >
                      {!field.required && <option value="">{t('import.mapping.ignore')}</option>}
                      {field.required && <option value="">{t('import.mapping.ignore')}</option>}
                      {previewColumns.map((column) => (
                        <option key={column} value={column}>{column}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <label className="contact-import-field">
                  <span>{t('import.duplicateAction')}</span>
                  <select
                    className="contact-import-select"
                    value={duplicateAction}
                    onChange={(event) => setDuplicateAction(event.target.value as ContactImportDuplicateAction)}
                  >
                    <option value="skip">{t('import.skip')}</option>
                    <option value="update">{t('import.update')}</option>
                  </select>
                </label>
              </div>

              <div className="contact-import-preview">
                <table>
                  <thead>
                    <tr>
                      {previewColumns.map((column) => <th key={column}>{column}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((row, index) => (
                      <tr key={index}>
                        {previewColumns.map((column) => <td key={column}>{row[column]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'progress' && (
            <div className="contact-import-progress">
              <div className="contact-import-progress-inner">
                <div className="contact-import-spinner" aria-hidden />
                <strong style={{ color: 'var(--txt)', fontSize: 14 }}>{t('import.inProgress')}</strong>
                <p className="contact-import-hint">{t('import.waitMessage')}</p>
              </div>
            </div>
          )}

          {step === 'done' && result && (
            <div className="contact-import-progress">
              <div className="contact-import-result">
                {resultCards.map(([labelKey, value]) => (
                  <div key={labelKey} className="contact-import-result-card">
                    <span>{t(labelKey)}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="contact-import-error">{error}</p>}
        </div>

        <footer className="contact-import-footer">
          {step === 'mapping' && (
            <>
              <button type="button" className="tb-btn" onClick={() => setStep('upload')}>
                {t('back', { ns: 'common' })}
              </button>
              <button type="button" className="tb-btn tb-btn-primary" onClick={handleConfirm} disabled={!canConfirm || isConfirming}>
                {isConfirming ? t('contacts.loading') : t('import.confirm')}
              </button>
            </>
          )}
          {step === 'progress' && (
            <button type="button" className="tb-btn" onClick={onClose}>
              {t('import.close')}
            </button>
          )}
          {step === 'done' && (
            <button type="button" className="tb-btn tb-btn-primary" onClick={closeAndRefresh}>
              {t('import.closeAndRefresh')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
