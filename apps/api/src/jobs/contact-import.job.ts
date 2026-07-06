import { Worker } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { bullmqConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { getSocketServer } from '../socket/index.js';
import { normalizePhoneForStorage } from '../utils/phone.js';
import { ensureCrmInfrastructure } from '../modules/crm/crm.infrastructure.js';
import {
  getStoredContactImport,
  readContactImportRows,
  removeStoredContactImport,
  type ContactImportRow,
} from '../modules/crm/contacts/contacts-import.service.js';
import type { ContactImportJobData } from './queue.js';

interface ContactImportResult {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface DuplicateContactRow {
  id: string;
}

interface OrganizationRow {
  id: string;
}

interface MappedContactRow {
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  organizationName: string | null;
  role: string | null;
  department: string | null;
  tags: string[];
  customFields: Record<string, unknown>;
}

const CONTACT_NAME_MAX_LENGTH = 150;
const ORGANIZATION_NAME_MAX_LENGTH = 150;

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cell(row: ContactImportRow, column: string | undefined): string | undefined {
  if (!column) return undefined;
  return row[column];
}

function toPgArray(arr: string[]): string {
  if (!arr.length) return '{}';
  return `{${arr.map((item) => `"${item.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

function parseTags(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseCustomFields(value: string | null): Record<string, unknown> {
  if (!value) return {};
  const trimmed = value.trim();
  if (!trimmed) return {};

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  const fields: Record<string, string> = {};
  for (const pair of trimmed.split(',')) {
    const separatorIndex = pair.indexOf(':');
    if (separatorIndex <= 0) continue;
    const key = pair.slice(0, separatorIndex).trim();
    const fieldValue = pair.slice(separatorIndex + 1).trim();
    if (key) fields[key] = fieldValue;
  }
  return fields;
}

function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  try {
    return normalizePhoneForStorage(value);
  } catch {
    return value.trim();
  }
}

function mapRow(row: ContactImportRow, mapping: ContactImportJobData['mapping']): MappedContactRow {
  const name = clean(cell(row, mapping.name));
  if (!name) {
    throw new Error('Nome obrigatório');
  }
  if (name.length > CONTACT_NAME_MAX_LENGTH) {
    throw new Error(`Nome deve ter no máximo ${CONTACT_NAME_MAX_LENGTH} caracteres`);
  }

  const phone = normalizePhone(clean(cell(row, mapping.phone)));
  const whatsapp = normalizePhone(clean(cell(row, mapping.whatsapp)) ?? phone);
  const organizationName = clean(cell(row, mapping.organization_name));
  if (organizationName && organizationName.length > ORGANIZATION_NAME_MAX_LENGTH) {
    throw new Error(`Organização deve ter no máximo ${ORGANIZATION_NAME_MAX_LENGTH} caracteres`);
  }

  return {
    name,
    email: clean(cell(row, mapping.email))?.toLowerCase() ?? null,
    phone,
    whatsapp,
    organizationName,
    role: clean(cell(row, mapping.role)),
    department: clean(cell(row, mapping.department)),
    tags: parseTags(clean(cell(row, mapping.tags))),
    customFields: parseCustomFields(clean(cell(row, mapping.custom_fields))),
  };
}

async function findOrCreateOrganization(
  tx: Prisma.TransactionClient,
  schema: string,
  name: string | null,
): Promise<string | null> {
  if (!name) return null;

  const existing = await tx.$queryRawUnsafe<OrganizationRow[]>(
    `SELECT id::text AS id
     FROM ${schema}.organizations
     WHERE lower(trim(name)) = lower(trim($1))
     LIMIT 1`,
    name,
  );
  if (existing[0]) return existing[0].id;

  const inserted = await tx.$queryRawUnsafe<OrganizationRow[]>(
    `INSERT INTO ${schema}.organizations (name, status)
     VALUES ($1, 'lead')
     RETURNING id::text AS id`,
    name,
  );
  return inserted[0]?.id ?? null;
}

async function findDuplicateContact(
  tx: Prisma.TransactionClient,
  schema: string,
  row: MappedContactRow,
): Promise<string | null> {
  const email = row.email?.trim().toLowerCase() || null;
  const phoneDigits = row.phone?.replace(/\D/g, '') || null;
  const whatsappDigits = row.whatsapp?.replace(/\D/g, '') || null;

  if (!email && !phoneDigits && !whatsappDigits) return null;

  const duplicates = await tx.$queryRawUnsafe<DuplicateContactRow[]>(
    `SELECT id::text AS id
     FROM ${schema}.contacts
     WHERE ($1::text IS NOT NULL AND lower(trim(COALESCE(email, ''))) = $1)
        OR ($2::text IS NOT NULL AND (
          regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $2
          OR regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $2
        ))
        OR ($3::text IS NOT NULL AND (
          regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $3
          OR regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $3
        ))
     ORDER BY created_at ASC
     LIMIT 1`,
    email,
    phoneDigits,
    whatsappDigits,
  );

  return duplicates[0]?.id ?? null;
}

async function insertContact(
  tx: Prisma.TransactionClient,
  schema: string,
  row: MappedContactRow,
  organizationId: string | null,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO ${schema}.contacts (
       organization_id, name, email, phone, whatsapp, role, department, tags, custom_fields
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::text[], $9::jsonb)`,
    organizationId,
    row.name,
    row.email,
    row.phone,
    row.whatsapp,
    row.role,
    row.department,
    toPgArray(row.tags),
    JSON.stringify(row.customFields),
  );
}

async function updateContact(
  tx: Prisma.TransactionClient,
  schema: string,
  contactId: string,
  row: MappedContactRow,
  organizationId: string | null,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `UPDATE ${schema}.contacts
     SET organization_id = COALESCE($1::uuid, organization_id),
         name = $2,
         email = $3,
         phone = $4,
         whatsapp = $5,
         role = $6,
         department = $7,
         tags = $8::text[],
         custom_fields = $9::jsonb,
         updated_at = NOW()
     WHERE id = $10::uuid`,
    organizationId,
    row.name,
    row.email,
    row.phone,
    row.whatsapp,
    row.role,
    row.department,
    toPgArray(row.tags),
    JSON.stringify(row.customFields),
    contactId,
  );
}

function emitImportDone(userId: string, jobId: string, result: ContactImportResult): void {
  try {
    getSocketServer().to(`agent:${userId}`).emit('contacts:import:done', {
      jobId,
      ...result,
    });
  } catch (err) {
    logger.warn({ userId, err }, '[ContactImport] Failed to emit completion event');
  }
}

export const contactImportWorker = new Worker<ContactImportJobData>(
  'ziradesk-contact-import',
  async (job) => {
    const storedImport = await getStoredContactImport(job.data.importId);
    if (!storedImport) {
      throw new Error('Importação expirada ou não encontrada');
    }

    const result: ContactImportResult = {
      total: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };

    try {
      await ensureCrmInfrastructure(job.data.schemaName);
      const rows = await readContactImportRows(storedImport);
      result.total = rows.length;
      const schema = quoteIdent(job.data.schemaName);

      for (const rawRow of rows) {
        try {
          const mapped = mapRow(rawRow, job.data.mapping);
          const outcome = await prisma.$transaction(async (tx) => {
            const duplicateContactId = await findDuplicateContact(tx, schema, mapped);
            if (duplicateContactId && job.data.duplicateAction === 'skip') {
              return 'skipped' as const;
            }

            const organizationId = await findOrCreateOrganization(tx, schema, mapped.organizationName);
            if (duplicateContactId) {
              await updateContact(tx, schema, duplicateContactId, mapped, organizationId);
              return 'updated' as const;
            }

            await insertContact(tx, schema, mapped, organizationId);
            return 'inserted' as const;
          });
          result[outcome] += 1;
        } catch (err) {
          result.errors += 1;
          logger.warn({ err, importId: job.data.importId }, '[ContactImport] Failed to process row');
        }
      }

      emitImportDone(job.data.userId, String(job.id), result);
      return result;
    } finally {
      await removeStoredContactImport(storedImport);
    }
  },
  {
    connection: bullmqConnection,
    concurrency: 2,
  },
);

contactImportWorker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, '[ContactImport] Job completed');
});

contactImportWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, '[ContactImport] Job failed');
});
