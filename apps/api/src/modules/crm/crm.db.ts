import { prisma } from '../../config/database.js';

export type RawExecutor = typeof prisma;

function ensureSafeSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/i.test(schemaName)) {
    throw new Error('Schema do tenant inválido');
  }

  return schemaName.replace(/"/g, '""');
}

export async function withTenantSchema<T>(
  schemaName: string,
  runner: (db: RawExecutor) => Promise<T>,
): Promise<T> {
  const safeSchemaName = ensureSafeSchemaName(schemaName);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchemaName}", public`);
    return runner(tx as RawExecutor);
  });
}

export async function withOptionalSchema<T>(
  schemaName: string | undefined,
  runner: (db: RawExecutor) => Promise<T>,
): Promise<T> {
  if (schemaName) {
    return withTenantSchema(schemaName, runner);
  }

  return runner(prisma);
}