import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PageShell } from '../../components/layout/PageShell';
import { adminApi, type CustomFieldDefinition, type CustomFieldOption, type CustomFieldType } from '../../services/api';
import { useToast } from '../../stores/toast.store';

const FIELD_TYPES: CustomFieldType[] = ['text', 'number', 'date', 'boolean', 'select'];

interface FieldFormState {
  name: string;
  field_key: string;
  field_type: CustomFieldType;
  options: CustomFieldOption[];
  required: boolean;
  visible_in_portal: boolean;
  sort_order: number;
}

const EMPTY_FORM: FieldFormState = {
  name: '',
  field_key: '',
  field_type: 'text',
  options: [],
  required: false,
  visible_in_portal: false,
  sort_order: 0,
};

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) return '';
  return /^[a-z]/.test(slug) ? slug : `field_${slug}`;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 20, flexShrink: 0 }}>
      <input type="checkbox" style={{ opacity: 0, width: 0, height: 0 }} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        onClick={() => onChange(!checked)}
        style={{
          position: 'absolute', cursor: 'pointer', inset: 0,
          backgroundColor: checked ? 'var(--teal)' : 'var(--line-2)',
          borderRadius: 10, transition: '.2s',
        }}
      >
        <span style={{ position: 'absolute', height: 14, width: 14, left: checked ? 19 : 3, bottom: 3, backgroundColor: 'white', borderRadius: '50%', transition: '.2s' }} />
      </span>
    </label>
  );
}

export function CustomFields() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FieldFormState>(EMPTY_FORM);
  const [keyTouched, setKeyTouched] = useState(false);

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ['admin', 'custom-fields'],
    queryFn: adminApi.customFields.list,
  });

  const sorted = useMemo(
    () => fields.slice().sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name);
    }),
    [fields],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'custom-fields'] });

  const createMutation = useMutation({
    mutationFn: () => adminApi.customFields.create({
      name: form.name.trim(),
      field_key: form.field_key.trim(),
      field_type: form.field_type,
      options: form.field_type === 'select' ? form.options : [],
      required: form.required,
      visible_in_portal: form.visible_in_portal,
      sort_order: form.sort_order,
    }),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.customFields.saved'));
      closeModal();
      await invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('tenantAdmin.common.errorSave')),
  });

  const updateMutation = useMutation({
    mutationFn: () => adminApi.customFields.update(editingId!, {
      name: form.name.trim(),
      options: form.field_type === 'select' ? form.options : [],
      required: form.required,
      visible_in_portal: form.visible_in_portal,
      sort_order: form.sort_order,
    }),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.customFields.saved'));
      closeModal();
      await invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('tenantAdmin.common.errorSave')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.customFields.delete(id),
    onSuccess: async () => {
      toast.success(t('tenantAdmin.customFields.deleted'));
      await invalidate();
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setKeyTouched(false);
    setShowModal(true);
  }

  function openEdit(field: CustomFieldDefinition) {
    setEditingId(field.id);
    setForm({
      name: field.name,
      field_key: field.field_key,
      field_type: field.field_type,
      options: field.options,
      required: field.required,
      visible_in_portal: field.visible_in_portal,
      sort_order: field.sort_order,
    });
    setKeyTouched(true);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function handleNameChange(value: string) {
    setForm((prev) => ({
      ...prev,
      name: value,
      field_key: !editingId && !keyTouched ? slugify(value) : prev.field_key,
    }));
  }

  function handleSubmit() {
    if (!form.name.trim()) {
      toast.error(t('tenantAdmin.customFields.nameRequired'));
      return;
    }
    if (!editingId && !/^[a-z][a-z0-9_]*$/.test(form.field_key.trim())) {
      toast.error(t('tenantAdmin.customFields.keyInvalid'));
      return;
    }
    if (form.field_type === 'select' && form.options.filter((o) => o.value.trim()).length === 0) {
      toast.error(t('tenantAdmin.customFields.optionsRequired'));
      return;
    }
    if (editingId) updateMutation.mutate();
    else createMutation.mutate();
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div className="flex h-full flex-col gap-5 p-6" style={{ overflow: 'hidden' }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>
              {t('tenantAdmin.customFields.title')}
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--txt-2)' }}>
              {t('tenantAdmin.customFields.subtitle')}
            </p>
          </div>
          <Button onClick={openCreate}>+ {t('tenantAdmin.customFields.new')}</Button>
        </div>

        <section
          className="min-h-0 flex-1 overflow-y-auto rounded-xl"
          style={{ border: '1px solid var(--line)', background: 'var(--bg-2)' }}
        >
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-bg-3" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-sm" style={{ color: 'var(--txt-3)' }}>
              {t('tenantAdmin.common.noResults')}
            </div>
          ) : (
            <div className="flex flex-col">
              {sorted.map((field) => (
                <div
                  key={field.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                    borderBottom: '1px solid var(--line)', opacity: field.is_active ? 1 : 0.6,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{field.name}</span>
                  <span className="ticket-type-badge" style={{ background: 'var(--teal-dim)', color: 'var(--teal)', borderColor: 'transparent' }}>
                    {t(`tenantAdmin.customFields.types.${field.field_type}`)}
                  </span>
                  <code style={{ fontSize: 11, color: 'var(--txt-3)', fontFamily: 'var(--mono)' }}>{field.field_key}</code>
                  {field.required ? <span style={{ fontSize: 10, color: 'var(--amber)', textTransform: 'uppercase' }}>{t('tenantAdmin.customFields.required')}</span> : null}
                  {field.visible_in_portal ? <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('tenantAdmin.customFields.visiblePortal')}</span> : null}
                  {!field.is_active ? <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase' }}>{t('tenantAdmin.customFields.inactive')}</span> : null}

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button type="button" className="zd-btn" onClick={() => openEdit(field)}>
                      {t('tenantAdmin.common.edit')}
                    </button>
                    <button
                      type="button"
                      className="zd-btn"
                      onClick={() => deleteMutation.mutate(field.id)}
                      disabled={deleteMutation.isPending}
                    >
                      {t('tenantAdmin.common.remove')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {showModal ? (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div style={{ width: 460, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-lg)', padding: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)', marginBottom: 16 }}>
              {editingId ? t('tenantAdmin.customFields.editTitle') : t('tenantAdmin.customFields.new')}
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)' }}>{t('tenantAdmin.customFields.name')} *</span>
                <Input value={form.name} onChange={(e) => handleNameChange(e.target.value)} maxLength={100} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)' }}>{t('tenantAdmin.customFields.fieldKey')} *</span>
                <Input
                  value={form.field_key}
                  disabled={Boolean(editingId)}
                  onChange={(e) => { setKeyTouched(true); setForm((p) => ({ ...p, field_key: e.target.value })); }}
                  maxLength={50}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)' }}>{t('tenantAdmin.customFields.fieldType')} *</span>
                <select
                  className="filter-select"
                  value={form.field_type}
                  disabled={Boolean(editingId)}
                  onChange={(e) => setForm((p) => ({ ...p, field_type: e.target.value as CustomFieldType }))}
                >
                  {FIELD_TYPES.map((ft) => (
                    <option key={ft} value={ft}>{t(`tenantAdmin.customFields.types.${ft}`)}</option>
                  ))}
                </select>
              </label>

              {form.field_type === 'select' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)' }}>{t('tenantAdmin.customFields.options')}</span>
                  {form.options.map((opt, index) => (
                    <div key={index} style={{ display: 'flex', gap: 6 }}>
                      <Input
                        placeholder={t('tenantAdmin.customFields.optionLabel')}
                        value={opt.label}
                        onChange={(e) => setForm((p) => ({
                          ...p,
                          options: p.options.map((o, i) => (i === index ? { ...o, label: e.target.value } : o)),
                        }))}
                      />
                      <Input
                        placeholder={t('tenantAdmin.customFields.optionValue')}
                        value={opt.value}
                        onChange={(e) => setForm((p) => ({
                          ...p,
                          options: p.options.map((o, i) => (i === index ? { ...o, value: e.target.value } : o)),
                        }))}
                      />
                      <button type="button" className="zd-btn" onClick={() => setForm((p) => ({ ...p, options: p.options.filter((_, i) => i !== index) }))}>×</button>
                    </div>
                  ))}
                  <button type="button" className="zd-btn" onClick={() => setForm((p) => ({ ...p, options: [...p.options, { label: '', value: '' }] }))}>
                    + {t('tenantAdmin.customFields.addOption')}
                  </button>
                </div>
              ) : null}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'var(--txt)' }}>{t('tenantAdmin.customFields.required')}</span>
                <Toggle checked={form.required} onChange={(v) => setForm((p) => ({ ...p, required: v }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'var(--txt)' }}>{t('tenantAdmin.customFields.visiblePortal')}</span>
                <Toggle checked={form.visible_in_portal} onChange={(v) => setForm((p) => ({ ...p, visible_in_portal: v }))} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button type="button" className="zd-btn" onClick={closeModal}>{t('tenantAdmin.common.cancel')}</button>
              <button type="button" className="zd-btn zd-btn-primary" onClick={handleSubmit} disabled={isSaving}>
                {isSaving ? t('tenantAdmin.common.saving') : t('tenantAdmin.common.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
