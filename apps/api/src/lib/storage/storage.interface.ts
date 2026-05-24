export interface StorageProvider {
  /** Persiste o buffer no storage e retorna a URL pública de acesso. */
  upload(key: string, buffer: Buffer, mimetype: string): Promise<string>;
  /** Remove o objeto pelo key. Não lança erro se não existir. */
  delete(key: string): Promise<void>;
  /** Retorna a URL pública para um key conhecido sem fazer I/O. */
  getUrl(key: string): string;
  /** Baixa o conteúdo do objeto (usado para proxy de downloads autenticados). */
  download(key: string): Promise<Buffer>;
}
