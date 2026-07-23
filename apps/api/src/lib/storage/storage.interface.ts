export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Objeto não encontrado no storage: ${key}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

export interface StorageProvider {
  /** Persiste o buffer no storage e retorna a URL pública de acesso. */
  upload(key: string, buffer: Buffer, mimetype: string): Promise<string>;
  /** Remove o objeto pelo key. Não lança erro se não existir. */
  delete(key: string): Promise<void>;
  /** Verifica se o objeto existe sem baixar seu conteúdo. */
  exists(key: string): Promise<boolean>;
  /** Retorna a URL pública para um key conhecido sem fazer I/O. */
  getUrl(key: string): string;
  /** Baixa o conteúdo do objeto (usado para proxy de downloads autenticados). */
  download(key: string): Promise<Buffer>;
}
