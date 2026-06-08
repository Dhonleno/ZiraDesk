import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadHeaderHandle, validateTemplateMedia } from './templates.media.service.js';

describe('templates media service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('executa as duas etapas do upload resumable e retorna o header handle', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: 'upload:session-001' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ h: 'header-handle-001' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const file = Buffer.from('image-content');
    const result = await uploadHeaderHandle(
      file,
      'image/jpeg',
      'header.jpg',
      'waba-001',
      'access-token-001',
    );

    expect(result).toBe('header-handle-001');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [sessionUrl, sessionOptions] = fetchMock.mock.calls[0]!;
    expect(String(sessionUrl)).toContain('/waba-001/uploads?');
    expect(String(sessionUrl)).toContain(`file_length=${file.byteLength}`);
    expect(String(sessionUrl)).toContain('file_type=image%2Fjpeg');
    expect(String(sessionUrl)).toContain('access_token=access-token-001');
    expect(sessionOptions).toMatchObject({ method: 'POST' });

    const [uploadUrl, uploadOptions] = fetchMock.mock.calls[1]!;
    expect(String(uploadUrl)).toContain('/upload%3Asession-001');
    expect(uploadOptions).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'OAuth access-token-001',
        file_offset: '0',
        'Content-Type': 'application/octet-stream',
      },
      body: file,
    });
  });

  it('rejeita formato não permitido antes de chamar a Meta', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadHeaderHandle(
      Buffer.from('content'),
      'image/gif',
      'header.gif',
      'waba-001',
      'access-token-001',
    )).rejects.toThrow('Formato inválido');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aplica os limites de tamanho por tipo de mídia', () => {
    expect(() => validateTemplateMedia('image/png', 5 * 1024 * 1024)).not.toThrow();
    expect(() => validateTemplateMedia('video/mp4', 16 * 1024 * 1024)).not.toThrow();
    expect(() => validateTemplateMedia('application/pdf', 100 * 1024 * 1024)).not.toThrow();

    expect(() => validateTemplateMedia('image/png', 5 * 1024 * 1024 + 1)).toThrow('5MB');
    expect(() => validateTemplateMedia('video/mp4', 16 * 1024 * 1024 + 1)).toThrow('16MB');
    expect(() => validateTemplateMedia('application/pdf', 100 * 1024 * 1024 + 1)).toThrow('100MB');
  });
});
