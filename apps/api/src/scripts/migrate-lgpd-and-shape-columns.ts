import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

type TenantTarget = {
  slug: string;
  schemaName: string;
};

type ColumnDefinition = {
  tableName: string;
  columnName: string;
  ddl: string | ((schema: string) => string);
};

const LGPD_COLUMNS: ColumnDefinition[] = [
  {
    tableName: 'users',
    columnName: 'lgpd_consent_status',
    ddl: "ADD COLUMN IF NOT EXISTS lgpd_consent_status VARCHAR(20) NOT NULL DEFAULT 'pending'",
  },
  { tableName: 'users', columnName: 'lgpd_consent_at', ddl: 'ADD COLUMN IF NOT EXISTS lgpd_consent_at TIMESTAMPTZ' },
  {
    tableName: 'users',
    columnName: 'lgpd_consent_source',
    ddl: 'ADD COLUMN IF NOT EXISTS lgpd_consent_source VARCHAR(100)',
  },
  {
    tableName: 'users',
    columnName: 'lgpd_last_export_at',
    ddl: 'ADD COLUMN IF NOT EXISTS lgpd_last_export_at TIMESTAMPTZ',
  },
  {
    tableName: 'users',
    columnName: 'lgpd_anonymized_at',
    ddl: 'ADD COLUMN IF NOT EXISTS lgpd_anonymized_at TIMESTAMPTZ',
  },
  {
    tableName: 'users',
    columnName: 'lgpd_anonymization_reason',
    ddl: 'ADD COLUMN IF NOT EXISTS lgpd_anonymization_reason TEXT',
  },
  {
    tableName: 'contacts',
    columnName: 'lgpd_consent_status',
    ddl: "ADD COLUMN IF NOT EXISTS lgpd_consent_status VARCHAR(20) NOT NULL DEFAULT 'pending'",
  },
  {
    tableName: 'contacts',
    columnName: 'lgpd_consent_at',
    ddl: 'ADD COLUMN IF NOT EXISTS lgpd_consent_at TIMESTAMPTZ',
  },
  {
    tableName: 'contacts',
    columnName: 'lgpd_consent_source',
    ddl: 'ADD COLUMN IF NOT EXISTS lgpd_consent_source VARCHAR(100)',
  },
  {
    tableName: 'contacts',
    columnName: 'lgpd_last_export_at',
    ddl: 'ADD COLUMN IF NOT EXISTS lgpd_last_export_at TIMESTAMPTZ',
  },
  {
    tableName: 'contacts',
    columnName: 'lgpd_anonymized_at',
    ddl: 'ADD COLUMN IF NOT EXISTS lgpd_anonymized_at TIMESTAMPTZ',
  },
  {
    tableName: 'contacts',
    columnName: 'lgpd_anonymization_reason',
    ddl: 'ADD COLUMN IF NOT EXISTS lgpd_anonymization_reason TEXT',
  },
];

const SHAPE_COLUMNS: ColumnDefinition[] = [
  {
    tableName: 'ticket_attachments',
    columnName: 'contact_id',
    ddl: (schema) => `ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES ${schema}.contacts(id) ON DELETE SET NULL`,
  },
];

const REQUIRED_COLUMNS = [...LGPD_COLUMNS, ...SHAPE_COLUMNS];

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function tableExists(schemaName: string, tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT to_regclass($1::text) IS NOT NULL AS exists',
    `${schemaName}.${tableName}`,
  );
  return Boolean(rows[0]?.exists);
}

async function missingColumns(schemaName: string): Promise<ColumnDefinition[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = ANY($2::text[])
        AND column_name = ANY($3::text[])
    `,
    schemaName,
    [...new Set(REQUIRED_COLUMNS.map((column) => column.tableName))],
    [...new Set(REQUIRED_COLUMNS.map((column) => column.columnName))],
  );

  const existing = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  return REQUIRED_COLUMNS.filter((column) => !existing.has(`${column.tableName}.${column.columnName}`));
}

async function migrateSchema(schemaName: string): Promise<{ addedColumns: number; skippedTables: string[] }> {
  const schema = quoteIdent(schemaName);
  const missingBefore = await missingColumns(schemaName);
  const skippedTables: string[] = [];

  for (const tableName of [...new Set(missingBefore.map((column) => column.tableName))]) {
    if (!(await tableExists(schemaName, tableName))) {
      skippedTables.push(tableName);
      continue;
    }

    if (tableName === 'ticket_attachments' && !(await tableExists(schemaName, 'contacts'))) {
      skippedTables.push('ticket_attachments (contacts ausente)');
      continue;
    }

    const tableColumns = missingBefore.filter((column) => column.tableName === tableName);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${schema}.${quoteIdent(tableName)}
      ${tableColumns.map((column) => (typeof column.ddl === 'function' ? column.ddl(schema) : column.ddl)).join(',\n      ')}
    `);
  }

  const missingAfter = await missingColumns(schemaName);
  return {
    addedColumns: missingBefore.length - missingAfter.length,
    skippedTables,
  };
}

async function resolveTargets(): Promise<TenantTarget[]> {
  const schemaArg = process.argv.find((arg) => arg.startsWith('--schema='));
  const targetSchema = schemaArg?.slice('--schema='.length);

  if (targetSchema) {
    return [{ slug: targetSchema, schemaName: targetSchema }];
  }

  return prisma.tenant.findMany({
    where: { status: { in: ['active', 'trial'] } },
    select: { slug: true, schemaName: true },
    orderBy: { createdAt: 'asc' },
  });
}

async function run(): Promise<void> {
  const tenants = await resolveTargets();

  logger.info(`Aplicando migration LGPD/shape em ${tenants.length} tenants...`);

  let totalAddedColumns = 0;
  let failures = 0;

  for (const tenant of tenants) {
    try {
      const result = await migrateSchema(tenant.schemaName);
      totalAddedColumns += result.addedColumns;
      const skipped = result.skippedTables.length > 0 ? ` ignoradas=${result.skippedTables.join(',')}` : '';
      logger.info(`OK ${tenant.slug}: colunas=+${result.addedColumns}${skipped}`);
    } catch (err) {
      failures += 1;
      logger.error({ err }, `ERRO ${tenant.slug}`);
    }
  }

  logger.info(`Concluido. Tenants=${tenants.length} Colunas=+${totalAddedColumns} Erros=${failures}.`);
}

run()
  .catch((err) => {
    logger.error({ err }, 'Falha ao aplicar migration LGPD/shape');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
