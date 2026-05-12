import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { listTransferAgents, listTransferSkills } from './conversations/conversations.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const guard = [authMiddleware, tenantSchemaFromJwt];

export async function omnichannelTransferRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/omnichannel/transfer/agents?current_agent_id=<uuid>
  app.get('/agents', { preHandler: guard }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const raw = query['current_agent_id'];
    const currentAgentId = raw && UUID_RE.test(raw) ? raw : undefined;
    const agents = await listTransferAgents(currentAgentId);
    return reply.send({ success: true, data: agents });
  });

  // GET /api/omnichannel/transfer/skills
  app.get('/skills', { preHandler: guard }, async (_request, reply) => {
    const skills = await listTransferSkills();
    return reply.send({ success: true, data: skills });
  });
}
