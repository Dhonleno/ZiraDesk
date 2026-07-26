import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_SOUND_CONFIG, type SoundConfig } from '../utils/chatSounds';

interface ChatSoundState {
  config: SoundConfig;
  saveConfig: (partial: Partial<SoundConfig>) => void;
}

export const useChatSoundStore = create<ChatSoundState>()(
  persist(
    (set) => ({
      config: DEFAULT_SOUND_CONFIG,

      saveConfig: (partial) =>
        set((state) => ({ config: { ...state.config, ...partial } })),
    }),
    {
      name: 'zd-chat-sounds',
      storage: createJSONStorage(() => localStorage),
      // Preenche com os defaults qualquer campo ausente no que foi persistido,
      // para que uma opção nova não chegue como undefined em storage antigo.
      merge: (persisted, current) => {
        const stored = (persisted as { config?: Partial<SoundConfig> } | undefined)?.config;
        return { ...current, config: { ...DEFAULT_SOUND_CONFIG, ...stored } };
      },
    },
  ),
);
