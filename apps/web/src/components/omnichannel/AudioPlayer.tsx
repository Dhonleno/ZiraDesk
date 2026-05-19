import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

interface AudioPlayerProps {
  src: string;
  isOutgoing?: boolean;
}

const SPEEDS = [1, 1.5, 2] as const;
const WAVE_BARS = 30;

export function AudioPlayer({ src, isOutgoing = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  const speed = SPEEDS[speedIndex] ?? 1;
  const progress = duration > 0 ? currentTime / duration : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setIsLoaded(true);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.playbackRate = 1;
    setCurrentTime(0);
    setDuration(0);
    setSpeedIndex(0);
    setIsLoaded(false);
    setIsPlaying(false);
  }, [src]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setIsPlaying(false);
      }
      return;
    }

    audio.pause();
  };

  const handleSeek = (e: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = Number(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const cycleSpeed = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextIndex = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(nextIndex);
    audio.playbackRate = SPEEDS[nextIndex] ?? 1;
  };

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const bars = useMemo(
    () => Array.from({ length: WAVE_BARS }).map((_, i) => {
      const base = 4 + Math.sin(i * 0.8) * 7 + Math.sin(i * 1.3) * 5;
      return Math.max(4, base);
    }),
    [],
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        minWidth: 220,
        maxWidth: 280,
      }}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        type="button"
        onClick={() => void togglePlay()}
        aria-label={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
        title={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: 'none',
          background: isOutgoing ? 'var(--teal-dim)' : 'var(--teal)',
          color: isOutgoing ? 'var(--teal)' : 'var(--on-teal)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
          opacity: isLoaded ? 1 : 0.75,
          transition: 'opacity .15s',
        }}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
            <rect x="2" y="2" width="4" height="10" rx="1" />
            <rect x="8" y="2" width="4" height="10" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
            <path d="M3 2.5l9 4.5-9 4.5V2.5z" />
          </svg>
        )}
      </button>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ position: 'relative', height: 28, cursor: 'pointer' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              height: '100%',
              position: 'absolute',
              inset: 0,
            }}
          >
            {bars.map((barHeight, i) => {
              const filled = i / WAVE_BARS <= progress;
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: `${barHeight}px`,
                    borderRadius: 2,
                    background: filled
                      ? (isOutgoing ? 'var(--teal)' : 'var(--teal)')
                      : (isOutgoing ? 'var(--line-2)' : 'var(--bg-5)'),
                    transition: 'background .1s',
                  }}
                />
              );
            })}
          </div>

          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            aria-label="Progresso do áudio"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer',
              margin: 0,
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--mono)',
              color: isOutgoing ? 'var(--txt-2)' : 'var(--txt-3)',
            }}
          >
            {isPlaying ? formatTime(currentTime) : formatTime(duration)}
          </span>

          <button
            type="button"
            onClick={cycleSpeed}
            aria-label={`Velocidade ${speed}x`}
            title="Alterar velocidade"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'var(--mono)',
              fontWeight: 600,
              color: isOutgoing ? 'var(--txt-2)' : 'var(--txt-2)',
              padding: '0 2px',
              borderRadius: 4,
              transition: 'opacity .15s',
            }}
          >
            {speed === 1 ? '1×' : `${speed}×`}
          </button>
        </div>
      </div>
    </div>
  );
}
