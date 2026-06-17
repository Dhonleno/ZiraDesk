export type NotificationSoundType = 'message' | 'assignment' | 'help';

export function playNotificationSound(type: NotificationSoundType = 'message'): void {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    switch (type) {
      case 'message':
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.value = 0.06;
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.12);
        break;
      case 'assignment':
        oscillator.type = 'sine';
        oscillator.frequency.value = 660;
        gain.gain.value = 0.08;
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.2);
        break;
      case 'help':
        oscillator.type = 'triangle';
        oscillator.frequency.value = 520;
        gain.gain.value = 0.1;
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.3);
        break;
    }

    window.setTimeout(() => void ctx.close(), 500);
  } catch {
    // browser sem suporte de audio
  }
}
