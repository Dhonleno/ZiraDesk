import type { GlobalSetupContext } from 'vitest/node';
import { bootstrapIntegrationSuite, shutdownIntegrationSuite } from './setup.js';

export default async function integrationGlobalSetup({ provide }: GlobalSetupContext) {
  const { baseUrl, tenant } = await bootstrapIntegrationSuite();

  provide('testBaseUrl', baseUrl);
  provide('testTenantId', tenant.id);
  provide('testTenantSlug', tenant.slug);
  provide('testTenantSchema', tenant.schemaName);

  return async () => {
    await shutdownIntegrationSuite();
  };
}
