import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database.js';
import { createTestApp, createTestJWT } from '../../test/setup.js';
import { ensureCallRecordsInfrastructure } from './calls.service.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_AUTH_SUB = '00000000-0000-0000-0000-000000000071';

function requireSchema(): string {
  const s = globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__;
  if (!s) throw new Error('Schema de teste não inicializado');
  return s;
}

function authHeader(): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: TEST_AUTH_SUB,
      email: 'calls.integration@ziradesk.test',
      name: 'Calls Integration User',
      role: 'owner',
    })}`,
  };
}

describe('Calls integration', () => {
  it('GET /api/calls/token retorna token Twilio para agente autenticado', async () => {
    const response = await createTestApp()
      .get('/api/calls/token')
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.token).toEqual(expect.any(String));
  });

  describe('GET /api/calls/conversation/:id', () => {
    let conversationId: string;
    const callSid = `CA_INTTEST_${Date.now()}`;

    beforeAll(async () => {
      const schema = requireSchema();

      const [contact] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "${schema}".contacts (name) VALUES ('Calls Conv Contact') RETURNING id`,
      );

      const [conversation] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "${schema}".conversations (contact_id, channel_type)
         VALUES ($1::uuid, 'voice') RETURNING id`,
        contact!.id,
      );
      conversationId = conversation!.id;

      // Garante que a tabela call_records existe (criada lazily pelo serviço)
      await ensureCallRecordsInfrastructure(prisma, schema);

      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schema}".call_records
           (call_sid, to_phone, from_phone, status, conversation_id, agent_id)
         VALUES ($1, '+5511999999999', '+15550000000', 'completed', $2::uuid, $3::uuid)`,
        callSid,
        conversationId,
        TEST_USER_ID,
      );
    });

    afterAll(async () => {
      const schema = requireSchema();
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${schema}".call_records WHERE call_sid = $1`,
        callSid,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${schema}".conversations WHERE id = $1::uuid`,
        conversationId,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${schema}".contacts WHERE name = 'Calls Conv Contact'`,
      );
    });

    it('retorna lista de registros de chamada para a conversa', async () => {
      const response = await createTestApp()
        .get(`/api/calls/conversation/${conversationId}`)
        .set(authHeader());

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ call_sid: callSid, status: 'completed' }),
        ]),
      );
    });
  });
});
