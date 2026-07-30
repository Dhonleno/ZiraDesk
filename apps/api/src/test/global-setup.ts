import type { GlobalSetupContext } from 'vitest/node';
import { sweepTestGhosts } from '../scripts/cleanup-test-tenants.js';
import { bootstrapIntegrationSuite, shutdownIntegrationSuite } from './setup.js';

export default async function integrationGlobalSetup({ provide }: GlobalSetupContext) {
  // Varre fantasmas de runs anteriores interrompidos (SIGINT/kill), que o
  // teardown não alcança. Corte de idade protege o tenant de um run paralelo.
  await sweepTestGhosts({ minAgeHours: 2 });

  const { baseUrl, tenant } = await bootstrapIntegrationSuite();

  provide('testBaseUrl', baseUrl);
  provide('testTenantId', tenant.id);
  provide('testTenantSlug', tenant.slug);
  provide('testTenantSchema', tenant.schemaName);

  return async () => {
    await shutdownIntegrationSuite();
  };
}
