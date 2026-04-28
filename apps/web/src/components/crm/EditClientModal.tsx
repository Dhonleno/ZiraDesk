import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { crmApi } from '../../services/api';
import type { CrmClient } from '../../services/api';
import { useToast } from '../../stores/toast.store';

/* ── Schema ──────────────────────────────────────────────────────────────── */
const schema = z.object({
  name:           z.string().min(2, 'Mínimo 2 caracteres'),
  type:           z.enum(['person', 'company']),
  email:          z.union([z.string().email('E-mail inválido'), z.literal('')]).optional(),
  phone:          z.string().optional(),
  document:       z.string().optional(),
  status:         z.enum(['lead', 'prospect', 'client', 'negotiating', 'vip', 'inactive']),
  address_zip:    z.string().optional(),
  address_street: z.string().optional(),
  address_city:   z.string().optional(),
  address_state:  z.string().optional(),
  segment:        z.string().optional(),
  lead_source:    z.string().optional(),
  tags:           z.array(z.string()),
});

type FormValues = z.infer<typeof schema>;

/* ── Props ───────────────────────────────────────────────────────────────── */
interface Props {
  client: CrmClient | null;
  onClose: () => void;
}

/* ── Shared select style ─────────────────────────────────────────────────── */
const selectStyle: React.CSSProperties = {
  background:   'var(--bg-3)',
  border:       '1px solid var(--line)',
  color:        'var(--txt)',
  height:       '2.5rem',
  borderRadius: '0.5rem',
  padding:      '0 0.75rem',
  fontSize:     '0.875rem',
  width:        '100%',
  outline:      'none',
};

/* ── Normalize API status → form enum ───────────────────────────────────── */
function toFormStatus(s: string): FormValues['status'] {
  const map: Record<string, FormValues['status']> = {
    customer: 'client', client: 'client', inactive: 'inactive', negotiating: 'negotiating',
  };
  return (map[s] ?? s) as FormValues['status'];
}

/* ── Component ───────────────────────────────────────────────────────────── */
export function EditClientModal({ client, onClose }: Props) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tagInput, setTagInput] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'person', status: 'lead', tags: [] },
  });

  useEffect(() => {
    if (!client) return;
    reset({
      name:           client.name,
      type:           (client.type === 'company' ? 'company' : 'person'),
      email:          client.email          ?? '',
      phone:          client.phone          ?? '',
      document:       client.document       ?? '',
      status:         toFormStatus(client.status),
      address_zip:    client.address_zip    ?? '',
      address_street: client.address_street ?? '',
      address_city:   client.address_city   ?? '',
      address_state:  client.address_state  ?? '',
      segment:        client.segment        ?? '',
      lead_source:    client.lead_source    ?? '',
      tags:           client.tags,
    });
    setTagInput('');
  }, [client, reset]);

  const typeValue = watch('type');
  const tags      = watch('tags');

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
        const payload: Parameters<typeof crmApi.updateClient>[1] = {
        name:   values.name,
        type:   values.type,
        status: values.status,
        tags:   values.tags,
        ...(values.email          ? { email:          values.email }          : {}),
        ...(values.phone          ? { phone:          values.phone }          : {}),
        ...(values.document       ? { document:       values.document }       : {}),
        ...(values.address_zip    ? { address_zip:    values.address_zip }    : {}),
        ...(values.address_street ? { address_street: values.address_street } : {}),
        ...(values.address_city   ? { address_city:   values.address_city }   : {}),
        ...(values.address_state  ? { address_state:  values.address_state }  : {}),
        ...(values.segment        ? { segment:        values.segment }        : {}),
        ...(values.lead_source    ? { lead_source:    values.lead_source }    : {}),
      };
      return crmApi.updateClient(client!.id, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-client', client?.id] });
      void queryClient.invalidateQueries({ queryKey: ['crm-kpi'] });
      toast.success('Cliente atualizado com sucesso');
      onClose();
    },
    onError: () => {
      toast.error('Erro ao atualizar cliente');
    },
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
    setValue('tags', getValues('tags').filter((t) => t !== tag));
  }

  return (
    <Modal open={!!client} onClose={onClose} title="Editar cliente" maxWidth="md">
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))}>
        <div className="space-y-4">

          {/* Type toggle */}
          <div>
            <p className="text-sm font-medium mb-1.5" style={{ color: 'var(--txt-2)' }}>Tipo</p>
            <div style={{ display: 'flex', background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 8, padding: 2 }}>
              {(['person', 'company'] as const).map((tp) => (
                <button
                  key={tp} type="button" onClick={() => setValue('type', tp)}
                  style={{ flex: 1, padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', background: typeValue === tp ? 'var(--bg-5)' : 'transparent', color: typeValue === tp ? 'var(--txt)' : 'var(--txt-3)', transition: 'all .15s', fontFamily: 'var(--font)' }}
                >
                  {tp === 'person' ? 'Pessoa Física' : 'Empresa'}
                </button>
              ))}
            </div>
          </div>

          <Input label="Nome completo" error={errors.name?.message} autoFocus {...register('name')} />

          <div className="grid grid-cols-2 gap-3">
            <Input label="E-mail" type="email" error={errors.email?.message} {...register('email')} />
            <Input label="Telefone" type="tel" {...register('phone')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="CPF / CNPJ" {...register('document')} />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>Status</label>
              <select style={selectStyle} {...register('status')}>
                <option value="lead">Lead</option>
                <option value="prospect">Prospect</option>
                <option value="client">Cliente</option>
                <option value="negotiating">Negociando</option>
                <option value="vip">VIP</option>
                <option value="inactive">Inativo</option>
              </select>
              {errors.status && <p className="text-xs" style={{ color: '#F87171' }}>{errors.status.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="CEP" placeholder="00000-000" {...register('address_zip')} />
            <Input label="Cidade" {...register('address_city')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Logradouro" {...register('address_street')} />
            <Input label="Estado" maxLength={2} {...register('address_state')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Segmento" {...register('segment')} />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>Origem do lead</label>
              <select style={selectStyle} {...register('lead_source')}>
                <option value="">—</option>
                <option value="site">Site</option>
                <option value="indicacao">Indicação</option>
                <option value="redes_sociais">Redes sociais</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="outro">Outro</option>
              </select>
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>Tags</label>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                {tags.map((tag) => (
                  <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--teal-dim)', color: 'var(--teal)', border: '1px solid rgba(0,201,167,.25)', fontSize: 12 }}>
                    {tag}
                    <button
                      type="button" onClick={() => removeTag(tag)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', display: 'flex', alignItems: 'center', padding: 0, lineHeight: 1 }}
                      aria-label={`Remover ${tag}`}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                        <path d="M7.5 2.5l-5 5M2.5 2.5l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              placeholder="Digite e pressione Enter para adicionar"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={addTag}
              style={{ height: '2.5rem', width: '100%', borderRadius: '0.5rem', padding: '0 0.75rem', fontSize: '0.875rem', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt)', outline: 'none', fontFamily: 'var(--font)' }}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          </div>

        </div>
      </form>
    </Modal>
  );
}
