import { queryClient } from '../lib/queryClient';
import { playNotificationSound, type NotificationSoundType, type SoundVariant } from './notificationSound';
import type { MyProfile } from '../services/api';

function getProfilePrefs() {
  const profile = queryClient.getQueryData<MyProfile>(['my-profile']);
  return {
    soundEnabled: profile?.notification_sound ?? true,
    desktopEnabled: profile?.notification_desktop ?? true,
    soundVariant: (profile?.notification_sound_variant ?? 'default') as SoundVariant,
  };
}

export function notifySound(type: NotificationSoundType): void {
  const { soundEnabled, soundVariant } = getProfilePrefs();
  if (!soundEnabled) return;
  playNotificationSound(type, soundVariant);
}

export function shouldShowDesktopNotification(): boolean {
  return getProfilePrefs().desktopEnabled;
}
