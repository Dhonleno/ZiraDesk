import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { omnichannelApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';
import { useFFmpeg } from '../../hooks/useFFmpeg';
import type { SentMediaPayload } from './MediaUpload';

export interface AudioRecorderHandle {
  start: () => Promise<void>;
  cancel: () => void;
}

interface AudioRecorderProps {
  conversationId: string;
  disabled?: boolean;
  onSent: (payload: SentMediaPayload) => Promise<void> | void;
  onActiveChange?: (active: boolean) => void;
}

interface AudioWaveformProps {
  isRecording: boolean;
  stream: MediaStream | null;
  audioBlob: Blob | null;
}

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  const candidates = [
    'audio/mpeg',
    'audio/ogg;codecs=opus',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function needsConversion(mimeType: string): boolean {
  const normalizedMime = mimeType.toLowerCase();
  return !normalizedMime.includes('mpeg');
}

function mimeToExt(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('aac')) return 'aac';
  if (mimeType.includes('amr')) return 'amr';
  if (mimeType.includes('webm')) return 'webm';
  return 'audio';
}

function extToMime(ext: string): string {
  switch (ext) {
    case 'mp3': return 'audio/mpeg';
    case 'ogg': return 'audio/ogg';
    case 'mp4': return 'audio/mp4';
    case 'aac': return 'audio/aac';
    case 'amr': return 'audio/amr';
    case 'webm': return 'audio/webm';
    default: return 'application/octet-stream';
  }
}

async function detectContainerExt(blob: Blob): Promise<string | null> {
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const h0 = header[0] ?? 0;
  const h1 = header[1] ?? 0;
  const h2 = header[2] ?? 0;
  const h3 = header[3] ?? 0;
  const h4 = header[4] ?? 0;
  const h5 = header[5] ?? 0;
  const h6 = header[6] ?? 0;
  const h7 = header[7] ?? 0;

  if (header.length >= 4) {
    if (h0 === 0x1a && h1 === 0x45 && h2 === 0xdf && h3 === 0xa3) return 'webm';
    if (h0 === 0x4f && h1 === 0x67 && h2 === 0x67 && h3 === 0x53) return 'ogg';
  }
  if (header.length >= 8 && h4 === 0x66 && h5 === 0x74 && h6 === 0x79 && h7 === 0x70) return 'mp4';
  if (header.length >= 3 && h0 === 0x49 && h1 === 0x44 && h2 === 0x33) return 'mp3';
  if (header.length >= 2 && h0 === 0xff && (h1 & 0xf0) === 0xf0) return 'aac';

  return null;
}

function extractErrorMessage(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const maybeErr = err as {
    response?: { data?: { error?: { message?: string } } };
    message?: string;
  };
  return maybeErr.response?.data?.error?.message ?? maybeErr.message ?? null;
}

function formatTime(seconds: number) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function drawIdleWave(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(157,163,174,.4)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

function useCanvasSize(canvasRef: React.RefObject<HTMLCanvasElement>) {
  return useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(120, Math.floor(canvas.clientWidth));
    const height = 32;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }, [canvasRef]);
}

function AudioWaveform({ isRecording, stream, audioBlob }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prepareCanvas = useCanvasSize(canvasRef);

  useEffect(() => {
    const setup = prepareCanvas();
    if (setup) {
      drawIdleWave(setup.ctx, setup.width, setup.height);
    }
  }, [prepareCanvas]);

  useEffect(() => {
    if (!isRecording || !stream) return;

    const setup = prepareCanvas();
    if (!setup) return;
    const { ctx, width, height } = setup;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--teal').trim() || '#00C9A7';

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    let raf = 0;
    const draw = () => {
      const next = prepareCanvas();
      if (!next) return;
      const drawCtx = next.ctx;
      const drawWidth = next.width;
      const drawHeight = next.height;
      analyser.getByteTimeDomainData(dataArray);
      drawCtx.clearRect(0, 0, drawWidth, drawHeight);

      const barWidth = 2;
      const gap = 2;
      const bars = Math.floor(drawWidth / (barWidth + gap));
      const step = Math.max(1, Math.floor(dataArray.length / bars));

      drawCtx.fillStyle = accent;
      for (let i = 0; i < bars; i++) {
        const raw = dataArray[i * step] ?? 128;
        const amp = Math.abs(raw - 128) / 128;
        const barHeight = Math.max(3, amp * drawHeight * 0.95);
        const x = i * (barWidth + gap);
        const y = (drawHeight - barHeight) / 2;
        drawCtx.fillRect(x, y, barWidth, barHeight);
      }
      raf = window.requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close();
      drawIdleWave(ctx, width, height);
    };
  }, [isRecording, prepareCanvas, stream]);

  useEffect(() => {
    if (isRecording || !audioBlob) return;
    let cancelled = false;

    const drawStatic = async () => {
      const setup = prepareCanvas();
      if (!setup) return;
      const { ctx, width, height } = setup;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--teal').trim() || '#00C9A7';

      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        if (cancelled) return;

        const audioContext = new AudioContext();
        const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        if (cancelled) {
          await audioContext.close();
          return;
        }

        const channel = buffer.getChannelData(0);
        const barWidth = 2;
        const gap = 2;
        const bars = Math.floor(width / (barWidth + gap));
        const samplesPerBar = Math.max(1, Math.floor(channel.length / bars));

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = accent;
        for (let i = 0; i < bars; i++) {
          const from = i * samplesPerBar;
          const to = Math.min(channel.length, from + samplesPerBar);
          let peak = 0;
          for (let j = from; j < to; j++) {
            const value = Math.abs(channel[j] ?? 0);
            if (value > peak) peak = value;
          }
          const barHeight = Math.max(3, peak * height * 0.95);
          const x = i * (barWidth + gap);
          const y = (height - barHeight) / 2;
          ctx.fillRect(x, y, barWidth, barHeight);
        }
        await audioContext.close();
      } catch {
        drawIdleWave(ctx, width, height);
      }
    };

    void drawStatic();
    return () => { cancelled = true; };
  }, [audioBlob, isRecording, prepareCanvas]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform-canvas"
      style={{ width: '100%', height: 32, display: 'block' }}
    />
  );
}

export const AudioRecorder = forwardRef<AudioRecorderHandle, AudioRecorderProps>(
  ({ conversationId, disabled, onSent, onActiveChange }, ref) => {
    const { t } = useTranslation('omnichannel');
    const toast = useToast();
    const { load, convertToMp3, isLoading: ffmpegLoading, progress } = useFFmpeg();

    const [isRecording, setIsRecording] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const [nativeBlob, setNativeBlob] = useState<Blob | null>(null);
    const [nativeMime, setNativeMime] = useState('');
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [isConverting, setIsConverting] = useState(false);
    const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

    const timerRef = useRef<number | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const autoSendAfterStopRef = useRef(false);
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);

    const stopTimer = () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const clear = useCallback(() => {
      stopTimer();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setSeconds(0);
      setNativeBlob(null);
      setNativeMime('');
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setRecordingStream((prev) => {
        prev?.getTracks().forEach((track) => track.stop());
        return null;
      });
      setIsConverting(false);
      setIsPreviewPlaying(false);
      autoSendAfterStopRef.current = false;
      onActiveChange?.(false);
    }, [audioUrl, onActiveChange]);

    useEffect(() => {
      void load().catch((err) => {
        console.error('[AudioRecorder] FFmpeg preload failed:', err);
      });
      return () => { clear(); };
    }, [clear, load]);

    useEffect(() => {
      const audio = previewAudioRef.current;
      if (!audio) return;
      const onEnded = () => setIsPreviewPlaying(false);
      const onPause = () => setIsPreviewPlaying(false);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('pause', onPause);
      return () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('pause', onPause);
      };
    }, [audioUrl]);

    const sendAudio = useCallback(async (
      inputBlob?: Blob,
      inputMime?: string,
    ) => {
      const sourceBlob = inputBlob ?? nativeBlob;
      if (!sourceBlob || isSending || isConverting) return;

      setIsSending(true);
      let localPreviewUrl: string | null = null;
      let handedOffToParent = false;
      try {
        let fileToUpload: File;
        const sourceMime = (inputMime || nativeMime || sourceBlob.type || '').toLowerCase();
        const guessedExtFromMime = mimeToExt(sourceMime);
        const detectedExt = await detectContainerExt(sourceBlob);
        const sourceExt = detectedExt ?? guessedExtFromMime;
        const sourceMimeResolved = sourceMime || extToMime(sourceExt);
        const nativeFile = new File([sourceBlob], `audio-${Date.now()}.${sourceExt}`, { type: sourceMimeResolved });

        if (needsConversion(sourceMimeResolved)) {
          setIsConverting(true);
          try {
            fileToUpload = await convertToMp3(sourceBlob, sourceExt);
          } catch (convertErr) {
            console.error('[AudioRecorder] conversion failed', {
              sourceMime: sourceMimeResolved,
              sourceExt,
              detectedExt,
              error: extractErrorMessage(convertErr),
            });
            throw convertErr;
          } finally {
            setIsConverting(false);
          }
        } else {
          fileToUpload = nativeFile;
        }

        const upload = await omnichannelApi.uploadMedia(conversationId, fileToUpload);
        await omnichannelApi.sendMessage(conversationId, {
          media_id: upload.media_id,
          media_type: 'audio',
          media_filename: upload.filename,
          contentType: 'audio',
        });

        localPreviewUrl = URL.createObjectURL(fileToUpload);
        clear();
        await onSent({
          mediaId: upload.media_id,
          localPreviewUrl,
        });
        handedOffToParent = true;
      } catch (err) {
        setIsConverting(false);
        console.error('[AudioRecorder] send failed:', err);
        const rawMessage = extractErrorMessage(err);
        const message = rawMessage?.includes('FFmpeg')
          ? 'Erro ao converter audio localmente. Recarregue a pagina e tente novamente.'
          : rawMessage ?? t('media.uploadError');
        toast.error(message);
      } finally {
        if (localPreviewUrl && !handedOffToParent) {
          URL.revokeObjectURL(localPreviewUrl);
        }
        setIsSending(false);
      }
    }, [clear, conversationId, convertToMp3, isConverting, isSending, nativeBlob, nativeMime, onSent, t, toast]);

    const startRecording = async () => {
      if (disabled || isRecording) return;

      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        toast.error(t('media.browserNotSupported', {
          defaultValue: 'Navegador nao suporta gravacao de audio. Envie um arquivo .ogg/.mp3/.m4a pelo anexo.',
        }));
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks: BlobPart[] = [];
        let detectedChunkMime = mimeType.split(';')[0] ?? mimeType;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
            if (event.data.type) {
              detectedChunkMime = event.data.type.split(';')[0] ?? event.data.type;
            }
          }
        };

        recorder.onstop = () => {
          try {
            const resolvedMime = detectedChunkMime || recorder.mimeType || mimeType;
            const baseMime = (resolvedMime.split(';')[0] ?? resolvedMime).toLowerCase();
            const blob = new Blob(chunks, { type: baseMime });
            setNativeBlob(blob);
            setNativeMime(baseMime);
            const previewUrl = URL.createObjectURL(blob);
            setAudioUrl(previewUrl);

            if (autoSendAfterStopRef.current) {
              autoSendAfterStopRef.current = false;
              void sendAudio(blob, baseMime);
            }
          } finally {
            stream.getTracks().forEach((track) => track.stop());
            setRecordingStream(null);
          }
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        setRecordingStream(stream);
        setIsRecording(true);
        setSeconds(0);
        setNativeBlob(null);
        setNativeMime('');
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
        setIsPreviewPlaying(false);
        onActiveChange?.(true);
        timerRef.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
      } catch {
        toast.error(t('media.permissionDenied'));
      }
    };

    const stopRecording = () => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      stopTimer();
    };

    const stopAndSendRecording = () => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;
      autoSendAfterStopRef.current = true;
      stopRecording();
    };

    const togglePreviewPlayback = async () => {
      if (!previewAudioRef.current) return;
      if (isPreviewPlaying) {
        previewAudioRef.current.pause();
        setIsPreviewPlaying(false);
        return;
      }
      await previewAudioRef.current.play();
      setIsPreviewPlaying(true);
    };

    useImperativeHandle(ref, () => ({
      start: startRecording,
      cancel: clear,
    }));

    if (!isRecording && !nativeBlob) return null;

    const busy = isSending || isConverting || ffmpegLoading;

    return (
      <div
        className="audio-recorder-bar"
        style={{
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          background: 'var(--bg-3)',
          border: '1px solid var(--line-2)',
          borderRadius: 12,
          width: '100%',
        }}
      >
        <button
          type="button"
          className="rec-cancel"
          onClick={clear}
          disabled={busy}
          title="Cancelar gravacao"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid var(--red-dim)',
            background: 'var(--red-dim)',
            color: 'var(--red)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.5 : 1,
            transition: 'all .15s',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M2 3h10M5 3V2h4v1M4 5v6M7 5v6M10 5v6M3 3l.5 9a1 1 0 001 1h5a1 1 0 001-1L11 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>

        {isRecording ? (
          <button
            type="button"
            onClick={stopRecording}
            title="Parar gravacao"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: '1px solid rgba(248,113,113,.45)',
              background: 'rgba(248,113,113,.12)',
              color: 'var(--red)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: 'currentColor', display: 'inline-block' }} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void togglePreviewPlayback()}
            title={isPreviewPlaying ? 'Pausar audio' : 'Reproduzir audio'}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: '1px solid var(--line-2)',
              background: 'var(--bg-4)',
              color: 'var(--txt-2)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all .15s',
            }}
          >
            {isPreviewPlaying ? (
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'currentColor', display: 'inline-block' }} />
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M3 2.2l6 3.8-6 3.8V2.2z" fill="currentColor" />
              </svg>
            )}
          </button>
        )}

        <div className="waveform-container" style={{ flex: 1, minWidth: 120, height: 32, display: 'flex', alignItems: 'center' }}>
          <AudioWaveform isRecording={isRecording} stream={recordingStream} audioBlob={nativeBlob} />
        </div>

        <span
          className="rec-timer"
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 13,
            color: 'var(--txt)',
            minWidth: 42,
            textAlign: 'center',
          }}
        >
          {formatTime(seconds)}
        </span>

        <div
          className="rec-indicator"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: isRecording ? 'var(--red)' : 'var(--txt-3)',
            fontSize: 11,
            fontWeight: 600,
            minWidth: 42,
          }}
        >
          <span
            className="rec-dot"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--red)',
              animation: isRecording ? 'zd-pulse-dot 1s ease infinite' : 'none',
              opacity: isRecording ? 1 : 0.35,
            }}
          />
          REC
        </div>

        {isRecording ? (
          <button
            type="button"
            className="rec-send"
            onClick={stopAndSendRecording}
            title="Parar e enviar"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--teal)',
              border: 'none',
              color: '#0a1a18',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all .15s',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M16 2L1 8.5l6 1.5 1.5 6L16 2z" fill="currentColor" />
              <path d="M7 10l4-4" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="rec-send"
            onClick={() => void sendAudio()}
            disabled={busy}
            title="Enviar audio"
            style={{
              width: 82,
              height: 36,
              borderRadius: 18,
              background: 'var(--teal)',
              border: 'none',
              color: '#0a1a18',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              transition: 'all .15s',
              fontWeight: 600,
              fontSize: 12,
              gap: 6,
              padding: '0 10px',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M2 8l3 3 9-9" stroke="#0a1a18" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Enviar
          </button>
        )}

        {audioUrl && (
          <audio
            ref={previewAudioRef}
            src={audioUrl}
            style={{ display: 'none' }}
            preload="metadata"
          />
        )}

        {(isConverting || ffmpegLoading || isSending) && (
          <div
            style={{
              position: 'absolute',
              marginTop: 56,
              marginLeft: 6,
              fontSize: 11,
              color: 'var(--txt-2)',
              fontFamily: 'var(--mono)',
            }}
          >
            {ffmpegLoading
              ? 'Carregando conversor...'
              : isConverting
                ? `Convertendo... ${progress}%`
                : 'Enviando...'}
          </div>
        )}
      </div>
    );
  },
);

AudioRecorder.displayName = 'AudioRecorder';
