export type NotificationSoundType = 'message' | 'assignment' | 'help';
export type SoundVariant = 'default' | 'soft' | 'sharp';

const VARIANT_ADJUST: Record<SoundVariant, { freqMultiplier: number; waveform?: OscillatorType }> = {
  default: { freqMultiplier: 1 },
  soft:    { freqMultiplier: 0.75, waveform: 'sine' },
  sharp:   { freqMultiplier: 1.3,  waveform: 'square' },
};

export function playNotificationSound(
  type: NotificationSoundType = 'message',
  variant: SoundVariant = 'default',
): void {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    const adjust = VARIANT_ADJUST[variant];

    switch (type) {
      case 'message':
        oscillator.type = adjust.waveform ?? 'sine';
        oscillator.frequency.value = 880 * adjust.freqMultiplier;
        gain.gain.value = 0.06;
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.12);
        break;
      case 'assignment':
        oscillator.type = adjust.waveform ?? 'sine';
        oscillator.frequency.value = 660 * adjust.freqMultiplier;
        gain.gain.value = 0.08;
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.2);
        break;
      case 'help':
        oscillator.type = adjust.waveform ?? 'triangle';
        oscillator.frequency.value = 520 * adjust.freqMultiplier;
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
