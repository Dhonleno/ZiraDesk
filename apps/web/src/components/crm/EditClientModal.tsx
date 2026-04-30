import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { contactsApi } from '../../services/api';
import type { CrmContact } from '../../services/api';
import { useToast } from '../../stores/toast.store';

const schema = z.object({
  name:       z.string().min(2, 'Mínimo 2 caracteres'),
  email:      z.union([z.string().email('E-mail inválido'), z.literal('')]).optional(),
  phone:      z.string().optional(),
  whatsapp:   z.string().optional(),
  document:   z.string().optional(),
  role:       z.string().optional(),
  department: z.string().optional(),
  notes:      z.string().optional(),
  tags:       z.array(z.string()),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  client: CrmContact | null;
  onClose: () => void;
}

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
    defaultValues: { tags: [] },
  });

  useEffect(() => {
    if (!client) return;
    reset({
      name:       client.name,
      email:      client.email      ?? '',
      phone:      client.phone      ?? '',
      whatsapp:   client.whatsapp   ?? '',
      document:   client.document   ?? '',
      role:       client.role       ?? '',
      department: client.department ?? '',
      notes:      client.notes      ?? '',
      tags:       client.tags,
    });
    setTagInput('');
  }, [client, reset]);

  const tags = watch('tags');

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload: Partial<CrmContact> = {
        name:       values.name,
        email:      values.email      || null,
        phone:      values.phone      || null,
        whatsapp:   values.whatsapp   || null,
        document:   values.document   || null,
        role:       values.role       || null,
        department: values.department || null,
        notes:      values.notes      || null,
        tags:       values.tags,
      };
      return contactsApi.update(client!.id, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-contact', client?.id] });
      toast.success('Contato atualizado com sucesso');
      onClose();
    },
    onError: () => {
      toast.error('Erro ao atualizar contato');
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
    <Modal open={!!client} onClose={onClose} title="Editar contato" maxWidth="md">
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))}>
        <div className="space-y-4">

          <Input label="Nome completo" error={errors.name?.message} autoFocus {...register('name')} />

          <div className="grid grid-cols-2 gap-3">
            <Input label="E-mail" type="email" error={errors.email?.message} {...register('email')} />
            <Input label="Telefone" type="tel" {...register('phone')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="WhatsApp" type="tel" placeholder="+55 11 99999-9999" {...register('whatsapp')} />
            <Input label="CPF / CNPJ" {...register('document')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Cargo" {...register('role')} />
            <Input label="Departamento" {...register('department')} />
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
