import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { getSocketServer } from '../../socket/index.js';
import { startPauseSchema } from './pause.schema.js';
import {
  ConflictError,
  NotFoundError,
  endPause,
  getPauseStatus,
  startPause,
} from './pause.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt];

export async function omnichannelPauseRoutes(app: FastifyInstance): Promise<void> {
  app.post('/pause', { preHandler: guard }, async (request, reply) => {
    const parsed = startPauseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados invalidos', details: parsed.error.flatten() },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const io = getSocketServer();
      const data = await startPause(
        request.user.tenantId!,
        request.user.id,
        parsed.data,
        io,
        schemaName,
      );
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.delete('/pause', { preHandler: guard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const io = getSocketServer();
      const data = await endPause(request.user.tenantId!, request.user.id, io, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof ConflictError) {
        return reply.code(409).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  app.get('/pause/status', { preHandler: guard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await getPauseStatus(request.user.tenantId!, request.user.id, schemaName);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });
}

