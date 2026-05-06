import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm, type UseFormRegister } from 'react-hook-form';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { adminApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

type ChannelType = 'whatsapp' | 'instagram' | 'email' | 'webchat';

interface ChannelTypeOption {
  type: ChannelType;
  label: string;
  color: string;
  icon: React.ReactNode;
}

const CHANNEL_TYPES: ChannelTypeOption[] = [
  {
    type: 'whatsapp',
    label: 'WhatsApp',
    color: '#25D366',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    ),
  },
  {
    type: 'instagram',
    label: 'Instagram DM',
    color: '#E1306C',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden>
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    ),
  },
  {
    type: 'email',
    label: 'E-mail',
    color: 'var(--blue)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="22,6 12,13 2,6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    type: 'webchat',
    label: 'Web Chat',
    color: 'var(--teal)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AddChannelModal({ open, onClose }: Props) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<ChannelType | null>(null);
  const { register, handleSubmit, reset } = useForm<Record<string, string>>();

  const mutation = useMutation({
    mutationFn: (values: Record<string, string>) => {
      const { name, ...rest } = values;
      const credentials: Record<string, string> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v) credentials[k] = v;
      }
      return adminApi.createChannel({ type: selectedType!, name: name ?? '', credentials });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'channels'] });
      toast.success(t('tenantAdmin.channels.messages.created'));
      handleClose();
    },
    onError: () => {
      toast.error(t('tenantAdmin.common.errorSave'));
    },
  });

  function handleClose() {
    setStep(1);
    setSelectedType(null);
    reset();
    onClose();
  }

  function handleTypeSelect(type: ChannelType) {
    setSelectedType(type);
    setStep(2);
  }

  const selectedTypeMeta = CHANNEL_TYPES.find((ct) => ct.type === selectedType);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={step === 1 ? t('tenantAdmin.channels.add') : `${t('tenantAdmin.channels.add')} — ${selectedTypeMeta?.label}`}
      maxWidth="lg"
    >
      {step === 1 ? (
        <div className="grid grid-cols-2 gap-3">
          {CHANNEL_TYPES.map((ct) => (
            <button
              key={ct.type}
              type="button"
              onClick={() => handleTypeSelect(ct.type)}
              className="flex flex-col items-center gap-3 rounded-xl p-6 transition-all"
              style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = ct.color + '66';
                e.currentTarget.style.background = 'var(--bg-3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--line-2)';
                e.currentTarget.style.background = 'var(--bg-2)';
              }}
            >
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl"
                style={{ background: ct.color + '1A', color: ct.color }}
              >
                {ct.icon}
              </div>
              <span className="text-sm font-medium" style={{ color: 'var(--txt)' }}>{ct.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <Input label={t('tenantAdmin.channels.fields.name')} required {...register('name')} />

          {selectedType === 'whatsapp' && (
            <WhatsAppMetaFields register={register} />
          )}

          {selectedType === 'instagram' && (
            <>
              <Input label="Access Token" type="password" {...register('access_token')} />
              <Input label="Page ID" {...register('page_id')} />
              <Input label="Verify Token" {...register('verify_token')} />
            </>
          )}

          {selectedType === 'email' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Input label="SMTP Host" placeholder="smtp.gmail.com" {...register('smtp_host')} />
                <Input label="SMTP Port" placeholder="587" {...register('smtp_port')} />
              </div>
              <Input label="SMTP User" type="email" {...register('smtp_user')} />
              <Input label="SMTP Password" type="password" {...register('smtp_password')} />
              <div className="grid grid-cols-2 gap-4">
                <Input label="From Name" {...register('from_name')} />
                <Input label="From Email" type="email" {...register('from_email')} />
              </div>
            </>
          )}

          {selectedType === 'webchat' && (
            <div
              className="rounded-lg p-4"
              style={{ background: 'rgba(0,201,167,.08)', border: '1px solid rgba(0,201,167,.2)' }}
            >
              <p className="text-xs font-medium" style={{ color: 'var(--teal)' }}>Snippet de incorporação</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--txt-2)' }}>
                O código de incorporação será gerado após salvar o canal.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setStep(1)}>
              {t('tenantAdmin.common.back')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.channels.add')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

interface WhatsAppMetaFieldsProps {
  register: UseFormRegister<Record<string, string>>;
}

function WhatsAppMetaFields({ register }: WhatsAppMetaFieldsProps) {
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${window.location.origin}/api/webhooks/whatsapp`;

  function handleCopy() {
    void navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <>
      <Input label="Phone Number ID" required placeholder="704423209430762" {...register('phoneNumberId')} />
      <Input label="WABA ID" required placeholder="1922786558561358" {...register('wabaId')} />
      <Input label="Access Token" type="password" required {...register('accessToken')} />
      <Input label="Verify Token" required placeholder="ziradesk-webhook-2025" {...register('verifyToken')} />
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>Webhook URL</label>
        <div className="flex items-center gap-2">
          <div
            className="flex-1 h-10 rounded-lg px-3 flex items-center text-sm font-mono overflow-hidden"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', color: 'var(--txt-3)' }}
          >
            <span className="truncate">{webhookUrl}</span>
          </div>
          <Button type="button" variant="secondary" onClick={handleCopy} style={{ minWidth: '72px' }}>
            {copied ? 'Copiado!' : 'Copiar'}
          </Button>
        </div>
      </div>
    </>
  );
}
