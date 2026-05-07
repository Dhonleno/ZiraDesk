import { useCallback, useEffect } from 'react';

type NotificationPermissionResult = NotificationPermission | 'unsupported';

function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined';
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermissionResult> {
  if (!isNotificationSupported()) return 'unsupported';

  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }

  return Notification.requestPermission();
}

export function useNotification() {
  useEffect(() => {
    void requestBrowserNotificationPermission();
  }, []);

  const showNotification = useCallback((title: string, body: string, icon?: string) => {
    if (!isNotificationSupported()) return;
    if (typeof document === 'undefined' || document.hidden !== true) return;
    if (Notification.permission !== 'granted') return;

    const options: NotificationOptions = { body };
    if (icon) {
      options.icon = icon;
    }
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }, []);

  return {
    showNotification,
  };
}
