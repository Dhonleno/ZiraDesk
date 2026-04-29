import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { omnichannelApi } from '../../services/api';
import { useToast } from '../../stores/toast.store';

export interface MediaUploadHandle {
  openPicker: (accept?: string) => void;
  clear: () => void;
}

interface MediaUploadProps {
  conversationId: string;
  disabled?: boolean;
  onSent: () => Promise<void> | void;
  onActiveChange?: (active: boolean) => void;
}

function detectMediaType(mime: string): 'image' | 'audio' | 'video' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MediaUpload = forwardRef<MediaUploadHandle, MediaUploadProps>(
  ({ conversationId, disabled, onSent, onActiveChange }, ref) => {
    const { t } = useTranslation('omnichannel');
    const toast = useToast();
    const inputRef = useRef<HTMLInputElement>(null);
    const [accept, setAccept] = useState<string | undefined>(undefined);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [caption, setCaption] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    useEffect(() => {
      if (!selectedFile) {
        setPreviewUrl(null);
        return;
      }
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }, [selectedFile]);

    const clear = () => {
      setSelectedFile(null);
      setCaption('');
      if (inputRef.current) inputRef.current.value = '';
      onActiveChange?.(false);
    };

    useImperativeHandle(ref, () => ({
      openPicker: (acceptParam?: string) => {
        if (disabled) return;
        setAccept(acceptParam);
        inputRef.current?.click();
      },
      clear,
    }));

    const onFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setSelectedFile(file);
      onActiveChange?.(true);
    };

    const onUpload = async () => {
      if (!selectedFile || isUploading) return;
      setIsUploading(true);
      try {
        const upload = await omnichannelApi.uploadMedia(conversationId, selectedFile);
        await omnichannelApi.sendMessage(conversationId, {
          content: caption.trim(),
          media_id: upload.media_id,
          media_type: upload.media_type,
          media_filename: upload.filename,
          contentType: upload.media_type,
        });
        clear();
        await onSent();
      } catch {
        toast.error(t('media.uploadError'));
      } finally {
        setIsUploading(false);
      }
    };

    const mediaType = selectedFile ? detectMediaType(selectedFile.type) : null;

    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onFileSelected}
          style={{ display: 'none' }}
        />

        {selectedFile && (
          <div
            style={{
              marginBottom: 10,
              border: '1px solid var(--line-2)',
              background: 'var(--bg-3)',
              borderRadius: 'var(--r)',
              padding: 10,
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 8 }}>
              {t('media.preview')}
            </div>

            {mediaType === 'image' && (
              <img
                src={previewUrl ?? ''}
                alt="preview"
                style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }}
              />
            )}

            {mediaType === 'audio' && (
              <audio controls style={{ width: '100%', marginBottom: 8 }}>
                <source src={previewUrl ?? ''} type={selectedFile.type} />
              </audio>
            )}

            {mediaType === 'video' && (
              <video controls style={{ maxWidth: 240, borderRadius: 8, marginBottom: 8 }}>
                <source src={previewUrl ?? ''} type={selectedFile.type} />
              </video>
            )}

            {mediaType === 'document' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 18 }}>📄</span>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{selectedFile.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{formatFileSize(selectedFile.size)}</div>
                </div>
              </div>
            )}

            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder={t('media.caption')}
              style={{
                width: '100%',
                marginBottom: 8,
                background: 'var(--bg-2)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r)',
                padding: '7px 9px',
                color: 'var(--txt)',
                fontSize: 12,
              }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={clear}
                style={{
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-2)',
                  borderRadius: 'var(--r)',
                  padding: '6px 10px',
                  fontSize: 12,
                  color: 'var(--txt-2)',
                  cursor: 'pointer',
                }}
              >
                {t('media.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void onUpload()}
                disabled={isUploading}
                style={{
                  border: '1px solid var(--teal)',
                  background: 'var(--teal)',
                  borderRadius: 'var(--r)',
                  padding: '6px 10px',
                  fontSize: 12,
                  color: '#0E1A18',
                  cursor: 'pointer',
                  opacity: isUploading ? 0.6 : 1,
                }}
              >
                {t('media.send')}
              </button>
            </div>
          </div>
        )}
      </>
    );
  },
);

MediaUpload.displayName = 'MediaUpload';
