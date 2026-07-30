/**
 * Limpeza de tenants/schemas fantasmas deixados por execuções de teste.
 *
 *   pnpm exec tsx --env-file=.env src/scripts/cleanup-test-tenants.ts            # dry-run (padrão)
 *   pnpm exec tsx --env-file=.env src/scripts/cleanup-test-tenants.ts --apply    # remove de verdade
 *
 * Operação DESTRUTIVA. O critério é em três camadas e TODAS precisam concordar;
 * se qualquer uma falhar, o tenant é preservado. Ver ARQUITETURA_TECNICA.md §16.
 *
 * Também exporta sweepTestGhosts() para o globalSetup dos testes varrer resíduo
 * de runs interrompidos (SIGINT/kill), que nenhum teardown do Vitest cobre.
 */
import { prisma } from '../config/database.js';

/**
 * Camada (a) — match POSITIVO: os 16 prefixos de schema que o código de teste
 * gera. Nada é removido por "não parecer real"; só por parecer teste.
 * Mais específico primeiro, para o rótulo do relatório sair correto.
 */
export const TEST_SCHEMA_PREFIXES = [
  'test_super_admin_',   // modules/super-admin/super-admin.integration.test.ts:73
  'test_admin_',         // modules/admin/admin.integration.test.ts:102
  'test_',               // test/setup.ts:317 — tenant do globalSetup
  'schema_',             // crm / notifications / portal / tickets / omnichannel.webhooks
  'ticket_sla_warning_', // jobs/ticket-sla-warning.integration.test.ts:40
  'lgpd_sla_',           // jobs/lgpd-sla.integration.test.ts:53
  'lgpd_oc_',            // modules/omnichannel/omnichannel-lgpd.integration.test.ts:34
  'active_outbound_',    // modules/omnichannel/active-outbound.integration.test.ts:23
  'auto_assign_',        // modules/omnichannel/conversations/auto-assign.integration.test.ts:39
  'campaigns_',          // modules/omnichannel/campaigns/campaigns.integration.test.ts:27
  'monitor_bot_',        // modules/omnichannel/monitor-bot.integration.test.ts:24
  'monitor_',            // modules/omnichannel/tv.service.integration.test.ts:22
  'metrics_',            // modules/omnichannel/metrics/metrics.integration.test.ts:56
  'qnotif_',             // modules/omnichannel/queue/queue-notifications.integration.test.ts:40
  'conv_',               // modules/omnichannel/conversations.integration.test.ts:23
  'it_',                 // middleware/tenant.middleware.integration.test.ts:39
] as const;

/**
 * Camada (b) — allowlist redundante. Nunca remover, mesmo que casasse (a).
 * `tenant_` é o invariante de produção: toSchemaName() (tenants.service.ts:66)
 * prefixa TODO tenant real com ele, qualquer que seja o slug.
 */
const PRODUCTION_PREFIX = 'tenant_';
const PROTECTED_SCHEMAS = new Set(['public', 'information_schema', 'tenant_demo']);

/**
 * Camada (a), parte 2 — o nome precisa ter forma de gerado: um carimbo de
 * Date.now() (>= 8 dígitos seguidos) e terminar em dígito. Um slug real como
 * `tenant_acme_2024` não passa (4 dígitos), e de todo modo cai na camada (b).
 */
function hasGeneratedShape(schemaName: string): boolean {
  return /\d{8,}/.test(schemaName) && /\d$/.test(schemaName);
}

/** Camada (a): retorna o prefixo casado, ou null. */
export function matchTestPrefix(schemaName: string): string | null {
  if (!hasGeneratedShape(schemaName)) return null;
  return TEST_SCHEMA_PREFIXES.find((prefix) => schemaName.startsWith(prefix)) ?? null;
}

/** Camada (b): true = preservar incondicionalmente. */
export function isProtectedSchema(schemaName: string): boolean {
  return schemaName.startsWith(PRODUCTION_PREFIX) || PROTECTED_SCHEMAS.has(schemaName);
}

interface TenantRow {
  id: string;
  schema_name: string;
  slug: string;
  status: string;
  created_at: Date;
  schema_exists: boolean;
  tables: number;
  subscriptions: number;
  snapshots: number;
}

export interface GhostCandidate {
  id: string;
  schemaName: string;
  slug: string;
  createdAt: Date;
  schemaExists: boolean;
  tables: number;
  snapshots: number;
  prefix: string;
}

export interface PreservedTenant {
  schemaName: string;
  reason: string;
}

export interface SweepPlan {
  candidates: GhostCandidate[];
  orphanSchemas: Array<{ schemaName: string; tables: number; prefix: string }>;
  preserved: PreservedTenant[];
}

/**
 * Monta o plano sem remover nada.
 *
 * @param minAgeHours quando > 0, ignora tenants criados há menos que isso —
 *   protege o tenant do run em andamento (e de runs paralelos) de ser varrido.
 */
export async function planSweep(minAgeHours = 0): Promise<SweepPlan> {
  const rows = await prisma.$queryRawUnsafe<TenantRow[]>(`
    SELECT t.id, t.schema_name, t.slug, t.status, t.created_at,
           (n.nspname IS NOT NULL) AS schema_exists,
           (SELECT COUNT(*) FROM information_schema.tables it
             WHERE it.table_schema = t.schema_name)::int AS tables,
           (SELECT COUNT(*) FROM public.subscriptions s WHERE s.tenant_id = t.id)::int AS subscriptions,
           (SELECT COUNT(*) FROM public.usage_snapshots u WHERE u.tenant_id = t.id)::int AS snapshots
    FROM public.tenants t
    LEFT JOIN pg_namespace n ON n.nspname = t.schema_name
    ORDER BY t.created_at
  `);

  const candidates: GhostCandidate[] = [];
  const preserved: PreservedTenant[] = [];
  const cutoff = minAgeHours > 0 ? Date.now() - minAgeHours * 3_600_000 : null;

  for (const row of rows) {
    // (b) primeiro: allowlist vence qualquer outra consideração.
    if (isProtectedSchema(row.schema_name)) {
      preserved.push({ schemaName: row.schema_name, reason: 'allowlist (b): tenant_* ou protegido' });
      continue;
    }
    // (a) match positivo por prefixo + forma gerada.
    const prefix = matchTestPrefix(row.schema_name);
    if (!prefix) {
      preserved.push({ schemaName: row.schema_name, reason: 'nao casa (a): prefixo/forma de teste' });
      continue;
    }
    // (c) assinatura = tenant real por definição, independente do nome.
    if (row.subscriptions > 0) {
      preserved.push({
        schemaName: row.schema_name,
        reason: `nao passa (c): tem ${row.subscriptions} subscription(s)`,
      });
      continue;
    }
    if (cutoff !== null && row.created_at.getTime() > cutoff) {
      preserved.push({
        schemaName: row.schema_name,
        reason: `recente (< ${minAgeHours}h) — provavel run em andamento`,
      });
      continue;
    }

    candidates.push({
      id: row.id,
      schemaName: row.schema_name,
      slug: row.slug,
      createdAt: row.created_at,
      schemaExists: row.schema_exists,
      tables: row.tables,
      snapshots: row.snapshots,
      prefix,
    });
  }

  // Schemas sem linha em public.tenants. São inofensivos para os jobs (que
  // varrem public.tenants), então só entram na limpeza manual — o sweep
  // automático (minAgeHours > 0) não os toca, porque não há created_at para
  // aferir idade e um schema recem-criado poderia ser de um run paralelo.
  const orphanSchemas: SweepPlan['orphanSchemas'] = [];
  if (minAgeHours === 0) {
    const schemas = await prisma.$queryRawUnsafe<Array<{ nspname: string; tables: number }>>(`
      SELECT n.nspname,
             (SELECT COUNT(*) FROM information_schema.tables it
               WHERE it.table_schema = n.nspname)::int AS tables
      FROM pg_namespace n
      WHERE n.nspname NOT LIKE 'pg_%'
        AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.schema_name = n.nspname)
      ORDER BY n.nspname
    `);
    for (const schema of schemas) {
      if (isProtectedSchema(schema.nspname)) continue;
      const prefix = matchTestPrefix(schema.nspname);
      if (!prefix) continue;
      orphanSchemas.push({ schemaName: schema.nspname, tables: schema.tables, prefix });
    }
  }

  return { candidates, orphanSchemas, preserved };
}

export interface SweepResult {
  removedRows: number;
  removedSchemas: number;
  failures: Array<{ schemaName: string; error: string }>;
}

/**
 * Aplica o plano. Ordem por candidato: usage_snapshots → linha → schema.
 *
 * usage_snapshots vem primeiro porque a FK é ON DELETE RESTRICT — o job diário
 * de snapshot varre tenants active/trial e escreve uma linha para cada fantasma,
 * o que torna a linha indeletável por um `tenant.deleteMany` cru (P2003).
 * A linha vem antes do schema para que um DROP que falhe deixe schema orfao
 * (inofensivo) em vez de linha orfa (que os jobs varrem).
 */
export async function applySweep(
  plan: SweepPlan,
  log: (message: string) => void = console.log,
): Promise<SweepResult> {
  const result: SweepResult = { removedRows: 0, removedSchemas: 0, failures: [] };

  for (const ghost of plan.candidates) {
    try {
      if (ghost.snapshots > 0) {
        await prisma.usageSnapshot.deleteMany({ where: { tenantId: ghost.id } });
      }
      await prisma.tenant.deleteMany({ where: { id: ghost.id } });
      result.removedRows += 1;
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${ghost.schemaName}" CASCADE`);
      if (ghost.schemaExists) result.removedSchemas += 1;
      log(`  removido: ${ghost.schemaName} (linha + schema, ${ghost.tables} tabelas, snapshots=${ghost.snapshots})`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      result.failures.push({ schemaName: ghost.schemaName, error });
      log(`  FALHOU: ${ghost.schemaName} — ${error}`);
    }
  }

  for (const orphan of plan.orphanSchemas) {
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${orphan.schemaName}" CASCADE`);
      result.removedSchemas += 1;
      log(`  removido: ${orphan.schemaName} (schema orfao, ${orphan.tables} tabelas)`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      result.failures.push({ schemaName: orphan.schemaName, error });
      log(`  FALHOU: ${orphan.schemaName} — ${error}`);
    }
  }

  return result;
}

/**
 * Varredura para uso programático (globalSetup dos testes). Aplica direto —
 * dry-run aqui não limparia nada — mas com as três camadas e o corte de idade
 * protegendo. Silencioso quando não há nada a remover.
 */
export async function sweepTestGhosts(options: {
  minAgeHours?: number;
  log?: (message: string) => void;
} = {}): Promise<SweepResult> {
  const log = options.log ?? console.log;
  // Clamp em 1h: este caminho aplica sem revisão humana, então não pode virar
  // apply irrestrito. minAgeHours = 0 desligaria o corte de idade E ligaria a
  // coleta de schemas órfãos — poder que fica só no CLI, que tem dry-run.
  const plan = await planSweep(Math.max(1, options.minAgeHours ?? 2));
  if (plan.candidates.length === 0) {
    return { removedRows: 0, removedSchemas: 0, failures: [] };
  }
  log(`[test-sweep] removendo ${plan.candidates.length} tenant(s) fantasma de runs anteriores`);
  return applySweep(plan, log);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const plan = await planSweep(0);

  console.log(apply ? '=== LIMPEZA (--apply) ===' : '=== DRY-RUN (nada sera removido) ===');
  console.log('');

  console.log(`CANDIDATOS A REMOCAO — ${plan.candidates.length} tenant(s) com linha em public.tenants`);
  for (const ghost of plan.candidates) {
    const state = ghost.schemaExists ? `linha + schema (${ghost.tables} tabelas)` : 'linha SEM schema';
    console.log(
      `  ${ghost.schemaName.padEnd(32)} prefixo="${ghost.prefix}"  ${state}`
      + `  snapshots=${ghost.snapshots}  criado=${ghost.createdAt.toISOString().slice(0, 16)}`,
    );
  }
  console.log('');

  console.log(`SCHEMAS ORFAOS (sem linha) — ${plan.orphanSchemas.length}`);
  for (const orphan of plan.orphanSchemas) {
    console.log(`  ${orphan.schemaName.padEnd(32)} prefixo="${orphan.prefix}"  ${orphan.tables} tabelas`);
  }
  console.log('');

  console.log(`PRESERVADOS — ${plan.preserved.length}`);
  for (const kept of plan.preserved) {
    console.log(`  ${kept.schemaName.padEnd(32)} ${kept.reason}`);
  }
  console.log('');

  if (!apply) {
    console.log('Dry-run concluido. Revise a lista acima e rode com --apply para remover.');
    await prisma.$disconnect();
    return;
  }

  const result = await applySweep(plan);
  console.log('');
  console.log(
    `Concluido: ${result.removedRows} linha(s) e ${result.removedSchemas} schema(s) removidos, `
    + `${result.failures.length} falha(s).`,
  );
  await prisma.$disconnect();
  if (result.failures.length > 0) process.exitCode = 1;
}

// Só executa como CLI; importado pelo globalSetup, apenas exporta.
if (process.argv[1]?.includes('cleanup-test-tenants')) {
  void main();
}
