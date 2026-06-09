import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { redis } from '../../../config/redis.js';

const MAX_IMPORT_SIZE_BYTES = 10 * 1024 * 1024;
const IMPORT_TTL_SECONDS = 30 * 60;
const IMPORT_TMP_DIR = process.env['ZIRADESK_IMPORT_TMP_DIR'] ?? '/tmp/ziradesk-imports';

export type ContactImportFormat = 'csv' | 'xlsx' | 'vcf';

export interface ContactImportPreviewResult {
  importId: string;
  format: ContactImportFormat;
  totalRows: number;
  columns: string[];
  preview: Array<Record<string, string>>;
}

export type ContactImportRow = Record<string, string>;

export interface StoredImportMetadata {
  importId: string;
  format: ContactImportFormat;
  filePath: string;
  originalFileName: string;
  createdBy: string;
  tenantId: string;
  schemaName: string;
  createdAt: string;
}

export class ContactImportError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ContactImportError';
    this.statusCode = statusCode;
  }
}

export function contactImportRedisKey(importId: string): string {
  return `crm:contacts:import:${importId}`;
}

export function getContactImportTmpPath(importId: string, format: ContactImportFormat): string {
  return path.join(IMPORT_TMP_DIR, `${importId}.${format}`);
}

export async function getStoredContactImport(importId: string): Promise<StoredImportMetadata | null> {
  const raw = await redis.get(contactImportRedisKey(importId));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredImportMetadata;
  } catch {
    await redis.del(contactImportRedisKey(importId));
    return null;
  }
}

function detectFormat(fileName: string): ContactImportFormat | null {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.csv') return 'csv';
  if (ext === '.xlsx') return 'xlsx';
  if (ext === '.vcf') return 'vcf';
  return null;
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function parseTabularRows(buffer: Buffer): { columns: string[]; rows: ContactImportRow[] } {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    raw: false,
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { columns: [], rows: [] };
  }

  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) {
    return { columns: [], rows: [] };
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: false,
  });
  const columns = rows.reduce<string[]>((acc, row) => {
    for (const key of Object.keys(row)) {
      const trimmed = key.trim();
      if (trimmed && !acc.includes(trimmed)) acc.push(trimmed);
    }
    return acc;
  }, []);

  return {
    columns,
    rows: rows.map((row) =>
      Object.fromEntries(columns.map((column) => [column, normalizeCell(row[column])])),
    ),
  };
}

function unfoldVcardLines(input: string): string[] {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines: string[] = [];

  for (const line of normalized.split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
      continue;
    }
    lines.push(line);
  }

  return lines;
}

function decodeVcardValue(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseVcardRows(buffer: Buffer): { columns: string[]; rows: ContactImportRow[] } {
  const lines = unfoldVcardLines(buffer.toString('utf8'));
  const cards: ContactImportRow[] = [];
  let current: Record<string, string> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.toUpperCase() === 'BEGIN:VCARD') {
      current = {};
      continue;
    }

    if (line.toUpperCase() === 'END:VCARD') {
      if (current) cards.push(current);
      current = null;
      continue;
    }

    if (!current) continue;

    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) continue;

    const keyPart = line.slice(0, separatorIndex);
    const value = decodeVcardValue(line.slice(separatorIndex + 1));
    const key = keyPart.split(';')[0]?.toUpperCase();

    if (key === 'FN') current['Nome'] = value;
    if (key === 'EMAIL' && !current['Email']) current['Email'] = value;
    if (key === 'TEL' && !current['Telefone']) current['Telefone'] = value;
    if (key === 'ORG' && !current['Empresa']) current['Empresa'] = value.split(';').filter(Boolean).join(' - ');
    if (key === 'TITLE' && !current['Cargo']) current['Cargo'] = value;
  }

  const columns = ['Nome', 'Email', 'Telefone', 'Empresa', 'Cargo'].filter((column) =>
    cards.some((card) => card[column]),
  );

  return {
    columns,
    rows: cards.map((card) => Object.fromEntries(columns.map((column) => [column, card[column] ?? '']))),
  };
}

function parsePreview(buffer: Buffer, format: ContactImportFormat): Pick<ContactImportPreviewResult, 'columns' | 'preview' | 'totalRows'> {
  const parsed = format === 'vcf' ? parseVcardRows(buffer) : parseTabularRows(buffer);
  return {
    columns: parsed.columns,
    totalRows: parsed.rows.length,
    preview: parsed.rows.slice(0, 5),
  };
}

export function parseContactImportBuffer(buffer: Buffer, format: ContactImportFormat): ContactImportRow[] {
  return format === 'vcf' ? parseVcardRows(buffer).rows : parseTabularRows(buffer).rows;
}

export async function readContactImportRows(storedImport: StoredImportMetadata): Promise<ContactImportRow[]> {
  const buffer = await readFile(storedImport.filePath);
  return parseContactImportBuffer(buffer, storedImport.format);
}

export async function removeStoredContactImport(storedImport: StoredImportMetadata): Promise<void> {
  await Promise.all([
    unlink(storedImport.filePath).catch(() => undefined),
    redis.del(contactImportRedisKey(storedImport.importId)),
  ]);
}

export async function createContactImportPreview(input: {
  buffer: Buffer;
  fileName: string;
  userId: string;
  tenantId: string;
  schemaName: string;
}): Promise<ContactImportPreviewResult> {
  if (input.buffer.length > MAX_IMPORT_SIZE_BYTES) {
    throw new ContactImportError('Arquivo muito grande. Máximo 10MB', 413);
  }

  const format = detectFormat(input.fileName);
  if (!format) {
    throw new ContactImportError('Formato não suportado. Use CSV, Excel ou vCard');
  }

  const parsed = parsePreview(input.buffer, format);
  const importId = randomUUID();
  const filePath = getContactImportTmpPath(importId, format);

  await mkdir(IMPORT_TMP_DIR, { recursive: true });
  await writeFile(filePath, input.buffer, { flag: 'wx' });

  const metadata: StoredImportMetadata = {
    importId,
    format,
    filePath,
    originalFileName: input.fileName,
    createdBy: input.userId,
    tenantId: input.tenantId,
    schemaName: input.schemaName,
    createdAt: new Date().toISOString(),
  };

  await redis.setex(contactImportRedisKey(importId), IMPORT_TTL_SECONDS, JSON.stringify(metadata));

  return {
    importId,
    format,
    totalRows: parsed.totalRows,
    columns: parsed.columns,
    preview: parsed.preview,
  };
}
