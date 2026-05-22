import type { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { getSocketServer } from '../../socket/index.js';
import { availabilityBodySchema } from './conversations/conversations.schema.js';
import {
  toggleAgentAvailability,
  NotFoundError,
} from '../admin/auto-assign/auto-assign.service.js';
import { autoAssignNextQueuedConversation } from './conversations/auto-assign.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt];

async function resolveSchemaName(tenantId: string, schemaName?: string): Promise<string> {
  if (schemaName) return schemaName;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });

  if (!tenant) throw new NotFoundError('Tenant nao encontrado');
  return tenant.schemaName;
}

export async function omnichannelAvailabilityRoutes(app: FastifyInstance): Promise<void> {
  app.put('/availability', { preHandler: guard }, async (request, reply) => {
    const parsed = availabilityBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const availability = await toggleAgentAvailability(
        request.user.tenantId!,
        request.user.id,
        parsed.data,
        schemaName,
        false,
      );

      const canReceiveConversations =
        request.user.role === 'owner' ||
        request.user.role === 'admin' ||
        request.user.role === 'agent';

      if (parsed.data.is_available && canReceiveConversations) {
        const resolvedSchemaName = await resolveSchemaName(request.user.tenantId!, schemaName);
        const io = getSocketServer();
        let assigned = 0;
        while (assigned < 5) {
          const result = await autoAssignNextQueuedConversation(
            request.user.tenantId!,
            resolvedSchemaName,
            prisma,
            io,
            request.user.id,
          );
          if (!result) break;
          assigned++;
        }
      }

      return reply.send({ success: true, data: availability });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}
