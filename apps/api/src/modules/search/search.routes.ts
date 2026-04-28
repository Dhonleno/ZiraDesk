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

    const data = await globalSearch(parsed.data.q, parsed.data.limit);
    return reply.send({ success: true, data });
  });
}
