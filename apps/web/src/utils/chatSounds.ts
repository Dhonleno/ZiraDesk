export type SoundOption = 'ding' | 'chime' | 'pop' | 'pulse' | 'none';

export interface SoundConfig {
  newConversation: SoundOption;
  newMessage: SoundOption;
  volume: number; // 0.0 a 1.0
}

export const DEFAULT_SOUND_CONFIG: SoundConfig = {
  newConversation: 'chime',
  newMessage: 'ding',
  volume: 0.7,
};

export const SOUND_OPTIONS: readonly SoundOption[] = ['none', 'ding', 'chime', 'pop', 'pulse'];

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const scope = window as Window & { webkitAudioContext?: AudioContextCtor };
  return scope.webkitAudioContext ?? null;
}

// Contexto compartilhado: navegadores limitam o número de AudioContexts
// simultâneos por página, então criar um por som quebra em rajada de mensagens.
let sharedCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;

  if (!sharedCtx || sharedCtx.state === 'closed') {
    try {
      sharedCtx = new Ctor();
    } catch {
      return null;
    }
  }

  // Política de autoplay: o contexto nasce suspenso até haver gesto do usuário.
  if (sharedCtx.state === 'suspended') {
    void sharedCtx.resume().catch(() => {});
  }

  return sharedCtx;
}

export function unlockChatAudio(): void {
  const ctx = getContext();
  if (!ctx || ctx.state !== 'suspended') return;
  void ctx.resume().catch(() => {});
}

export function playSound(type: SoundOption, volume = DEFAULT_SOUND_CONFIG.volume): void {
  if (type === 'none') return;

  const safeVolume = Math.min(Math.max(volume, 0), 1);
  // exponentialRampToValueAtTime não aceita rampa a partir de zero.
  if (safeVolume <= 0) return;

  const ctx = getContext();
  if (!ctx) return;

  try {
    const gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);
    gainNode.gain.value = safeVolume;

    switch (type) {
      case 'ding':
        // Sino simples — 1 nota, 800Hz, 0.3s
        playTone(ctx, gainNode, 800, 0, 0.3, 'sine');
        break;

      case 'chime':
        // Melodia 2 notas — 523Hz + 659Hz (Dó + Mi)
        playTone(ctx, gainNode, 523, 0, 0.25, 'sine');
        playTone(ctx, gainNode, 659, 0.18, 0.3, 'sine');
        break;

      case 'pop': {
        // Pop suave — 400→200Hz sweep curto
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(gainNode);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.1);
        g.gain.setValueAtTime(1, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.onended = () => {
          osc.disconnect();
          g.disconnect();
        };
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
        break;
      }

      case 'pulse':
        // Tom duplo urgente — 880Hz duas vezes
        playTone(ctx, gainNode, 880, 0, 0.15, 'square', 0.3);
        playTone(ctx, gainNode, 880, 0.2, 0.15, 'square', 0.3);
        break;
    }

    // Solta o nó de volume depois do som mais longo (0.48s no chime).
    window.setTimeout(() => gainNode.disconnect(), 1000);
  } catch {
    // browser sem suporte de Web Audio
  }
}

function playTone(
  ctx: AudioContext,
  destination: GainNode,
  freq: number,
  startDelay: number,
  duration: number,
  type: OscillatorType = 'sine',
  gainOverride?: number,
): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.connect(g);
  g.connect(destination);
  osc.type = type;
  osc.frequency.value = freq;

  const peak = gainOverride ?? 1;
  const startAt = ctx.currentTime + startDelay;
  g.gain.setValueAtTime(peak, startAt);
  g.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };

  osc.start(startAt);
  osc.stop(startAt + duration);
}
