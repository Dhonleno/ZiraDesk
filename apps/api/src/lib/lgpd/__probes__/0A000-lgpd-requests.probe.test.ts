/**
 * SONDA 0A000 — oráculo de fechamento do item de dívida técnica (§16).
 *
 * NÃO é teste de regressão comum: prova um DEFEITO e prova a blindagem contra
 * ele. Quatro casos, isolando cada eixo do mecanismo.
 *
 * ── Por que fica desligada por padrão ──────────────────────────────────────
 * `vitest.config.ts:8` coleta `src/**\/*.test.ts` — qualquer arquivo com esse
 * sufixo dentro de `src/` entra na suíte, e sem o sufixo o vitest não roda o
 * arquivo nem por filtro posicional. Por isso o corte é por flag de ambiente
 * (`describe.skipIf`): num run normal o describe inteiro é pulado e nenhuma
 * conexão/DDL acontece.
 *
 * ── Como rodar ─────────────────────────────────────────────────────────────
 *   PowerShell:
 *     $env:ZIRADESK_PROBE_0A000=1
 *     pnpm --filter @ziradesk/api test -- src/lib/lgpd/__probes__/0A000-lgpd-requests.probe.test.ts
 *
 * ── O mecanismo ────────────────────────────────────────────────────────────
 * `0A000 cached plan must not change result type` nasce em
 * `RevalidateCachedQuery` (plancache.c): trocar o `search_path` invalida o
 * plansource, a reanálise resolve o mesmo nome para outra tabela, e
 * `equalTupleDescs` compara o descritor de resultado — inclusive `atttypmod`.
 * Se o statement veio do protocolo estendido (`fixed_result`), diferença vira
 * erro. Não depende de `plan_cache_mode` nem de volume: dispara na PRIMEIRA
 * reexecução.
 *
 * Daí os TRÊS eixos que a sonda separa:
 *   1. shape físico   — defs divergentes vs. def canônica unificada
 *   2. lista RETURNING — `*` (contagem/ordem variáveis) vs. colunas explícitas
 *   3. texto do statement — nome cru (compartilhado entre tenants, colide no
 *      cache do driver) vs. qualificado por schema (um statement por tenant)
 *
 * Conclusão medida (ver casos b2/b3): colunas explícitas NÃO bastam sozinhas
 * contra divergência de `atttypmod` — `RETURNING request_type` continua
 * carregando o typmod da coluna. Quem fecha o vetor de forma independente do
 * shape físico é a QUALIFICAÇÃO do nome da tabela.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LGPD_REQUEST_COLUMNS, ensureLgpdRequestsTable, lgpdRequestsRef } from '../schema.js';

const PROBE_ENABLED = process.env.ZIRADESK_PROBE_0A000 === '1';
const WARMUP_RUNS = Number(process.env.ZIRADESK_PROBE_0A000_WARMUP ?? '1');
const FORCE_GENERIC_PLAN = process.env.ZIRADESK_PROBE_0A000_FORCE_GENERIC === '1';

const STAMP = Date.now();
/** Shape antigo de crm.infrastructure.ts: request_type(40), status(20). */
const LEGACY_CRM = `probe_legacy_crm_${STAMP}`;
/** Shape antigo de portal.service.ts: request_type(30), status(30). */
const LEGACY_PORTAL = `probe_legacy_portal_${STAMP}`;
/** Dois schemas pela def canônica — devem ser byte-idênticos. */
const CANON_A = `probe_canon_a_${STAMP}`;
const CANON_B = `probe_canon_b_${STAMP}`;

const INSERT_COLUMNS = `contact_id, user_id, subject_type, request_type, status,
       requested_by, processed_by, payload, result, processed_at, sla_deadline`;
const INSERT_VALUES = `$1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid, $8::jsonb, $9::jsonb, NOW(), NULL`;

/** Vetor original: nome cru + `RETURNING *` (o que havia em requests.ts:44-49). */
const STMT_UNQUALIFIED_STAR = `INSERT INTO lgpd_requests (
       ${INSERT_COLUMNS}
     )
     VALUES (${INSERT_VALUES})
     RETURNING *`;

/** Meio do caminho: nome cru + colunas explícitas. Isola o eixo 2 do eixo 3. */
const STMT_UNQUALIFIED_EXPLICIT = `INSERT INTO lgpd_requests (
       ${INSERT_COLUMNS}
     )
     VALUES (${INSERT_VALUES})
     RETURNING ${LGPD_REQUEST_COLUMNS.join(', ')}`;

/** Statement de produção pós-correção: qualificado + colunas explícitas. */
function qualifiedExplicitStatement(schemaName: string): string {
  return `INSERT INTO ${lgpdRequestsRef(schemaName)} (
       ${INSERT_COLUMNS}
     )
     VALUES (${INSERT_VALUES})
     RETURNING ${LGPD_REQUEST_COLUMNS.join(', ')}`;
}

const INSERT_PARAMS = [
  null,                  // $1 contact_id
  null,                  // $2 user_id
  'contact',             // $3 subject_type
  'export',              // $4 request_type  (≤30 chars: cabe em todos os shapes)
  'processed',           // $5 status        (≤20 chars: cabe em todos os shapes)
  null,                  // $6 requested_by
  null,                  // $7 processed_by
  JSON.stringify({ probe: '0A000' }), // $8 payload
  JSON.stringify({}),                 // $9 result
];

interface ColumnShape {
  ordinal_position: number;
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
}

function probeDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      'DATABASE_URL ausente. Rode via `pnpm --filter @ziradesk/api test` (o script carrega .env.test).',
    );
  }

  // connection_limit=1: o pool passa a ter UMA conexão física, então as
  // execuções caem obrigatoriamente no mesmo backend Postgres — onde vive o
  // cache de prepared statements.
  const url = new URL(raw);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('pool_timeout', '10');
  return url.toString();
}

/** Dependências mínimas para as FKs das definições reais. */
async function createSchemaWithFkTargets(client: PrismaClient, schema: string): Promise<void> {
  await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await client.$executeRawUnsafe(
    `CREATE TABLE "${schema}".contacts (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`,
  );
  await client.$executeRawUnsafe(
    `CREATE TABLE "${schema}".users (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`,
  );
}

/**
 * Réplica do DDL que existia em `crm.infrastructure.ts:112-129` ANTES da
 * unificação. Mantida como cópia congelada de propósito: é o lado A do vetor
 * original, e a produção não tem mais este texto.
 */
async function createLegacyCrmShape(client: PrismaClient, schema: string): Promise<void> {
  const s = `"${schema}"`;
  await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${s}.lgpd_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID REFERENCES ${s}.contacts(id) ON DELETE SET NULL,
        user_id UUID REFERENCES ${s}.users(id) ON DELETE SET NULL,
        subject_type VARCHAR(20) NOT NULL DEFAULT 'contact',
        request_type VARCHAR(40) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'processed',
        requested_by UUID REFERENCES ${s}.users(id) ON DELETE SET NULL,
        processed_by UUID REFERENCES ${s}.users(id) ON DELETE SET NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        result JSONB NOT NULL DEFAULT '{}',
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        sla_deadline TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 days'),
        notified_at TIMESTAMPTZ,
        reminder_sent_at TIMESTAMPTZ
      )
    `);
}

/** Réplica congelada do DDL que existia em `portal.service.ts:174-191`. */
async function createLegacyPortalShape(client: PrismaClient, schema: string): Promise<void> {
  const s = `"${schema}"`;
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${s}.lgpd_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID REFERENCES ${s}.contacts(id) ON DELETE SET NULL,
      user_id UUID REFERENCES ${s}.users(id) ON DELETE SET NULL,
      subject_type VARCHAR(20) NOT NULL DEFAULT 'contact',
      request_type VARCHAR(30) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      requested_by UUID REFERENCES ${s}.users(id),
      processed_by UUID REFERENCES ${s}.users(id),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      sla_deadline TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 days'),
      notified_at TIMESTAMPTZ,
      reminder_sent_at TIMESTAMPTZ
    )
  `);
}

async function readColumnShape(client: PrismaClient, schema: string): Promise<ColumnShape[]> {
  return client.$queryRawUnsafe<ColumnShape[]>(
    `SELECT ordinal_position::int AS ordinal_position, column_name, data_type,
            character_maximum_length::int AS character_maximum_length
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'lgpd_requests'
      ORDER BY ordinal_position`,
    schema,
  );
}

function describeShape(rows: ColumnShape[]): string {
  return rows
    .map((row) => `${row.ordinal_position}. ${row.column_name} ${row.data_type}${
      row.character_maximum_length === null ? '' : `(${row.character_maximum_length})`
    }`)
    .join('\n');
}

/** Extrai code/mensagem crua do Postgres de dentro do wrapper do Prisma. */
function extractPgError(error: unknown): { code?: string | undefined; message: string } {
  if (!error || typeof error !== 'object') return { message: String(error) };

  const err = error as { code?: string; message?: string; meta?: Record<string, unknown> };
  const metaCode = typeof err.meta?.code === 'string' ? err.meta.code : undefined;
  const metaMessage = typeof err.meta?.message === 'string' ? err.meta.message : undefined;

  return {
    // P2010 é o envelope do Prisma para raw query; o code do PG vem em meta.code.
    code: metaCode ?? err.code,
    message: metaMessage ?? err.message ?? String(error),
  };
}

function isCachedPlanError(error: unknown): boolean {
  const pgError = extractPgError(error);
  return (
    pgError.code === '0A000' ||
    pgError.message.includes('cached plan must not change result type')
  );
}

describe.skipIf(!PROBE_ENABLED)('SONDA 0A000 — lgpd_requests', () => {
  let client: PrismaClient;

  type CollisionResult = { phase: 'warmup' | 'switch' | 'none'; error?: unknown };

  /**
   * Executa o statement em `schemaA` (N vezes, para cachear), troca o
   * search_path para `schemaB` e reexecuta.
   *
   * `statementFor` recebe o schema ativo: com texto cru devolve sempre a mesma
   * string (statement compartilhado entre tenants); qualificado, uma por schema.
   *
   * Reconecta antes de cada par: o cache de prepared statements é por conexão,
   * e sem isolar um caso contamina o seguinte — foi o que aconteceu na primeira
   * execução desta sonda, onde (b1) deixou o texto cacheado com shape canônico
   * e (b2) colidiu já no warmup. A fase é devolvida para que um erro fora do
   * ponto esperado apareça em vez de virar falso positivo.
   */
  async function runCollisionPair(
    schemaA: string,
    schemaB: string,
    statementFor: (schema: string) => string,
  ): Promise<CollisionResult> {
    await client.$disconnect();
    await client.$connect();
    if (FORCE_GENERIC_PLAN) {
      await client.$executeRawUnsafe(`SET plan_cache_mode = force_generic_plan`);
    }

    try {
      await client.$executeRawUnsafe(`SET search_path TO "${schemaA}", public`);
      for (let run = 0; run < WARMUP_RUNS; run += 1) {
        await client.$queryRawUnsafe(statementFor(schemaA), ...INSERT_PARAMS);
      }
    } catch (error) {
      return { phase: 'warmup', error };
    }

    await client.$executeRawUnsafe(`SET search_path TO "${schemaB}", public`);
    try {
      await client.$queryRawUnsafe(statementFor(schemaB), ...INSERT_PARAMS);
      return { phase: 'none' };
    } catch (error) {
      return { phase: 'switch', error };
    }
  }

  beforeAll(async () => {
    client = new PrismaClient({ datasourceUrl: probeDatabaseUrl(), log: ['error'] });
    await client.$connect();

    if (FORCE_GENERIC_PLAN) {
      await client.$executeRawUnsafe(`SET plan_cache_mode = force_generic_plan`);
    }

    await createSchemaWithFkTargets(client, LEGACY_CRM);
    await createLegacyCrmShape(client, LEGACY_CRM);

    await createSchemaWithFkTargets(client, LEGACY_PORTAL);
    await createLegacyPortalShape(client, LEGACY_PORTAL);

    // Def canônica de produção — exercita o código real, não uma cópia.
    await createSchemaWithFkTargets(client, CANON_A);
    await ensureLgpdRequestsTable(client, CANON_A);

    await createSchemaWithFkTargets(client, CANON_B);
    await ensureLgpdRequestsTable(client, CANON_B);
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      for (const schema of [LEGACY_CRM, LEGACY_PORTAL, CANON_A, CANON_B]) {
        await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally {
      await client.$disconnect();
    }
  }, 60_000);

  it('as defs legadas divergem em atttypmod; a def canônica produz shape idêntico', async () => {
    const legacyCrm = await readColumnShape(client, LEGACY_CRM);
    const legacyPortal = await readColumnShape(client, LEGACY_PORTAL);
    const canonA = await readColumnShape(client, CANON_A);
    const canonB = await readColumnShape(client, CANON_B);

    console.log(`\n── legado crm ──\n${describeShape(legacyCrm)}`);
    console.log(`\n── legado portal ──\n${describeShape(legacyPortal)}`);
    console.log(`\n── canônico ──\n${describeShape(canonA)}`);

    const lengthOf = (rows: ColumnShape[], column: string) =>
      rows.find((row) => row.column_name === column)?.character_maximum_length;

    // A divergência histórica que originou o 0A000.
    expect(lengthOf(legacyCrm, 'request_type')).toBe(40);
    expect(lengthOf(legacyPortal, 'request_type')).toBe(30);
    expect(lengthOf(legacyCrm, 'status')).toBe(20);
    expect(lengthOf(legacyPortal, 'status')).toBe(30);

    // Shape canônico: larguras decididas e IDÊNTICAS entre schemas.
    expect(describeShape(canonA)).toBe(describeShape(canonB));
    expect(lengthOf(canonA, 'request_type')).toBe(30);
    expect(lengthOf(canonA, 'status')).toBe(20);
  });

  it('(a) VETOR ORIGINAL — nome cru + RETURNING * sobre defs divergentes dispara 0A000', async () => {
    const result = await runCollisionPair(LEGACY_CRM, LEGACY_PORTAL, () => STMT_UNQUALIFIED_STAR);

    if (result.phase !== 'switch') {
      throw new Error(
        `SONDA NÃO REPRODUZIU o vetor original na troca de search_path ` +
          `(fase=${result.phase}, warmup=${WARMUP_RUNS}, force_generic_plan=${FORCE_GENERIC_PLAN}). ` +
          'O mecanismo mudou — reinvestigar antes de confiar nos casos de blindagem abaixo.',
      );
    }

    const pgError = extractPgError(result.error);
    console.log(`\n── (a) vetor original ──\ncode=${pgError.code}\nmessage=${pgError.message}`);
    expect(isCachedPlanError(result.error)).toBe(true);
  }, 60_000);

  it('(b1) DEFS UNIFICADAS — shape canônico nos dois schemas não colide', async () => {
    const result = await runCollisionPair(CANON_A, CANON_B, () => STMT_UNQUALIFIED_EXPLICIT);

    if (result.phase !== 'none') {
      const pgError = extractPgError(result.error);
      throw new Error(
        `Esperado nenhum erro com shape canônico nos dois lados; veio na fase ` +
          `${result.phase}, code=${pgError.code}: ${pgError.message}`,
      );
    }
    expect(result.phase).toBe('none');
  }, 60_000);

  it('(b2) MEDIÇÃO — colunas explícitas NÃO blindam typmod divergente com nome cru', async () => {
    const result = await runCollisionPair(LEGACY_CRM, LEGACY_PORTAL, () => STMT_UNQUALIFIED_EXPLICIT);

    const pgError = extractPgError(result.error);
    console.log(
      `\n── (b2) explícito + nome cru sobre typmod divergente ──\nfase=${result.phase}\n` +
        `${result.phase === 'none' ? 'sem erro' : `code=${pgError.code}\nmessage=${pgError.message}`}`,
    );

    // Resultado MEDIDO: dispara na troca. `RETURNING request_type` devolve
    // varchar(40) num schema e varchar(30) no outro — a lista explícita fixa
    // contagem e ordem do descritor, não o typmod de cada coluna. Este caso
    // existe para impedir que "colunas explícitas" seja lido como blindagem
    // completa: quem fecha o vetor sozinho é a qualificação (caso b3).
    expect(result.phase).toBe('switch');
    expect(isCachedPlanError(result.error)).toBe(true);
  }, 60_000);

  it('(b3) GATE — statement de produção (qualificado + explícito) não colide nem com typmod divergente', async () => {
    const result = await runCollisionPair(LEGACY_CRM, LEGACY_PORTAL, qualifiedExplicitStatement);

    if (result.phase !== 'none') {
      const pgError = extractPgError(result.error);
      throw new Error(
        `GATE FALHOU — o statement de produção ainda colide na fase ${result.phase}. ` +
          `code=${pgError.code}: ${pgError.message}`,
      );
    }
    expect(result.phase).toBe('none');
  }, 60_000);
});
