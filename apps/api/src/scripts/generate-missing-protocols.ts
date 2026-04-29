import { PrismaClient } from '@prisma/client';
import {
  ensureConversationProtocolInfrastructure,
  generateConversationProtocol,
  quoteIdent,
} from '../modules/omnichannel/conversations/protocols.js';

const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ['active', 'trial'] } },
    select: { id: true, slug: true, schemaName: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const tenant of tenants) {
    await ensureConversationProtocolInfrastructure(prisma, tenant.schemaName);

    const conversations = await prisma.$queryRawUnsafe<Array<{ id: string; created_at: Date }>>(
      `SELECT id, created_at
         FROM ${quoteIdent(tenant.schemaName)}.conversations
        WHERE protocol_number IS NULL
        ORDER BY created_at ASC`,
    );

    console.log(`[${tenant.slug}] ${conversations.length} conversas sem protocolo`);

    for (const conversation of conversations) {
      const protocolNumber = await generateConversationProtocol(prisma, tenant.schemaName);
      await prisma.$executeRawUnsafe(
        `UPDATE ${quoteIdent(tenant.schemaName)}.conversations
            SET protocol_number = $1
          WHERE id = $2::uuid`,
        protocolNumber,
        conversation.id,
      );
    }

    console.log(`[${tenant.slug}] Protocolos gerados OK`);
  }
}

main()
  .catch((error) => {
    console.error('Falha ao gerar protocolos:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
