import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.js';
import { hasRole } from '../../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../../middleware/tenantSchemaFromJwt.js';
import { updateVoiceConfigSchema } from './voice-config.schema.js';
import {
  DuplicateTwilioPhoneNumberError,
  InvalidBotMenuError,
  getVoiceConfig,
  upsertVoiceConfig,
} from './voice-config.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt, hasRole('owner', 'admin')];

export async function voiceConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: guard }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    if (!tenantId) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Tenant não resolvido' },
      });
    }

    const data = await getVoiceConfig(tenantId);
    return reply.send({ success: true, data });
  });

  app.patch('/', { preHandler: guard }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    if (!tenantId) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Tenant não resolvido' },
      });
    }

    const parsed = updateVoiceConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const data = await upsertVoiceConfig(tenantId, parsed.data);
      return reply.send({ success: true, data });
    } catch (error) {
      if (error instanceof DuplicateTwilioPhoneNumberError) {
        return reply.code(409).send({
          success: false,
          error: { code: 'DUPLICATE_TWILIO_PHONE_NUMBER', message: error.message },
        });
      }
      if (error instanceof InvalidBotMenuError) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_BOT_MENU', message: error.message },
        });
      }
      throw error;
    }
  });
}
