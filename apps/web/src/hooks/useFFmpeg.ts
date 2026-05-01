import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { useRef, useState, useCallback } from 'react';
import localCoreURL from '@ffmpeg/core?url';
import localWasmURL from '@ffmpeg/core/wasm?url';

// Singleton — carregado uma vez por sessão, compartilhado entre instâncias
const ffmpeg = new FFmpeg();
let loadPromise: Promise<void> | null = null;
const CORE_VERSION = '0.12.6';
const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

async function loadFromLocal(): Promise<void> {
  await ffmpeg.load({ coreURL: localCoreURL, wasmURL: localWasmURL });
}

async function loadFromCdn(): Promise<void> {
  const [coreURL, wasmURL] = await Promise.all([
    toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
    toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
  ]);

  await ffmpeg.load({ coreURL, wasmURL });
}

async function ensureLoaded(): Promise<void> {
  if (ffmpeg.loaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      await loadFromLocal();
      return;
    } catch {
      // fallback silencioso para CDN quando o bundle local não estiver disponível
    }

    await loadFromCdn();
  })().catch((err) => {
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

export function useFFmpeg() {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressHandlerRef = useRef<((e: { progress: number }) => void) | null>(null);

  const load = useCallback(async () => {
    if (ffmpeg.loaded) return;
    setIsLoading(true);
    try {
      await ensureLoaded();
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Converte qualquer blob de áudio gravado pelo navegador para MP3.
   * O WhatsApp/Meta aceitou audio/mpeg no fluxo real; isso evita MP4 com Opus,
   * que a Meta aceita no upload mas rejeita depois no processamento.
   */
  const convertToMp3 = useCallback(async (
    inputBlob: Blob,
    inputExt: string = 'webm',
  ): Promise<File> => {
    await ensureLoaded();

    const onProgress = (e: { progress: number }) => {
      setProgress(Math.round(Math.min(e.progress, 1) * 100));
    };
    if (progressHandlerRef.current) {
      ffmpeg.off('progress', progressHandlerRef.current);
    }
    progressHandlerRef.current = onProgress;
    ffmpeg.on('progress', onProgress);
    setProgress(0);
    const conversionLogs: string[] = [];
    const onLog = ({ type, message }: { type: string; message: string }) => {
      const line = `[${type}] ${message}`;
      conversionLogs.push(line);
      if (conversionLogs.length > 20) conversionLogs.shift();
    };
    ffmpeg.on('log', onLog);

    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const safeInputExt = inputExt.replace(/[^a-z0-9]/gi, '') || 'audio';
    const inputName = `input-${fileId}.${safeInputExt}`;
    const outputName = `output-${fileId}.mp3`;

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(inputBlob));

      const exitCode = await ffmpeg.exec([
        '-i', inputName,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-b:a', '64k',
        outputName,
      ]);

      if (exitCode !== 0) {
        throw new Error(
          `FFmpeg audio conversion failed with exit code ${exitCode}: ${conversionLogs.slice(-5).join(' | ')}`,
        );
      }

      const raw = await ffmpeg.readFile(outputName);
      // slice() copia para ArrayBuffer regular (evita SharedArrayBuffer no Blob)
      const bytes = raw instanceof Uint8Array ? raw.slice() : new TextEncoder().encode(String(raw));
      if (bytes.length === 0) {
        throw new Error('FFmpeg generated an empty audio file');
      }

      return new File([bytes], `audio-${Date.now()}.mp3`, { type: 'audio/mpeg' });
    } finally {
      await Promise.all([
        ffmpeg.deleteFile(inputName).catch(() => {}),
        ffmpeg.deleteFile(outputName).catch(() => {}),
      ]);
      ffmpeg.off('log', onLog);
      ffmpeg.off('progress', onProgress);
      progressHandlerRef.current = null;
      setProgress(0);
    }
  }, []);

  return { load, convertToMp3, isLoading, progress };
}
