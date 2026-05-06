import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { globalSearch } from './search.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt];

const searchQuerySchema = z.object({
  q: z.string().default(''),
  limit: z.coerce.number().int().positive().max(10).default(5),
});

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: 'Query inválida', details: parsed.error.flatten() } });
    }

    if (request.user.isSuperAdmin) {
      return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    }

    const schemaName = request.user.schemaName;
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    const data = await globalSearch(parsed.data.q, parsed.data.limit, schemaName);
    return reply.send({ success: true, data });
  });
}
