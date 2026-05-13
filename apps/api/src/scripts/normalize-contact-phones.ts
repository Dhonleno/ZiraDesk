import { prisma } from '../config/database.js';
import { normalizePhoneForStorage, PhoneNormalizationError } from '../utils/phone.js';

type TenantRow = { id: string; slug: string; schema_name: string };
type ContactRow = { id: string; phone: string | null; whatsapp: string | null };

async function tableExists(schemaName: string, tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: string | null }>>(
    `SELECT to_regclass($1)::text AS exists`,
    `${schemaName}.${tableName}`,
  );
  return Boolean(rows[0]?.exists);
}

async function run() {
  const tenants = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, slug, schema_name FROM public.tenants ORDER BY created_at ASC`,
  );

  let totalUpdated = 0;
  let totalScanned = 0;
  const invalidRows: Array<{ schema: string; contactId: string; field: 'phone' | 'whatsapp'; value: string; error: string }> = [];

  for (const tenant of tenants) {
    const schema = tenant.schema_name;
    if (!(await tableExists(schema, 'contacts'))) {
      console.log(`[${schema}] contatos: tabela inexistente, pulando`);
      continue;
    }

    const contacts = await prisma.$queryRawUnsafe<ContactRow[]>(
      `SELECT id, phone, whatsapp FROM "${schema}".contacts WHERE phone IS NOT NULL OR whatsapp IS NOT NULL`,
    );

    let updatedInSchema = 0;
    totalScanned += contacts.length;

    for (const contact of contacts) {
      let nextPhone = contact.phone;
      let nextWhatsapp = contact.whatsapp;

      if (contact.phone !== null) {
        try {
          nextPhone = normalizePhoneForStorage(contact.phone);
        } catch (err) {
          invalidRows.push({
            schema,
            contactId: contact.id,
            field: 'phone',
            value: contact.phone,
            error: err instanceof PhoneNormalizationError || err instanceof Error ? err.message : String(err),
          });
          nextPhone = contact.phone;
        }
      }

      if (contact.whatsapp !== null) {
        try {
          nextWhatsapp = normalizePhoneForStorage(contact.whatsapp);
        } catch (err) {
          invalidRows.push({
            schema,
            contactId: contact.id,
            field: 'whatsapp',
            value: contact.whatsapp,
            error: err instanceof PhoneNormalizationError || err instanceof Error ? err.message : String(err),
          });
          nextWhatsapp = contact.whatsapp;
        }
      }

      if (nextPhone !== contact.phone || nextWhatsapp !== contact.whatsapp) {
        await prisma.$executeRawUnsafe(
          `UPDATE "${schema}".contacts
           SET phone = $1,
               whatsapp = $2,
               updated_at = NOW()
           WHERE id = $3::uuid`,
          nextPhone,
          nextWhatsapp,
          contact.id,
        );
        updatedInSchema += 1;
      }
    }

    totalUpdated += updatedInSchema;
    console.log(`[${schema}] contatos analisados=${contacts.length} atualizados=${updatedInSchema}`);
  }

  console.log(`Total analisados=${totalScanned} | Total atualizados=${totalUpdated}`);

  if (invalidRows.length > 0) {
    console.log('Contatos com valores inválidos (não alterados):');
    for (const row of invalidRows) {
      console.log(`- [${row.schema}] contato=${row.contactId} campo=${row.field} valor="${row.value}" erro="${row.error}"`);
    }
  }
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
