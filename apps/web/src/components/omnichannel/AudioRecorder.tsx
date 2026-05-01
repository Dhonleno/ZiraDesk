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

type StopMode = 'preview' | 'discard' | null;

const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <rect x="2.5" y="2" width="3" height="10" rx="1" fill="currentColor" />
    <rect x="8.5" y="2" width="3" height="10" rx="1" fill="currentColor" />
  </svg>
);

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M3 2l9 5-9 5V2z" fill="currentColor" />
  </svg>
);

const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M3 7.5l2.4 2.4L11 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M2 3.5h10M5 3.5V2.5h4v1M4.5 3.5v8h5v-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M14 2L1 7.5l5 1.5L7.5 14 14 2z" fill="currentColor" />
  </svg>
);

const MicIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <rect x="5" y="1" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M2.5 7c0 2.5 2 4.5 4.5 4.5S11.5 9.5 11.5 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M7 11.5V13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

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
  return !mimeType.toLowerCase().includes('mpeg');
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

function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function setupCanvas(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(120, Math.floor(canvas.clientWidth || 300));
  const height = 32;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawStaticWave(ctx: CanvasRenderingContext2D, width: number, height: number, color = 'rgba(157,163,174,.45)') {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

export const AudioRecorder = forwardRef<AudioRecorderHandle, AudioRecorderProps>(
  ({ conversationId, disabled, onSent, onActiveChange }, ref) => {
    const { t } = useTranslation('omnichannel');
    const toast = useToast();
    const { load, convertToMp3, progress } = useFFmpeg();

    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isPreview, setIsPreview] = useState(false);
    const [isPlayingPreview, setIsPlayingPreview] = useState(false);
    const [isConverting, setIsConverting] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const [nativeBlob, setNativeBlob] = useState<Blob | null>(null);
    const [nativeMime, setNativeMime] = useState('');
    const [audioUrl, setAudioUrl] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const stopModeRef = useRef<StopMode>(null);
    const timerRef = useRef<number | null>(null);
    const chunksRef = useRef<BlobPart[]>([]);
    const animFrameRef = useRef<number | null>(null);
    const previewAudioRef = useRef<HTMLAudioElement>(null);
    const liveCanvasRef = useRef<HTMLCanvasElement>(null);
    const staticCanvasRef = useRef<HTMLCanvasElement>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const liveAudioCtxRef = useRef<AudioContext | null>(null);
    const previewUrlRequestIdRef = useRef(0);
    const audioUrlRef = useRef<string | null>(null);

    const releasePreviewUrl = useCallback((url: string | null) => {
      if (!url) return;
      const previewAudio = previewAudioRef.current;
      if (previewAudio) {
        const currentSrc = previewAudio.currentSrc || previewAudio.src || previewAudio.getAttribute('src') || '';
        if (currentSrc.startsWith('blob:')) {
          previewAudio.pause();
          previewAudio.removeAttribute('src');
          previewAudio.load();
          setIsPlayingPreview(false);
        }
      }
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }, []);

    const stopTimer = useCallback(() => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, []);

    const startTimer = useCallback(() => {
      stopTimer();
      timerRef.current = window.setInterval(() => setSeconds((prev) => prev + 1), 1000);
    }, [stopTimer]);

    const stopWaveAnimation = useCallback(() => {
      if (animFrameRef.current !== null) {
        window.cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    }, []);

    const stopLiveAudioContext = useCallback(async () => {
      stopWaveAnimation();
      analyserRef.current?.disconnect();
      analyserRef.current = null;
      if (liveAudioCtxRef.current) {
        await liveAudioCtxRef.current.close();
        liveAudioCtxRef.current = null;
      }
    }, [stopWaveAnimation]);

    const resetRecorderState = useCallback((notifyInactive = true) => {
      stopTimer();
      void stopLiveAudioContext();
      mediaRecorderRef.current = null;
      stopModeRef.current = null;
      chunksRef.current = [];
      setIsRecording(false);
      setIsPaused(false);
      setIsPreview(false);
      setIsPlayingPreview(false);
      setIsConverting(false);
      setIsSending(false);
      setSeconds(0);
      setNativeBlob(null);
      setNativeMime('');
      previewUrlRequestIdRef.current += 1;
      releasePreviewUrl(audioUrlRef.current);
      setAudioUrl(null);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (notifyInactive) {
        onActiveChange?.(false);
      }
    }, [onActiveChange, releasePreviewUrl, stopLiveAudioContext, stopTimer]);

    const startWaveAnimation = useCallback((stream: MediaStream) => {
      const canvas = liveCanvasRef.current;
      if (!canvas) return;
      const setup = setupCanvas(canvas);
      if (!setup) return;
      const { ctx, width, height } = setup;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--teal').trim() || '#00C9A7';

      const audioCtx = new AudioContext();
      liveAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        if (!liveCanvasRef.current || !analyserRef.current) return;
        const next = setupCanvas(liveCanvasRef.current);
        if (!next) return;
        const dctx = next.ctx;
        const w = next.width;
        const h = next.height;

        analyserRef.current.getByteTimeDomainData(dataArray);
        dctx.clearRect(0, 0, w, h);
        const barWidth = 2;
        const gap = 2;
        const bars = Math.floor(w / (barWidth + gap));
        const step = Math.max(1, Math.floor(dataArray.length / bars));
        dctx.fillStyle = accent;
        for (let i = 0; i < bars; i++) {
          const raw = dataArray[i * step] ?? 128;
          const amp = Math.abs(raw - 128) / 128;
          const barHeight = Math.max(2, amp * h * 0.95);
          const x = i * (barWidth + gap);
          const y = (h - barHeight) / 2;
          dctx.fillRect(x, y, barWidth, barHeight);
        }

        animFrameRef.current = window.requestAnimationFrame(draw);
      };

      draw();
      drawStaticWave(ctx, width, height, 'rgba(0,201,167,.45)');
    }, []);

    const drawStaticWaveform = useCallback(async (blob: Blob, canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const setup = setupCanvas(canvas);
      if (!setup) return;
      const { ctx, width, height } = setup;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--teal').trim() || '#00C9A7';

      try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioCtx = new AudioContext();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
        const data = audioBuffer.getChannelData(0);

        ctx.clearRect(0, 0, width, height);
        const barWidth = 3;
        const gap = 2;
        const bars = Math.floor(width / (barWidth + gap));
        const step = Math.max(1, Math.floor(data.length / bars));

        for (let i = 0; i < bars; i++) {
          let max = 0;
          const start = i * step;
          const end = Math.min(data.length, start + step);
          for (let j = start; j < end; j++) {
            const value = Math.abs(data[j] ?? 0);
            if (value > max) max = value;
          }
          const barHeight = Math.max(2, max * height * 0.82);
          const y = (height - barHeight) / 2;
          ctx.fillStyle = accent;
          ctx.globalAlpha = 0.72;
          ctx.fillRect(i * (barWidth + gap), y, barWidth, barHeight);
        }
        ctx.globalAlpha = 1;
        await audioCtx.close();
      } catch {
        drawStaticWave(ctx, width, height, 'rgba(0,201,167,.5)');
      }
    }, []);

    useEffect(() => {
      audioUrlRef.current = audioUrl;
    }, [audioUrl]);

    useEffect(() => {
      void load().catch((err) => {
        console.error('[AudioRecorder] preload failed:', err);
      });
    }, [load]);

    useEffect(() => {
      return () => resetRecorderState(false);
    }, [resetRecorderState]);

    useEffect(() => {
      if (!nativeBlob || !isPreview) return;
      void drawStaticWaveform(nativeBlob, staticCanvasRef.current);
    }, [drawStaticWaveform, isPreview, nativeBlob]);

    useEffect(() => {
      if (!isPaused || !liveCanvasRef.current) return;
      stopWaveAnimation();
    }, [isPaused, stopWaveAnimation]);

    useEffect(() => {
      const audio = previewAudioRef.current;
      if (!audio) return;
      const onEnded = () => setIsPlayingPreview(false);
      audio.addEventListener('ended', onEnded);
      return () => {
        audio.removeEventListener('ended', onEnded);
      };
    }, [audioUrl]);

    const startRecording = async () => {
      if (disabled || isRecording || isConverting || isSending) return;
      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        toast.error(t('media.browserNotSupported', {
          defaultValue: 'Navegador nao suporta gravacao de audio.',
        }));
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        chunksRef.current = [];
        stopModeRef.current = null;

        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        let detectedChunkMime = mimeType.split(';')[0] ?? mimeType;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data);
            if (event.data.type) {
              detectedChunkMime = event.data.type.split(';')[0] ?? event.data.type;
            }
          }
        };

        recorder.onstop = () => {
          const mode = stopModeRef.current;
          const requestId = ++previewUrlRequestIdRef.current;
          stopModeRef.current = null;
          stopTimer();
          void stopLiveAudioContext();
          setIsRecording(false);
          setIsPaused(false);
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;

          if (mode === 'discard') {
            chunksRef.current = [];
            return;
          }

          const baseMime = (detectedChunkMime || mimeType).toLowerCase();
          const blob = new Blob(chunksRef.current, { type: baseMime });
          chunksRef.current = [];
          if (!blob.size) return;

          releasePreviewUrl(audioUrl);
          setNativeBlob(blob);
          setNativeMime(baseMime);
          void (async () => {
            try {
              const previewDataUrl = await fileToDataUrl(blob);
              if (previewUrlRequestIdRef.current !== requestId) return;
              setAudioUrl(previewDataUrl);
            } catch {
              if (previewUrlRequestIdRef.current !== requestId) return;
              setAudioUrl(URL.createObjectURL(blob));
            }
          })();
          setIsPreview(true);
          onActiveChange?.(true);
        };

        recorder.start();
        setIsRecording(true);
        setIsPaused(false);
        setIsPreview(false);
        setIsPlayingPreview(false);
        setSeconds(0);
        setNativeBlob(null);
        setNativeMime('');
        previewUrlRequestIdRef.current += 1;
        releasePreviewUrl(audioUrl);
        setAudioUrl(null);
        onActiveChange?.(true);
        startTimer();
        startWaveAnimation(stream);
      } catch {
        toast.error(t('media.permissionDenied'));
      }
    };

    const pauseRecording = () => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== 'recording') return;
      recorder.pause();
      setIsPaused(true);
      stopTimer();
      void stopLiveAudioContext();
    };

    const resumeRecording = () => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== 'paused') return;
      recorder.resume();
      setIsPaused(false);
      startTimer();
      if (streamRef.current) {
        startWaveAnimation(streamRef.current);
      }
    };

    const stopForPreview = () => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') return;
      stopModeRef.current = 'preview';
      recorder.stop();
      setIsPaused(false);
      stopTimer();
    };

    const cancelRecording = () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        stopModeRef.current = 'discard';
        recorder.stop();
        stopTimer();
        void stopLiveAudioContext();
        setIsRecording(false);
        setIsPaused(false);
        setIsPreview(false);
        setIsPlayingPreview(false);
        setIsConverting(false);
        setIsSending(false);
        setSeconds(0);
        setNativeBlob(null);
        setNativeMime('');
        previewUrlRequestIdRef.current += 1;
        releasePreviewUrl(audioUrl);
        setAudioUrl(null);
        onActiveChange?.(false);
        return;
      }
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.currentTime = 0;
      }
      resetRecorderState(true);
    };

    const togglePreviewPlay = async () => {
      const audio = previewAudioRef.current;
      if (!audio) return;
      if (isPlayingPreview) {
        audio.pause();
        setIsPlayingPreview(false);
        return;
      }
      await audio.play();
      setIsPlayingPreview(true);
    };

    const confirmSend = async () => {
      if (!nativeBlob || isConverting || isSending) return;
      setIsConverting(true);
      setIsSending(false);

      let localPreviewUrl: string | null = null;
      let handedOffToParent = false;
      try {
        const sourceMime = (nativeMime || nativeBlob.type || '').toLowerCase();
        const guessedExt = mimeToExt(sourceMime);
        const detectedExt = await detectContainerExt(nativeBlob);
        const sourceExt = detectedExt ?? guessedExt;
        const sourceMimeResolved = sourceMime || extToMime(sourceExt);
        const nativeFile = new File([nativeBlob], `audio-${Date.now()}.${sourceExt}`, { type: sourceMimeResolved });

        let fileToUpload: File;
        if (needsConversion(sourceMimeResolved)) {
          fileToUpload = await convertToMp3(nativeBlob, sourceExt);
        } else {
          fileToUpload = nativeFile;
        }

        setIsConverting(false);
        setIsSending(true);

        const upload = await omnichannelApi.uploadMedia(conversationId, fileToUpload);
        await omnichannelApi.sendMessage(conversationId, {
          media_id: upload.media_id,
          media_type: 'audio',
          media_filename: upload.filename,
          contentType: 'audio',
        });

        localPreviewUrl = await fileToDataUrl(fileToUpload);
        await onSent({
          mediaId: upload.media_id,
          localPreviewUrl,
        });
        handedOffToParent = true;
        resetRecorderState(true);
      } catch (error) {
        console.error('[AudioRecorder] send failed:', error);
        const rawMessage = extractErrorMessage(error);
        toast.error(rawMessage ?? t('media.uploadError'));
      } finally {
        if (localPreviewUrl && !handedOffToParent && localPreviewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(localPreviewUrl);
        }
        setIsConverting(false);
        setIsSending(false);
      }
    };

    useImperativeHandle(ref, () => ({
      start: startRecording,
      cancel: cancelRecording,
    }));

    const showConverting = isConverting || isSending;
    const isActive = isRecording || isPaused || isPreview || showConverting;
    if (!isActive) return null;

    if (showConverting) {
      const pct = isSending ? 100 : Math.max(0, Math.min(100, progress));
      return (
        <div
          className="audio-recorder-bar converting"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'var(--bg-3)',
            border: '1px solid var(--line-2)',
            borderRadius: 12,
            width: '100%',
            marginBottom: 8,
          }}
        >
          <div
            className="converting-spinner"
            style={{
              width: 16,
              height: 16,
              border: '2px solid var(--line-2)',
              borderTopColor: 'var(--teal)',
              borderRadius: '50%',
              animation: 'spin .8s linear infinite',
              flexShrink: 0,
            }}
          />
          <span style={{ color: 'var(--txt-2)', fontSize: 13 }}>
            {isSending ? 'Enviando audio...' : `Convertendo audio... ${pct}%`}
          </span>
          <div
            className="converting-bar"
            style={{
              flex: 1,
              height: 4,
              background: 'var(--bg-4)',
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            <div
              className="converting-fill"
              style={{
                width: `${pct}%`,
                height: '100%',
                background: 'var(--teal)',
                borderRadius: 999,
                transition: 'width .3s ease',
              }}
            />
          </div>
        </div>
      );
    }

    if (isPreview) {
      return (
        <div
          className="audio-recorder-bar preview"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'rgba(0,201,167,.05)',
            border: '1px solid rgba(0,201,167,.25)',
            borderRadius: 12,
            width: '100%',
            marginBottom: 8,
          }}
        >
          <button
            type="button"
            className="rec-cancel"
            onClick={cancelRecording}
            title="Descartar"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--red-dim)',
              border: '1px solid var(--red-dim)',
              color: 'var(--red)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <TrashIcon />
          </button>

          <button
            type="button"
            className="rec-play-preview"
            onClick={() => void togglePreviewPlay()}
            title={isPlayingPreview ? 'Pausar' : 'Ouvir gravacao'}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--bg-4)',
              border: '1px solid var(--line-2)',
              color: 'var(--txt)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all .15s',
            }}
          >
            {isPlayingPreview ? <PauseIcon /> : <PlayIcon />}
          </button>

          <div className="waveform-container" style={{ flex: 1, height: 32, display: 'flex', alignItems: 'center' }}>
            <canvas ref={staticCanvasRef} width={300} height={32} style={{ width: '100%', height: 32, display: 'block' }} />
          </div>

          <span
            className="rec-timer"
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--txt)',
              minWidth: 40,
              textAlign: 'center',
            }}
          >
            {formatTime(seconds)}
          </span>

          <audio
            ref={previewAudioRef}
            src={audioUrl ?? undefined}
            onEnded={() => setIsPlayingPreview(false)}
            style={{ display: 'none' }}
          />

          <button
            type="button"
            className="rec-send"
            onClick={() => void confirmSend()}
            title="Confirmar envio"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--teal)',
              border: 'none',
              color: '#0a1a18',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all .15s',
            }}
          >
            <SendIcon />
          </button>
        </div>
      );
    }

    return (
      <div
        className={`audio-recorder-bar ${isPaused ? 'paused' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: isPaused ? 'rgba(245,158,11,.05)' : 'var(--bg-3)',
          border: isPaused ? '1px solid rgba(245,158,11,.3)' : '1px solid var(--line-2)',
          borderRadius: 12,
          width: '100%',
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          className="rec-cancel"
          onClick={cancelRecording}
          title="Cancelar"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'var(--red-dim)',
            border: '1px solid var(--red-dim)',
            color: 'var(--red)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <TrashIcon />
        </button>

        {isPaused ? (
          <button
            type="button"
            className="rec-resume"
            onClick={resumeRecording}
            title="Retomar gravacao"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--red-dim)',
              border: 'none',
              color: 'var(--red)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'zd-pulse-dot 1.5s ease infinite',
            }}
          >
            <MicIcon />
          </button>
        ) : (
          <button
            type="button"
            className="rec-pause"
            onClick={pauseRecording}
            title="Pausar"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--bg-4)',
              border: '1px solid var(--line-2)',
              color: 'var(--txt)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PauseIcon />
          </button>
        )}

        <div className="waveform-container" style={{ flex: 1, height: 32, display: 'flex', alignItems: 'center' }}>
          <canvas ref={liveCanvasRef} width={300} height={32} style={{ width: '100%', height: 32, display: 'block' }} />
        </div>

        <div className="rec-status" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 115 }}>
          <span
            className="rec-timer"
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--txt)',
              minWidth: 40,
              textAlign: 'center',
            }}
          >
            {formatTime(seconds)}
          </span>
          {isPaused ? (
            <span
              className="rec-badge paused"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--amber)',
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              ⏸️ Pausado
            </span>
          ) : (
            <span
              className="rec-badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--red)',
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                className="rec-dot"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--red)',
                  animation: 'zd-pulse-dot 1s ease infinite',
                }}
              />
              REC
            </span>
          )}
        </div>

        <button
          type="button"
          className="rec-send"
          onClick={stopForPreview}
          title={isPaused ? 'Ir para revisao' : 'Parar e revisar'}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'var(--teal)',
            border: 'none',
            color: '#0a1a18',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all .15s',
          }}
        >
          {isPaused ? <CheckIcon /> : <StopIcon />}
        </button>
      </div>
    );
  },
);

AudioRecorder.displayName = 'AudioRecorder';
