/**
 * SONDA 0A000 — conversations / conversation_status por schema.
 *
 * NÃO é teste de regressão comum: prova o defeito antes da correção dos call
 * sites e prova o gate esperado. Mantida sob `__probes__` e atrás de flag
 * porque `vitest.config.ts` coleta `src/**\/*.test.ts`; em runs normais o
 * `describe.skipIf` pula tudo e nenhuma conexão/DDL é executada.
 *
 * Como rodar:
 *   PowerShell:
 *     $env:ZIRADESK_PROBE_0A000=1
 *     pnpm --filter @ziradesk/api test -- src/lib/conversations/__probes__/0A000-conversations.probe.test.ts
 *
 * O vetor aqui é diferente de `lgpd_requests`: não é `atttypmod`. Cada tenant
 * cria seu próprio `conversation_status` (`CREATE TYPE "<schema>".conversation_status`),
 * então duas colunas `status` visualmente idênticas têm `atttypid` diferente.
 * `equalTupleDescs` compara esse OID no descritor de retorno; se o mesmo texto
 * de statement for reanalisado após troca de `search_path`, a primeira
 * reexecução já pode falhar com `0A000 cached plan must not change result type`.
 *
 * A tabela mínima evita FKs e colunas irrelevantes. Inclui:
 *   - `id`: chave primária inserida pela sonda para permitir várias execuções;
 *   - `channel_type`: coluna obrigatória real de conversations;
 *   - `external_id`: valor variável sem restrição, só para diferenciar linhas;
 *   - `status`: o vetor da sonda, tipado com o enum per-schema;
 *   - `created_at`: default real e estável em `RETURNING *`.
 *
 * Enum real copiado de `tenants.service.ts`: `open`, `waiting`, `closed`.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conversationsRef as productionConversationsRef } from '../schema.js';

const PROBE_ENABLED = process.env.ZIRADESK_PROBE_0A000 === '1';
const STAMP = Date.now();
const SCHEMA_A = `probe_conv_a_${STAMP}`;
const SCHEMA_B = `probe_conv_b_${STAMP}`;
const PROBE_SCHEMAS = [SCHEMA_A, SCHEMA_B] as const;
const CONVERSATION_STATUS_VALUES = ['open', 'waiting', 'closed'] as const;

const INSERT_COLUMNS = 'id, channel_type, external_id, status';
const INSERT_VALUES = "$1::uuid, 'whatsapp', $2, 'open'";

const STMT_UNQUALIFIED_STAR = `INSERT INTO conversations (${INSERT_COLUMNS})
VALUES (${INSERT_VALUES})
RETURNING *`;

const STMT_UNQUALIFIED_EXPLICIT_WITH_STATUS = `INSERT INTO conversations (${INSERT_COLUMNS})
VALUES (${INSERT_VALUES})
RETURNING id, channel_type, external_id, status`;

function quoteIdent(identifier: string): string {
  if (!/^[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`Identificador inseguro para a sonda: ${identifier}`);
  }
  return `"${identifier}"`;
}

function hardcodedConversationsRef(schemaName: string): string {
  return `${quoteIdent(schemaName)}.conversations`;
}

function qualifiedStarStatement(schemaName: string): string {
  return `INSERT INTO ${hardcodedConversationsRef(schemaName)} (${INSERT_COLUMNS})
VALUES (${INSERT_VALUES})
RETURNING *`;
}

function insertIntoStatement(tableRef: string): string {
  return `INSERT INTO ${tableRef} (${INSERT_COLUMNS})
VALUES (${INSERT_VALUES})
RETURNING *`;
}

function probeDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      'DATABASE_URL ausente. Rode via `pnpm --filter @ziradesk/api test` (o script carrega .env.test).',
    );
  }

  // O cache de prepared statements vive na conexão física do Postgres.
  // Com connection_limit=1, o par A→B cai no mesmo backend.
  const url = new URL(raw);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('pool_timeout', '10');
  return url.toString();
}

interface PgTypeOidRow {
  schema_name: string;
  oid: string;
}

interface ConversationStatusOid {
  schema: string;
  oid: string;
}

type CollisionResult = { phase: 'switch'; error: unknown } | { phase: 'none' };

async function createConversationProbeSchema(
  client: PrismaClient,
  schemaName: string,
): Promise<void> {
  const schema = quoteIdent(schemaName);
  await client.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
  await client.$executeRawUnsafe(
    `CREATE TYPE ${schema}.conversation_status AS ENUM (${CONVERSATION_STATUS_VALUES
      .map((value) => `'${value}'`)
      .join(', ')})`,
  );
  await client.$executeRawUnsafe(`
    CREATE TABLE ${schema}.conversations (
      id UUID PRIMARY KEY,
      channel_type VARCHAR(30) NOT NULL,
      external_id VARCHAR(255),
      status ${schema}.conversation_status NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readConversationStatusOids(
  client: PrismaClient,
): Promise<ConversationStatusOid[]> {
  const rows = await client.$queryRawUnsafe<PgTypeOidRow[]>(
    `SELECT n.nspname AS schema_name, t.oid::text AS oid
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname = 'conversation_status'
        AND n.nspname IN ($1, $2)
      ORDER BY n.nspname`,
    SCHEMA_A,
    SCHEMA_B,
  );

  return rows.map((row) => ({ schema: row.schema_name, oid: row.oid }));
}

function insertParams(): [string, string] {
  const id = randomUUID();
  return [id, `probe-${id}`];
}

function extractPgError(error: unknown): { code?: string | undefined; message: string } {
  if (!error || typeof error !== 'object') return { message: String(error) };

  const err = error as { code?: string; message?: string; meta?: Record<string, unknown> };
  const metaCode = typeof err.meta?.code === 'string' ? err.meta.code : undefined;
  const metaMessage = typeof err.meta?.message === 'string' ? err.meta.message : undefined;

  return {
    code: metaCode ?? err.code,
    message: metaMessage ?? err.message ?? String(error),
  };
}

describe.skipIf(!PROBE_ENABLED)('SONDA 0A000 — conversations / enum OID', () => {
  let client: PrismaClient;

  async function runCollisionPair(
    statementFor: (schemaName: string) => string,
  ): Promise<CollisionResult> {
    // Reconecta antes de cada caso: cache de prepared statement é por conexão.
    await client.$disconnect();
    await client.$connect();

    await client.$executeRawUnsafe(`SET search_path TO ${quoteIdent(SCHEMA_A)}, public`);
    await client.$queryRawUnsafe(statementFor(SCHEMA_A), ...insertParams());

    await client.$executeRawUnsafe(`SET search_path TO ${quoteIdent(SCHEMA_B)}, public`);
    try {
      await client.$queryRawUnsafe(statementFor(SCHEMA_B), ...insertParams());
      return { phase: 'none' };
    } catch (error) {
      return { phase: 'switch', error };
    }
  }

  async function runProductionHelperCollisionPairInTx(): Promise<CollisionResult> {
    await client.$disconnect();
    await client.$connect();

    return client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${quoteIdent(SCHEMA_A)}, public`);
      const tableRefA = await productionConversationsRef(tx);
      await tx.$queryRawUnsafe(insertIntoStatement(tableRefA), ...insertParams());

      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${quoteIdent(SCHEMA_B)}, public`);
      const tableRefB = await productionConversationsRef(tx);
      console.log(`\n── (d) helper real em tx ──\nA=${tableRefA}\nB=${tableRefB}`);
      try {
        await tx.$queryRawUnsafe(insertIntoStatement(tableRefB), ...insertParams());
        return { phase: 'none' };
      } catch (error) {
        return { phase: 'switch', error };
      }
    });
  }

  beforeAll(async () => {
    client = new PrismaClient({ datasourceUrl: probeDatabaseUrl(), log: ['error'] });
    await client.$connect();

    for (const schema of PROBE_SCHEMAS) {
      await createConversationProbeSchema(client, schema);
    }
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      for (const schema of PROBE_SCHEMAS) {
        await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      }
    } finally {
      await client.$disconnect();
    }
  }, 60_000);

  it('pré-condição — os enums conversation_status têm OIDs diferentes por schema', async () => {
    const oids = await readConversationStatusOids(client);

    console.log(
      `\n── conversation_status OIDs ──\n${oids
        .map((row) => `${row.schema}: ${row.oid}`)
        .join('\n')}`,
    );

    expect(oids).toHaveLength(2);
    expect(oids[0]?.oid).not.toBe(oids[1]?.oid);
  });

  it('(a) vetor não-qualificado — nome cru + RETURNING * dispara 0A000', async () => {
    const result = await runCollisionPair(() => STMT_UNQUALIFIED_STAR);

    expect(result.phase).toBe('switch');
    if (result.phase !== 'switch') return;

    const pgError = extractPgError(result.error);
    console.log(`\n── (a) nome cru + RETURNING * ──\ncode=${pgError.code}\nmessage=${pgError.message}`);
    expect(pgError.code).toBe('0A000');
  }, 60_000);

  it('(b) GATE — nome qualificado por schema gera statement distinto e não dispara', async () => {
    const result = await runCollisionPair(qualifiedStarStatement);

    if (result.phase !== 'none') {
      const pgError = extractPgError(result.error);
      throw new Error(`GATE FALHOU — code=${pgError.code}: ${pgError.message}`);
    }
    expect(result.phase).toBe('none');
  }, 60_000);

  it('(c) controle — colunas explícitas com status, mas sem qualificação, ainda disparam 0A000', async () => {
    // Documenta a lição: explicitar colunas fixa contagem/ordem, mas não muda
    // o `atttypid` do enum retornado por `status`.
    const result = await runCollisionPair(() => STMT_UNQUALIFIED_EXPLICIT_WITH_STATUS);

    expect(result.phase).toBe('switch');
    if (result.phase !== 'switch') return;

    const pgError = extractPgError(result.error);
    console.log(
      `\n── (c) nome cru + colunas explícitas incluindo status ──\n` +
        `code=${pgError.code}\nmessage=${pgError.message}`,
    );
    expect(pgError.code).toBe('0A000');
  }, 60_000);

  it('(d) helper real — conversationsRef resolve current_schema e qualifica sem disparar 0A000', async () => {
    const result = await runProductionHelperCollisionPairInTx();

    if (result.phase !== 'none') {
      const pgError = extractPgError(result.error);
      throw new Error(`HELPER REAL FALHOU — code=${pgError.code}: ${pgError.message}`);
    }
    expect(result.phase).toBe('none');
  }, 60_000);
});
