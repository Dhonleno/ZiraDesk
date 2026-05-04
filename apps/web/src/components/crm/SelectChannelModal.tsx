import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';

export interface ChannelOption {
  id: string;
  type: string;
  name: string;
}

interface Props {
  open: boolean;
  channels: ChannelOption[];
  onClose: () => void;
  onSelect: (channelId: string) => void;
}

function channelIcon(type: string) {
  if (type === 'whatsapp') return '📱';
  if (type === 'email') return '📧';
  if (type === 'instagram') return '📸';
  return '💬';
}

export function SelectChannelModal({ open, channels, onClose, onSelect }: Props) {
  const { t } = useTranslation('crm');

  return (
    <Modal open={open} onClose={onClose} title={t('contacts.selectChannel')} maxWidth="sm">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--txt-2)' }}>
          {t('contacts.selectChannelHint')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => onSelect(channel.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--line)',
                background: 'var(--bg-3)',
                color: 'var(--txt)',
                cursor: 'pointer',
                fontFamily: 'var(--font)',
                fontSize: 13,
              }}
            >
              <span>{channelIcon(channel.type)}</span>
              <span style={{ fontWeight: 500 }}>{channel.name}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
