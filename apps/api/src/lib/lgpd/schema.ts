import type { RawExecutor } from '../../modules/crm/crm.db.js';

/**
 * Fonte canônica do shape de `lgpd_requests`.
 *
 * A tabela não existe em `createTenantTables`: nasce lazily. Antes desta
 * unificação havia DUAS definições independentes — `crm.infrastructure.ts`
 * (`request_type VARCHAR(40)`, `status VARCHAR(20) DEFAULT 'processed'`,
 * FKs `ON DELETE SET NULL`) e `portal.service.ts` (`VARCHAR(30)`,
 * `VARCHAR(30) DEFAULT 'pending'`, FKs sem `ON DELETE`) —, ambas com
 * `CREATE TABLE IF NOT EXISTS`: quem chegasse primeiro no schema definia o
 * shape. Mesmos nomes e mesma ordem, `atttypmod` diferente. Como
 * `equalTupleDescs` (plancache.c) compara `atttypmod`, dois tenants
 * provisionados por caminhos distintos produziam descritores de resultado
 * diferentes para o mesmo statement e disparavam
 * `0A000 cached plan must not change result type`.
 *
 * Larguras canônicas escolhidas pelos valores realmente usados:
 *   request_type — maior valor `'external_anonymization'` (22 chars) → VARCHAR(30)
 *   status       — maior valor `'processed'` (9 chars) → VARCHAR(20)
 * `DEFAULT 'pending'` vence porque a máquina de estados nasce em `pending`
 * (`pending → processed | rejected`); os fluxos internos que gravam trilha já
 * terminada passam `status` explícito, então nenhum INSERT depende do default.
 */

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function tableRef(schemaName: string, table: string): string {
  return `${quoteIdent(schemaName)}.${table}`;
}

/** Referência qualificada da tabela. Use sempre — nunca `lgpd_requests` cru. */
export function lgpdRequestsRef(schemaName: string): string {
  return tableRef(schemaName, 'lgpd_requests');
}

/**
 * Colunas na ordem física canônica.
 *
 * Existe para o `RETURNING` explícito de `requests.ts`: listar colunas evita
 * que uma coluna adicionada por retrofit lazy mude a contagem/ordem do
 * descritor de resultado entre schemas.
 */
export const LGPD_REQUEST_COLUMNS = [
  'id',
  'contact_id',
  'user_id',
  'subject_type',
  'request_type',
  'status',
  'requested_by',
  'processed_by',
  'payload',
  'result',
  'requested_at',
  'processed_at',
  'sla_deadline',
  'notified_at',
  'reminder_sent_at',
] as const;

/**
 * Cria/retrofita `lgpd_requests` no schema informado.
 *
 * Idempotente e sem cache próprio: o cache por schema (`Set<string>`) continua
 * sendo responsabilidade de quem chama (`ensureCrmInfrastructure`,
 * `ensurePortalInfrastructure`), que também roda o resto do seu fluxo.
 *
 * NÃO reconcilia `atttypmod` de schemas já provisionados pelo caminho
 * divergente — `ALTER COLUMN ... TYPE` é migração de higiene registrada como
 * dívida residual em §16, a rodar em janela controlada.
 */
export async function ensureLgpdRequestsTable(
  db: RawExecutor,
  schemaName: string,
): Promise<void> {
  const schema = quoteIdent(schemaName);
  const requests = lgpdRequestsRef(schemaName);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${requests} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID REFERENCES ${schema}.contacts(id) ON DELETE SET NULL,
      user_id UUID REFERENCES ${schema}.users(id) ON DELETE SET NULL,
      subject_type VARCHAR(20) NOT NULL DEFAULT 'contact',
      request_type VARCHAR(30) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      requested_by UUID REFERENCES ${schema}.users(id) ON DELETE SET NULL,
      processed_by UUID REFERENCES ${schema}.users(id) ON DELETE SET NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      sla_deadline TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 days'),
      notified_at TIMESTAMPTZ,
      reminder_sent_at TIMESTAMPTZ
    )
  `);

  // Retrofit para schemas criados antes de cada coluna existir.
  await db.$executeRawUnsafe(`
    ALTER TABLE ${requests}
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES ${schema}.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS subject_type VARCHAR(20) NOT NULL DEFAULT 'contact',
    ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ
  `);

  await db.$executeRawUnsafe(`
    ALTER TABLE ${requests}
    ALTER COLUMN sla_deadline SET DEFAULT (NOW() + INTERVAL '15 days')
  `);

  await db.$executeRawUnsafe(`
    UPDATE ${requests}
    SET sla_deadline = requested_at + INTERVAL '15 days'
    WHERE status = 'pending'
      AND sla_deadline IS NULL
  `);

  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_lgpd_requests_contact ON ${requests}(contact_id)`,
  );

  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_lgpd_requests_user ON ${requests}(user_id)`,
  );

  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_lgpd_requests_subject_type ON ${requests}(subject_type)`,
  );

  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_lgpd_requests_sla ON ${requests}(sla_deadline) WHERE status = 'pending'`,
  );
}
