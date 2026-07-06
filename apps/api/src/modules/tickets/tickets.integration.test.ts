import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database.js';
import { createTestApp, createTestJWT } from '../../test/setup.js';
import { provisionTenantSchema } from '../super-admin/tenants/tenants.service.js';
import { ensureTicketInfrastructureForSchema } from './tickets.service.js';

interface TempTenant {
  id: string;
  schemaName: string;
}

const TEST_USER_ID = '00000000-0000-0000-0000-000000000002';
const TEST_USER_NAME = 'Tickets Integration User';
const TEST_EMAIL = 'tickets.integration@ziradesk.test';
const tempTenants: TempTenant[] = [];
let suiteTenant: TempTenant | null = null;

function requireSuiteTenant(): TempTenant {
  if (!suiteTenant) {
    throw new Error('Tenant dedicado da suite de tickets não inicializado');
  }

  return suiteTenant;
}

function authHeader(overrides: Parameters<typeof createTestJWT>[0] = {}): { Authorization: string } {
  const { id, schemaName } = requireSuiteTenant();

  return {
    Authorization: `Bearer ${createTestJWT({
      sub: TEST_USER_ID,
      email: TEST_EMAIL,
      name: TEST_USER_NAME,
      role: 'owner',
      tenantId: id,
      schemaName,
      ...overrides,
    })}`,
  };
}

function uniqueText(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function resetTenantTicketData(schemaName: string): Promise<void> {
  await ensureTicketInfrastructureForSchema(schemaName);

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "${schemaName}".ticket_attachments,
      "${schemaName}".ticket_comments,
      "${schemaName}".ticket_events,
      "${schemaName}".ticket_checklists,
      "${schemaName}".ticket_time_entries,
      "${schemaName}".ticket_types,
      "${schemaName}".tickets
    RESTART IDENTITY CASCADE
  `);

  await prisma.$executeRawUnsafe(`
    DELETE FROM "${schemaName}".audit_logs
    WHERE action LIKE 'ticket.%'
       OR entity IN ('ticket', 'ticket_comment')
  `);

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".users
       (id, name, email, password_hash, role, status, language, settings)
     VALUES ($1::uuid, $2, $3, $4, 'owner', 'active', 'pt-BR', '{}'::jsonb)
     ON CONFLICT (id)
     DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       role = 'owner',
       status = 'active',
       language = 'pt-BR',
       settings = '{}'::jsonb`,
    TEST_USER_ID,
    TEST_USER_NAME,
    TEST_EMAIL,
    'not_used_in_jwt_tests',
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".agent_assignments (user_id)
     VALUES ($1::uuid)
     ON CONFLICT (user_id) DO NOTHING`,
    TEST_USER_ID,
  );
}

async function createTicket(payload: Record<string, unknown> = {}) {
  const response = await createTestApp()
    .post('/api/tickets')
    .set(authHeader())
    .send({
      title: uniqueText('Ticket'),
      description: 'Ticket criado via teste de integração',
      assigned_to: TEST_USER_ID,
      ...payload,
    });

  expect(response.status).toBe(201);

  return response.body.data as {
    id: string;
    title: string;
    status: string;
    priority: string;
    assigned_to: string | null;
  };
}

async function createTempTenant(track = true): Promise<TempTenant> {
  const slug = uniqueText('tenant').toLowerCase();
  const schemaName = uniqueText('schema').toLowerCase().replace(/[^a-z0-9_]/g, '_');

  const plan = await prisma.plan.upsert({
    where: { slug: 'test-plan' },
    update: {
      name: 'Plano Teste',
      priceMonth: new Prisma.Decimal('0'),
      priceYear: new Prisma.Decimal('0'),
      maxUsers: 50,
      maxContacts: 500,
      isActive: true,
      features: { whatsapp: true, email: true, live_chat: true, reports: true, api_access: true, custom_domain: true, sla: true, webhooks: true },
    },
    create: {
      name: 'Plano Teste',
      slug: 'test-plan',
      priceMonth: new Prisma.Decimal('0'),
      priceYear: new Prisma.Decimal('0'),
      maxUsers: 50,
      maxContacts: 500,
      isActive: true,
      features: { whatsapp: true, email: true, live_chat: true, reports: true, api_access: true, custom_domain: true, sla: true, webhooks: true },
    },
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${slug}`,
      slug,
      schemaName,
      planId: plan.id,
      status: 'active',
      trialEndsAt: null,
      settings: {},
    },
    select: { id: true, schemaName: true },
  });

  await provisionTenantSchema(schemaName);
  if (track) {
    tempTenants.push(tenant);
  }

  return tenant;
}

describe('Tickets integration', () => {
  beforeAll(async () => {
    suiteTenant = await createTempTenant(false);
  });

  beforeEach(async () => {
    const { schemaName } = requireSuiteTenant();
    await resetTenantTicketData(schemaName);
  });

  afterEach(async () => {
    while (tempTenants.length > 0) {
      const tenant = tempTenants.pop()!;
      await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => undefined);
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`).catch(() => undefined);
    }
  });

  afterAll(async () => {
    if (!suiteTenant) {
      return;
    }

    await prisma.tenant.deleteMany({ where: { id: suiteTenant.id } }).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${suiteTenant.schemaName}" CASCADE`).catch(() => undefined);
    suiteTenant = null;
  });

  it('POST /api/tickets cria ticket com campos obrigatórios', async () => {
    const response = await createTestApp()
      .post('/api/tickets')
      .set(authHeader())
      .send({
        title: uniqueText('Novo ticket'),
        assigned_to: TEST_USER_ID,
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      title: expect.stringContaining('Novo ticket'),
      status: 'open',
      priority: 'medium',
      assigned_to: TEST_USER_ID,
    });
  });

  it('GET /api/tickets lista com paginação e filtros de status, prioridade e responsável', async () => {
    const firstMatch = await createTicket({
      title: uniqueText('Match 1'),
      status: 'in_progress',
      priority: 'high',
      assigned_to: TEST_USER_ID,
    });
    const secondMatch = await createTicket({
      title: uniqueText('Match 2'),
      status: 'in_progress',
      priority: 'high',
      assigned_to: TEST_USER_ID,
    });
    await createTicket({
      title: uniqueText('Nao match'),
      status: 'open',
      priority: 'low',
    });

    const page1 = await createTestApp()
      .get('/api/tickets')
      .query({
        status: 'in_progress',
        priority: 'high',
        assigned_to: TEST_USER_ID,
        per_page: 1,
        page: 1,
      })
      .set(authHeader());

    const page2 = await createTestApp()
      .get('/api/tickets')
      .query({
        status: 'in_progress',
        priority: 'high',
        assigned_to: TEST_USER_ID,
        per_page: 1,
        page: 2,
      })
      .set(authHeader());

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    expect(page1.body.meta).toMatchObject({ total: 2, page: 1, per_page: 1, total_pages: 2 });
    expect(page2.body.meta).toMatchObject({ total: 2, page: 2, per_page: 1, total_pages: 2 });

    const returnedIds = [page1.body.data[0]?.id, page2.body.data[0]?.id].sort();
    expect(returnedIds).toEqual([firstMatch.id, secondMatch.id].sort());
  });

  it('PATCH /api/tickets/:id atualiza status seguindo STATUS_TRANSITIONS', async () => {
    const ticket = await createTicket({ status: 'open' });

    const response = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader())
      .send({ status: 'in_progress' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('in_progress');
  });

  it('PATCH /api/tickets/:id com transição inválida retorna 422', async () => {
    const ticket = await createTicket({ status: 'open' });

    const toInProgress = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader())
      .send({ status: 'in_progress' });

    expect(toInProgress.status).toBe(200);

    const resolveResponse = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader())
      .send({ status: 'resolved' });

    expect(resolveResponse.status).toBe(200);

    const invalidResponse = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader())
      .send({ status: 'waiting', waiting_reason: 'customer' });

    expect(invalidResponse.status).toBe(422);
    expect(invalidResponse.body.error.message).toContain('Transição de status inválida');
  });

  it('Ticket urgent sem due_date retorna 422', async () => {
    const response = await createTestApp()
      .post('/api/tickets')
      .set(authHeader())
      .send({
        title: uniqueText('Urgente'),
        priority: 'urgent',
        assigned_to: TEST_USER_ID,
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toContain('Prazo é obrigatório');
  });

  it('Ticket waiting sem category retorna 422', async () => {
    const response = await createTestApp()
      .post('/api/tickets')
      .set(authHeader())
      .send({
        title: uniqueText('Waiting'),
        status: 'waiting',
        assigned_to: TEST_USER_ID,
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toContain('Categoria é obrigatória');
  });

  it('DELETE /api/tickets/:id remove ticket e anexos associados', async () => {
    const ticket = await createTicket();

    const upload = await createTestApp()
      .post(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader())
      .attach('file', Buffer.from('anexo para exclusao'), {
        filename: 'delete-me.txt',
        contentType: 'text/plain',
      });

    expect(upload.status).toBe(201);
    const attachmentId = upload.body.data.id as string;

    const beforeDeleteContent = await createTestApp()
      .get(`/api/tickets/attachments/${attachmentId}/content`)
      .set(authHeader());

    expect(beforeDeleteContent.status).toBe(200);
    expect(beforeDeleteContent.text).toBe('anexo para exclusao');

    const response = await createTestApp()
      .delete(`/api/tickets/${ticket.id}`)
      .set(authHeader());

    expect(response.status).toBe(200);

    const attachmentRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
       FROM "${requireSuiteTenant().schemaName}".ticket_attachments
       WHERE ticket_id = $1::uuid`,
      ticket.id,
    );

    const contentResponse = await createTestApp()
      .get(`/api/tickets/attachments/${attachmentId}/content`)
      .set(authHeader());

    expect(Number(attachmentRows[0]?.count ?? 0n)).toBe(0);
    expect(contentResponse.status).toBe(404);
  });

  it('GET /api/tickets/export retorna CSV com BOM UTF-8, cabeçalhos pt-BR e separador ponto-e-vírgula', async () => {
    await createTicket({
      title: 'Exportacao CSV',
      status: 'in_progress',
      priority: 'high',
      category: 'Financeiro',
      assigned_to: TEST_USER_ID,
      due_date: '2026-06-01T12:00:00.000Z',
    });

    const response = await createTestApp()
      .get('/api/tickets/export')
      .query({ format: 'csv' })
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text.charCodeAt(0)).toBe(0xfeff);

    const [headerLine, firstDataLine] = response.text.split('\n');
    expect(headerLine).toContain('"ID";"Título";"Status";"Prioridade";"Categoria"');
    expect(firstDataLine).toContain(';');
    expect(firstDataLine).toContain('"Exportacao CSV"');
  });

  it('POST /api/tickets/:id/attachments faz upload via StorageProvider e GET lista URL correta', async () => {
    const ticket = await createTicket();

    const upload = await createTestApp()
      .post(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader())
      .attach('file', Buffer.from('conteudo do anexo'), {
        filename: 'anexo.txt',
        contentType: 'text/plain',
      });

    expect(upload.status).toBe(201);
    expect(upload.body.data.filename).toBe('anexo.txt');

    const attachmentId = upload.body.data.id as string;

    const list = await createTestApp()
      .get(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader());

    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      id: attachmentId,
      file_url: `/api/tickets/attachments/${attachmentId}/content`,
    });

    const content = await createTestApp()
      .get(`/api/tickets/attachments/${attachmentId}/content`)
      .set(authHeader());

    expect(content.status).toBe(200);
    expect(content.text).toBe('conteudo do anexo');
  });

  it('GET /api/tickets/attachments/:id/content retorna 404 quando o objeto sumiu do storage', async () => {
    const ticket = await createTicket();

    const upload = await createTestApp()
      .post(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader())
      .attach('file', Buffer.from('conteudo perdido'), {
        filename: 'perdido.txt',
        contentType: 'text/plain',
      });

    expect(upload.status).toBe(201);
    const attachmentId = upload.body.data.id as string;
    await prisma.$executeRawUnsafe(
      `UPDATE "${requireSuiteTenant().schemaName}".ticket_attachments
       SET filename = 'objeto-ausente.txt'
       WHERE id = $1::uuid`,
      attachmentId,
    );

    const response = await createTestApp()
      .get(`/api/tickets/attachments/${attachmentId}/content`)
      .set(authHeader());

    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe('Arquivo do anexo não encontrado');
  });

  it('DELETE /api/tickets/attachments/:id remove do storage e do banco', async () => {
    const ticket = await createTicket();

    const upload = await createTestApp()
      .post(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader())
      .attach('file', Buffer.from('arquivo temporario'), {
        filename: 'temporario.txt',
        contentType: 'text/plain',
      });

    expect(upload.status).toBe(201);
    const attachmentId = upload.body.data.id as string;

    const response = await createTestApp()
      .delete(`/api/tickets/attachments/${attachmentId}`)
      .set(authHeader());

    expect(response.status).toBe(200);

    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
       FROM "${requireSuiteTenant().schemaName}".ticket_attachments
       WHERE id = $1::uuid`,
      attachmentId,
    );

    const content = await createTestApp()
      .get(`/api/tickets/attachments/${attachmentId}/content`)
      .set(authHeader());

    expect(Number(rows[0]?.count ?? 0n)).toBe(0);
    expect(content.status).toBe(404);
  });

  it('Upload acima de 10MB retorna 413', async () => {
    const ticket = await createTicket();

    const response = await createTestApp()
      .post(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader())
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1, 'a'), {
        filename: 'grande.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(413);
  });

  it('Ticket do tenant A não fica acessível com JWT do tenant B', async () => {
    const ticket = await createTicket();
    const tenantB = await createTempTenant();

    const response = await createTestApp()
      .get(`/api/tickets/${ticket.id}`)
      .set(authHeader({ tenantId: tenantB.id, schemaName: tenantB.schemaName }));

    expect(response.status).toBe(404);
  });

  it('GET /api/tickets/:id registra audit log de acesso PII no detalhe', async () => {
    const tenant = requireSuiteTenant();
    const ticket = await createTicket({ title: uniqueText('Ticket PII Audit') });

    const response = await createTestApp()
      .get(`/api/tickets/${ticket.id}`)
      .set(authHeader());

    expect(response.status).toBe(200);

    const logs = await prisma.$queryRawUnsafe<Array<{ action: string; entity_id: string }>>(
      `SELECT action, entity_id::text
       FROM "${tenant.schemaName}".audit_logs
       WHERE action = 'ticket.pii.accessed'
         AND entity_id = $1::uuid`,
      ticket.id,
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'ticket.pii.accessed',
      entity_id: ticket.id,
    });
  });
});
