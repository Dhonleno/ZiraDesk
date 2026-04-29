import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
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
  // Para o fluxo do gravador, padronizamos tudo em MP3 para evitar rejeição assíncrona no WhatsApp.
  return !normalizedMime.includes('mpeg');
}

function mimeToExt(mimeType: string): string {
  if (mimeType.includes('ogg'))  return 'ogg';
  if (mimeType.includes('mp4'))  return 'mp4';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('aac'))  return 'aac';
  if (mimeType.includes('amr'))  return 'amr';
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
    // WebM / Matroska
    if (
      h0 === 0x1a &&
      h1 === 0x45 &&
      h2 === 0xdf &&
      h3 === 0xa3
    ) return 'webm';

    // OGG
    if (
      h0 === 0x4f &&
      h1 === 0x67 &&
      h2 === 0x67 &&
      h3 === 0x53
    ) return 'ogg';
  }

  // MP4/M4A (ftyp box)
  if (
    header.length >= 8 &&
    h4 === 0x66 &&
    h5 === 0x74 &&
    h6 === 0x79 &&
    h7 === 0x70
  ) return 'mp4';

  // MP3 with ID3 header
  if (header.length >= 3 && h0 === 0x49 && h1 === 0x44 && h2 === 0x33) {
    return 'mp3';
  }

  // AAC ADTS frame sync
  if (header.length >= 2 && h0 === 0xff && (h1 & 0xf0) === 0xf0) {
    return 'aac';
  }

  return null;
}

function extractErrorMessage(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const maybeErr = err as {
    response?: {
      data?: {
        error?: {
          message?: string;
        };
      };
    };
    message?: string;
  };
  return (
    maybeErr.response?.data?.error?.message
    ?? maybeErr.message
    ?? null
  );
}

function formatTime(seconds: number) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
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
    const [isSending, setIsSending] = useState(false);
    const [isConverting, setIsConverting] = useState(false);

    const timerRef = useRef<number | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);

    const stopTimer = () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const clear = () => {
      stopTimer();
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setSeconds(0);
      setNativeBlob(null);
      setNativeMime('');
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setIsConverting(false);
      onActiveChange?.(false);
    };

    // Pré-carregar FFmpeg em background ao montar para acelerar a primeira conversão
    useEffect(() => {
      void load().catch((err) => {
        console.error('[AudioRecorder] FFmpeg preload failed:', err);
      });
      return () => { clear(); };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const startRecording = async () => {
      if (disabled || isRecording) return;

      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        toast.error(t('media.browserNotSupported', {
          defaultValue: 'Navegador não suporta gravação de áudio. Envie um arquivo .ogg/.mp3/.m4a pelo anexo.',
        }));
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks: BlobPart[] = [];
        let detectedChunkMime = mimeType.split(';')[0] ?? mimeType;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
            if (e.data.type) {
              detectedChunkMime = e.data.type.split(';')[0] ?? e.data.type;
            }
          }
        };

        recorder.onstop = () => {
          try {
            const resolvedMime = (
              detectedChunkMime ||
              recorder.mimeType ||
              mimeType
            );
            const mimeHead = resolvedMime.split(';')[0];
            const baseMime = (mimeHead ?? resolvedMime).toLowerCase();
            const blob = new Blob(chunks, { type: baseMime });
            setNativeBlob(blob);
            setNativeMime(baseMime);
            setAudioUrl(URL.createObjectURL(blob));
          } finally {
            stream.getTracks().forEach((t) => t.stop());
          }
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
        setSeconds(0);
        onActiveChange?.(true);
        timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
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

    const sendAudio = async () => {
      if (!nativeBlob || isSending || isConverting) return;

      setIsSending(true);
      let localPreviewUrl: string | null = null;
      let handedOffToParent = false;
      try {
        let fileToUpload: File;
        const sourceMime = (nativeMime || nativeBlob.type || '').toLowerCase();
        const guessedExtFromMime = mimeToExt(sourceMime);
        const detectedExt = await detectContainerExt(nativeBlob);
        const sourceExt = detectedExt ?? guessedExtFromMime;
        const sourceMimeResolved = sourceMime || extToMime(sourceExt);
        const nativeFile = new File([nativeBlob], `audio-${Date.now()}.${sourceExt}`, { type: sourceMimeResolved });

        if (needsConversion(sourceMimeResolved)) {
          setIsConverting(true);
          try {
            fileToUpload = await convertToMp3(nativeBlob, sourceExt);
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
          ? 'Erro ao converter áudio localmente. Recarregue a página e tente novamente.'
          : rawMessage ?? t('media.uploadError');
        toast.error(message);
      } finally {
        if (localPreviewUrl && !handedOffToParent) {
          URL.revokeObjectURL(localPreviewUrl);
        }
        setIsSending(false);
      }
    };

    useImperativeHandle(ref, () => ({
      start: startRecording,
      cancel: clear,
    }));

    if (!isRecording && !nativeBlob) return null;

    const busy = isSending || isConverting || ffmpegLoading;

    return (
      <div
        style={{
          marginBottom: 10,
          border: '1px solid var(--line-2)',
          background: 'var(--bg-3)',
          borderRadius: 'var(--r)',
          padding: 10,
        }}
      >
        {isRecording ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--txt-2)', fontSize: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite' }} />
              {t('media.recording')}
              <strong style={{ fontFamily: 'var(--mono)' }}>{formatTime(seconds)}</strong>
            </div>
            <button
              type="button"
              onClick={stopRecording}
              style={{
                border: '1px solid rgba(239,68,68,.45)',
                background: 'rgba(239,68,68,.2)',
                color: '#fecaca',
                borderRadius: 'var(--r)',
                padding: '6px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {t('media.stopRecording')}
            </button>
          </div>
        ) : nativeBlob ? (
          <>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 8 }}>{t('media.preview')}</div>
            {audioUrl && (
              <audio controls style={{ width: '100%', marginBottom: 8 }}>
                <source src={audioUrl} type={nativeMime || nativeBlob.type || 'audio/*'} />
              </audio>
            )}

            {/* Status de conversão/envio */}
            {(isConverting || ffmpegLoading) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: 'var(--txt-2)' }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--teal)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                {ffmpegLoading
                  ? 'Carregando conversor...'
                  : `Convertendo áudio${progress > 0 ? `... ${progress}%` : '...'}`}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={clear}
                disabled={busy}
                style={{
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-2)',
                  color: 'var(--txt-2)',
                  borderRadius: 'var(--r)',
                  padding: '6px 10px',
                  fontSize: 12,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.5 : 1,
                }}
              >
                {t('media.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void sendAudio()}
                disabled={busy}
                style={{
                  border: '1px solid var(--teal)',
                  background: 'var(--teal)',
                  color: '#0E1A18',
                  borderRadius: 'var(--r)',
                  padding: '6px 10px',
                  fontSize: 12,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {isConverting ? 'Convertendo...' : isSending ? 'Enviando...' : t('media.send')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  },
);

AudioRecorder.displayName = 'AudioRecorder';
