/**
 * Backfill do public.channel_registry a partir dos canais WhatsApp existentes.
 *
 *   pnpm exec tsx --env-file=.env src/scripts/backfill-channel-registry.ts           # dry-run (padrão)
 *   pnpm exec tsx --env-file=.env src/scripts/backfill-channel-registry.ts --apply   # grava
 *
 * Por que é um script e não SQL: `phone_number_id` NÃO é coluna. Ele vive dentro
 * de "<schema>".channels.credentials, cifrado em AES-CBC com IV aleatório — o
 * Postgres não consegue lê-lo, então a varredura precisa descriptografar em
 * memória com a ENCRYPTION_KEY da aplicação.
 *
 * Idempotente: ON CONFLICT (phone_number_id) DO NOTHING. Re-executar é seguro e
 * nunca sobrescreve uma reivindicação já existente.
 *
 * Salvaguarda: se o mesmo phone_number_id aparecer em schemas DIFERENTES, aborta
 * tudo sem gravar nada. Isso seria uma colisão cross-tenant já materializada —
 * incidente, não caso de desempate automático.
 */
import { prisma } from '../config/database.js';
import { decryptCredentials } from '../utils/crypto.js';

const SAFE_SCHEMA_NAME = /^[a-z0-9_]+$/;

interface TenantRow {
  id: string;
  slug: string;
  schema_name: string;
  status: string;
}

interface ChannelRow {
  id: string;
  status: string;
  created_at: Date;
  credentials: string | object;
}

interface Claim {
  phoneNumberId: string;
  schemaName: string;
  slug: string;
  channelId: string;
  channelStatus: string;
}

interface Collision {
  phoneNumberId: string;
  first: Claim;
  second: Claim;
}

interface Plan {
  claims: Claim[];
  collisions: Collision[];
  scannedSchemas: string[];
  skippedSchemas: Array<{ schemaName: string; reason: string }>;
  skippedChannels: Array<{ schemaName: string; channelId: string; reason: string }>;
}

/**
 * Desempate dentro de um mesmo schema: prefere o canal ativo; sem nenhum ativo,
 * o mais recente. Só um channel_id por phone_number_id entra no registry.
 */
function pickWinner(candidates: ChannelRow[]): ChannelRow {
  const active = candidates.filter((row) => row.status === 'active');
  const pool = active.length > 0 ? active : candidates;
  return [...pool].sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0]!;
}

export async function planBackfill(): Promise<Plan> {
  const plan: Plan = {
    claims: [],
    collisions: [],
    scannedSchemas: [],
    skippedSchemas: [],
    skippedChannels: [],
  };

  // Todos os status: um tenant suspenso pode voltar, e o número precisa continuar
  // reservado a ele enquanto isso — senão outro tenant o toma no intervalo.
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, slug, schema_name, status FROM public.tenants ORDER BY created_at`,
  );

  const seen = new Map<string, Claim>();

  for (const tenant of tenants) {
    if (!SAFE_SCHEMA_NAME.test(tenant.schema_name)) {
      plan.skippedSchemas.push({ schemaName: tenant.schema_name, reason: 'nome de schema inválido' });
      continue;
    }

    let channels: ChannelRow[];
    try {
      channels = await prisma.$queryRawUnsafe<ChannelRow[]>(
        `SELECT id, status, created_at, credentials
           FROM "${tenant.schema_name}".channels
          WHERE type = 'whatsapp'`,
      );
    } catch {
      // Tenant meio-provisionado (schema ou tabela ausente) não pode abortar a varredura.
      plan.skippedSchemas.push({
        schemaName: tenant.schema_name,
        reason: 'schema ou tabela channels ausente',
      });
      continue;
    }

    plan.scannedSchemas.push(tenant.schema_name);

    const byNumber = new Map<string, ChannelRow[]>();
    for (const channel of channels) {
      let phoneNumberId: string | null = null;
      try {
        const credentials = decryptCredentials(channel.credentials);
        const raw = credentials['phoneNumberId'] ?? credentials['phone_number_id'];
        phoneNumberId = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      } catch {
        plan.skippedChannels.push({
          schemaName: tenant.schema_name,
          channelId: channel.id,
          reason: 'credenciais ilegíveis',
        });
        continue;
      }

      // Canal sem phone_number_id (credenciais vazias, Instagram/e-mail) é pulado,
      // não é erro — não há o que registrar.
      if (!phoneNumberId) {
        plan.skippedChannels.push({
          schemaName: tenant.schema_name,
          channelId: channel.id,
          reason: 'sem phone_number_id',
        });
        continue;
      }

      const bucket = byNumber.get(phoneNumberId) ?? [];
      bucket.push(channel);
      byNumber.set(phoneNumberId, bucket);
    }

    for (const [phoneNumberId, candidates] of byNumber) {
      const winner = pickWinner(candidates);
      const claim: Claim = {
        phoneNumberId,
        schemaName: tenant.schema_name,
        slug: tenant.slug,
        channelId: winner.id,
        channelStatus: winner.status,
      };

      const previous = seen.get(phoneNumberId);
      if (previous && previous.schemaName !== claim.schemaName) {
        plan.collisions.push({ phoneNumberId, first: previous, second: claim });
        continue;
      }

      seen.set(phoneNumberId, claim);
      plan.claims.push(claim);
    }
  }

  return plan;
}

async function applyBackfill(plan: Plan): Promise<{ inserted: number; alreadyPresent: number }> {
  let inserted = 0;

  await prisma.$transaction(async (tx) => {
    for (const claim of plan.claims) {
      const affected = await tx.$executeRawUnsafe(
        `INSERT INTO public.channel_registry (phone_number_id, tenant_schema, channel_id)
         VALUES ($1, $2, $3::uuid)
         ON CONFLICT (phone_number_id) DO NOTHING`,
        claim.phoneNumberId,
        claim.schemaName,
        claim.channelId,
      );
      inserted += affected;
    }
  });

  return { inserted, alreadyPresent: plan.claims.length - inserted };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const plan = await planBackfill();

  console.log(apply ? '=== BACKFILL (--apply) ===' : '=== DRY-RUN (nada será gravado) ===');
  console.log('');
  console.log(`Schemas varridos: ${plan.scannedSchemas.length} — ${plan.scannedSchemas.join(', ') || '(nenhum)'}`);
  for (const skipped of plan.skippedSchemas) {
    console.log(`  schema pulado: ${skipped.schemaName} — ${skipped.reason}`);
  }
  console.log('');

  console.log(`Números a registrar: ${plan.claims.length}`);
  for (const claim of plan.claims) {
    console.log(
      `  ${claim.phoneNumberId.padEnd(20)} → ${claim.schemaName} (slug=${claim.slug}, `
      + `canal=${claim.channelId}, status=${claim.channelStatus})`,
    );
  }
  console.log('');

  console.log(`Canais pulados: ${plan.skippedChannels.length}`);
  for (const skipped of plan.skippedChannels) {
    console.log(`  ${skipped.schemaName} / ${skipped.channelId} — ${skipped.reason}`);
  }
  console.log('');

  if (plan.collisions.length > 0) {
    console.error(`ABORTADO — ${plan.collisions.length} colisão(ões) cross-tenant detectada(s):`);
    for (const collision of plan.collisions) {
      console.error(
        `  ${collision.phoneNumberId}: ${collision.first.schemaName} (canal ${collision.first.channelId})`
        + ` vs ${collision.second.schemaName} (canal ${collision.second.channelId})`,
      );
    }
    console.error('');
    console.error('Isto é incidente, não desempate. Nada foi gravado. Resolver a duplicidade antes de repetir.');
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  console.log('Colisões cross-tenant: 0 ✓');
  console.log('');

  if (!apply) {
    console.log('Dry-run concluído. Revise a lista acima e rode com --apply para gravar.');
    await prisma.$disconnect();
    return;
  }

  const result = await applyBackfill(plan);
  console.log(
    `Concluído: ${result.inserted} inserido(s), ${result.alreadyPresent} já presente(s) (ON CONFLICT DO NOTHING).`,
  );
  await prisma.$disconnect();
}

// Só executa como CLI; importável para teste.
if (process.argv[1]?.includes('backfill-channel-registry')) {
  void main();
}
