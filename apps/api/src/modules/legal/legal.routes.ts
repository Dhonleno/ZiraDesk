import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { LGPD_EXPORT_SCHEMA } from '../../lib/lgpd/validate-export.js';

export async function legalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dpo', async (_request, reply) => reply.send({
    name: env.DPO_NAME ?? null,
    email: env.DPO_EMAIL ?? null,
    phone: env.DPO_PHONE ?? null,
    privacyPolicyUrl: env.PRIVACY_POLICY_URL ?? null,
    termsUrl: env.TERMS_OF_SERVICE_URL ?? null,
    companyLegalName: env.COMPANY_LEGAL_NAME ?? null,
    companyCnpj: env.COMPANY_CNPJ ?? null,
  }));

  app.get('/lgpd-export-schema', async (_request, reply) => {
    reply.header('Content-Type', 'application/schema+json');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(LGPD_EXPORT_SCHEMA);
  });
}
