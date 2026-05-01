import { PrismaClient } from '@prisma/client';
import { encryptCredentials } from '../utils/crypto.js';

const prisma = new PrismaClient();

interface ChannelRow {
  id: string;
  credentials: string | Record<string, unknown>;
}

function toPlainCredentials(
  credentials: ChannelRow['credentials'],
): Record<string, unknown> | null {
  if (typeof credentials === 'object' && credentials !== null && !Array.isArray(credentials)) {
    return credentials;
  }

  if (typeof credentials !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(credentials);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

async function main() {
  await prisma.$executeRaw`SET search_path TO "tenant_demo", public`;

  const channels = await prisma.$queryRaw<ChannelRow[]>`
    SELECT id, credentials FROM channels WHERE type = 'whatsapp'
  `;

  for (const channel of channels) {
    const creds = toPlainCredentials(channel.credentials);
    if (!creds) {
      console.log(`Channel ${channel.id} credentials already encrypted or invalid; skipped`);
      continue;
    }

    const encrypted = encryptCredentials(creds);
    const encryptedJson = JSON.stringify(encrypted);

    await prisma.$executeRaw`
      UPDATE channels SET credentials = ${encryptedJson}::jsonb WHERE id = ${channel.id}::uuid
    `;
    console.log(`Channel ${channel.id} credentials encrypted`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
