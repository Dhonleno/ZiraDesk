import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../config/database.js';
import { createTestApp, createTestJWT } from '../../../test/setup.js';
import {
  SYSTEM_CLOSE_TYPE_ID,
  SYSTEM_OUTCOME_IDS,
} from '../../../database/seeds/closeConfig.seed.js';

const TEST_AUTH_SUB = '00000000-0000-0000-0000-000000000091';
const LABEL_PREFIX = 'reorder-it';

function requireSchema(): string {
  const s = globalThis.__ZIRADESK_TEST_TENANT_SCHEMA__;
  if (!s) throw new Error('Schema de teste não inicializado');
  return s;
}

function authHeader(): { Authorization: string } {
  return {
    Authorization: `Bearer ${createTestJWT({
      sub: TEST_AUTH_SUB,
      email: 'close-config.integration@ziradesk.test',
      name: 'Close Config Integration User',
      role: 'owner',
    })}`,
  };
}

/**
 * Cria pela própria API: o schema de reorder só aceita id em formato cuid (ou
 * prefixo `sys_`), e é o endpoint de criação que gera esse formato.
 */
async function createAdminRecord(
  kind: 'types' | 'outcomes',
  label: string,
  order: number,
): Promise<string> {
  const response = await createTestApp()
    .post(`/api/admin/close-config/${kind}`)
    .set(authHeader())
    .send({ label: `${label}-${Math.floor(Math.random() * 100000)}`, order });

  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`Falha ao criar ${kind}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data.id as string;
}

async function readOrder(
  table: 'conversation_close_types' | 'conversation_close_outcomes',
  ids: string[],
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM "${requireSchema()}".${table}
     WHERE id = ANY($1::text[])
     ORDER BY sort_order ASC`,
    ids,
  );
  return rows.map((row) => row.id);
}

let typeA: string;
let typeB: string;
let outcomeA: string;
let outcomeB: string;

beforeAll(async () => {
  typeA = await createAdminRecord('types', `${LABEL_PREFIX}-tipo-A`, 10);
  typeB = await createAdminRecord('types', `${LABEL_PREFIX}-tipo-B`, 11);
  outcomeA = await createAdminRecord('outcomes', `${LABEL_PREFIX}-desfecho-A`, 10);
  outcomeB = await createAdminRecord('outcomes', `${LABEL_PREFIX}-desfecho-B`, 11);
});

afterAll(async () => {
  const schema = requireSchema();
  await prisma.$executeRawUnsafe(
    `DELETE FROM "${schema}".conversation_close_types WHERE label LIKE $1`,
    `${LABEL_PREFIX}%`,
  ).catch(() => undefined);
  await prisma.$executeRawUnsafe(
    `DELETE FROM "${schema}".conversation_close_outcomes WHERE label LIKE $1`,
    `${LABEL_PREFIX}%`,
  ).catch(() => undefined);
});

describe('Close-config reorder — registros de sistema', () => {
  it('PATCH /types/reorder só com ids de admin aplica a nova ordem', async () => {
    const response = await createTestApp()
      .patch('/api/admin/close-config/types/reorder')
      .set(authHeader())
      .send({ ids: [typeB, typeA] });

    expect(response.status).toBe(200);
    expect(await readOrder('conversation_close_types', [typeA, typeB])).toEqual([typeB, typeA]);
  });

  it('PATCH /types/reorder com um id de sistema no lote retorna 409', async () => {
    const before = await readOrder('conversation_close_types', [typeA, typeB]);

    const response = await createTestApp()
      .patch('/api/admin/close-config/types/reorder')
      .set(authHeader())
      .send({ ids: [SYSTEM_CLOSE_TYPE_ID, typeA, typeB] });

    expect(response.status).toBe(409);
    // O lote é rejeitado inteiro: a ordem dos registros de admin não muda.
    expect(await readOrder('conversation_close_types', [typeA, typeB])).toEqual(before);
  });

  it('PATCH /outcomes/reorder só com ids de admin aplica a nova ordem', async () => {
    const response = await createTestApp()
      .patch('/api/admin/close-config/outcomes/reorder')
      .set(authHeader())
      .send({ ids: [outcomeB, outcomeA] });

    expect(response.status).toBe(200);
    expect(await readOrder('conversation_close_outcomes', [outcomeA, outcomeB])).toEqual([outcomeB, outcomeA]);
  });

  it('PATCH /outcomes/reorder com um id de sistema no lote retorna 409', async () => {
    const before = await readOrder('conversation_close_outcomes', [outcomeA, outcomeB]);

    const response = await createTestApp()
      .patch('/api/admin/close-config/outcomes/reorder')
      .set(authHeader())
      .send({ ids: [SYSTEM_OUTCOME_IDS.NO_REPLY, outcomeA, outcomeB] });

    expect(response.status).toBe(409);
    expect(await readOrder('conversation_close_outcomes', [outcomeA, outcomeB])).toEqual(before);
  });

  it('GET /types e /outcomes expõem isSystem para o admin distinguir os registros', async () => {
    const [types, outcomes] = await Promise.all([
      createTestApp().get('/api/admin/close-config/types').set(authHeader()),
      createTestApp().get('/api/admin/close-config/outcomes').set(authHeader()),
    ]);

    expect(types.status).toBe(200);
    expect(outcomes.status).toBe(200);

    // O frontend depende deste campo para filtrar o payload de reorder.
    const systemType = types.body.data.find((item: { id: string }) => item.id === SYSTEM_CLOSE_TYPE_ID);
    expect(systemType?.isSystem).toBe(true);
    expect(types.body.data.find((item: { id: string }) => item.id === typeA)?.isSystem).toBe(false);

    const systemOutcome = outcomes.body.data.find(
      (item: { id: string }) => item.id === SYSTEM_OUTCOME_IDS.NO_REPLY,
    );
    expect(systemOutcome?.isSystem).toBe(true);
  });
});
