import { prisma } from '../config/database.js';
import { syncTemplatesFromMeta } from '../modules/admin/templates/templates.service.js';

type TenantRow = { id: string; slug: string; schema_name: string };
type ChannelRow = { id: string; name: string };

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function tableExists(schemaName: string, tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: string | null }>>(
    `SELECT to_regclass($1)::text AS exists`,
    `${schemaName}.${tableName}`,
  );
  return Boolean(rows[0]?.exists);
}

async function run() {
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, slug, schema_name FROM public.tenants WHERE status = 'active' ORDER BY created_at ASC`,
  );

  let totalChannels = 0;
  let totalTemplates = 0;

  for (const tenant of tenants) {
    const schemaName = tenant.schema_name;
    if (!(await tableExists(schemaName, 'channels'))) {
      console.log(`[${tenant.slug}] schema=${schemaName} sem tabela channels, pulando`);
      continue;
    }

    const schema = quoteIdent(schemaName);
    const channels = await prisma.$queryRawUnsafe<ChannelRow[]>(
      `SELECT id::text, name
       FROM ${schema}.channels
       WHERE type = 'whatsapp'
         AND status = 'active'
       ORDER BY created_at ASC`,
    );

    if (channels.length === 0) {
      console.log(`[${tenant.slug}] nenhum canal WhatsApp ativo`);
      continue;
    }

    for (const channel of channels) {
      try {
        const result = await syncTemplatesFromMeta(schemaName, channel.id);
        totalChannels += 1;
        totalTemplates += result.count;
        console.log(`[${tenant.slug}] canal="${channel.name}" templates_sincronizados=${result.count}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${tenant.slug}] canal="${channel.name}" falhou: ${message}`);
      }
    }
  }

  console.log(`Tenants ativos=${tenants.length} | Canais sincronizados=${totalChannels} | Templates processados=${totalTemplates}`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
