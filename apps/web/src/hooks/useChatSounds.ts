import { useCallback } from 'react';
import { playSound, type SoundOption } from '../utils/chatSounds';
import { useChatSoundStore } from '../stores/chatSound.store';
import { isNotificationSoundEnabled } from '../utils/notify';

function playConfigured(kind: 'newConversation' | 'newMessage'): void {
  // Respeita o interruptor geral "Som de notificação" do perfil (persistido em banco).
  if (!isNotificationSoundEnabled()) return;
  const { config } = useChatSoundStore.getState();
  playSound(config[kind], config.volume);
}

/** Para handlers de socket, fora de componente React. */
export function playNewConversationSound(): void {
  playConfigured('newConversation');
}

/** Para handlers de socket, fora de componente React. */
export function playNewMessageSound(): void {
  playConfigured('newMessage');
}

export function useChatSounds() {
  const config = useChatSoundStore((state) => state.config);
  const saveConfig = useChatSoundStore((state) => state.saveConfig);

  const playNewConversation = useCallback(() => playNewConversationSound(), []);
  const playNewMessage = useCallback(() => playNewMessageSound(), []);

  // O preview ignora o interruptor geral: o botão "Testar" precisa soar sempre.
  const preview = useCallback(
    (type: SoundOption) => playSound(type, config.volume),
    [config.volume],
  );

  return { config, saveConfig, playNewConversation, playNewMessage, preview };
}
