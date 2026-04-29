import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { omnichannelApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

export interface AudioRecorderHandle {
  start: () => Promise<void>;
  cancel: () => void;
}

interface AudioRecorderProps {
  conversationId: string;
  disabled?: boolean;
  onSent: () => Promise<void> | void;
  onActiveChange?: (active: boolean) => void;
}

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  const preferred = [
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/webm;codecs=opus',
    'audio/webm',
  ];

  return preferred.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
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
    const [isRecording, setIsRecording] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [recordingError, setRecordingError] = useState<string | null>(null);
    const [isSending, setIsSending] = useState(false);

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
      setAudioFile(null);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setRecordingError(null);
      onActiveChange?.(false);
    };

    useEffect(() => {
      return () => {
        clear();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const startRecording = async () => {
      if (disabled || isRecording) return;
      const mimeType = getSupportedMimeType();
      const isMetaCompatible = Boolean(mimeType) && !mimeType.includes('webm');
      if (!isMetaCompatible) {
        const message = t('media.browserNotSupported', {
          defaultValue: 'Navegador não suportado para áudio WhatsApp. Use Firefox/Safari ou envie um arquivo .mp3/.ogg/.m4a pelo anexo.',
        });
        setRecordingError(message);
        onActiveChange?.(true);
        toast.error(message);
        return;
      }

      try {
        setRecordingError(null);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );

        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => {
          try {
            const recordedMime = mimeType || recorder.mimeType || 'audio/mp4';
            const baseMime = recordedMime.split(';')[0] ?? recordedMime;
            const blob = new Blob(chunks, { type: baseMime });
            const ext =
              baseMime.includes('ogg') ? 'ogg'
              : baseMime.includes('mp4') ? 'mp4'
              : baseMime.includes('mpeg') ? 'mp3'
              : baseMime.includes('aac') ? 'aac'
              : baseMime.includes('amr') ? 'amr'
              : baseMime.includes('opus') ? 'opus'
              : 'audio';
            const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: baseMime });

            setAudioFile(file);
            const nextUrl = URL.createObjectURL(blob);
            setAudioUrl(nextUrl);
          } finally {
            stream.getTracks().forEach((track) => track.stop());
          }
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
        setSeconds(0);
        onActiveChange?.(true);
        timerRef.current = window.setInterval(() => {
          setSeconds((prev) => prev + 1);
        }, 1000);
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
      if (!audioFile || isSending) return;
      setIsSending(true);
      try {
        const upload = await omnichannelApi.uploadMedia(conversationId, audioFile);
        await omnichannelApi.sendMessage(conversationId, {
          media_id: upload.media_id,
          media_type: 'audio',
          media_filename: upload.filename,
          contentType: 'audio',
        });
        clear();
        await onSent();
      } catch {
        toast.error(t('media.uploadError'));
      } finally {
        setIsSending(false);
      }
    };

    useImperativeHandle(ref, () => ({
      start: startRecording,
      cancel: clear,
    }));

    if (!isRecording && !audioFile && !recordingError) return null;

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
        {recordingError && !isRecording && !audioFile && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--amber)' }}>{recordingError}</div>
            <button
              type="button"
              onClick={clear}
              style={{
                border: '1px solid var(--line-2)',
                background: 'var(--bg-2)',
                color: 'var(--txt-2)',
                borderRadius: 'var(--r)',
                padding: '6px 10px',
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('media.cancel')}
            </button>
          </div>
        )}

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
        ) : audioFile ? (
          <>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 8 }}>{t('media.preview')}</div>
            {audioUrl && (
              <audio controls style={{ width: '100%', marginBottom: 8 }}>
                <source src={audioUrl} type={audioFile?.type || 'audio/mp4'} />
              </audio>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={clear}
                style={{
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-2)',
                  color: 'var(--txt-2)',
                  borderRadius: 'var(--r)',
                  padding: '6px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t('media.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void sendAudio()}
                disabled={isSending}
                style={{
                  border: '1px solid var(--teal)',
                  background: 'var(--teal)',
                  color: '#0E1A18',
                  borderRadius: 'var(--r)',
                  padding: '6px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                  opacity: isSending ? 0.6 : 1,
                }}
              >
                {t('media.send')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  },
);

AudioRecorder.displayName = 'AudioRecorder';
