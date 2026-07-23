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
    ticket_number: number;
    title: string;
    status: string;
    priority: string;
    assigned_to: string | null;
  };
}

async function createOrganizationAndContact() {
  const { schemaName } = requireSuiteTenant();
  const organizationRows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `INSERT INTO "${schemaName}".organizations (name, email)
     VALUES ($1, $2)
     RETURNING id, name`,
    uniqueText('Org Busca'),
    'org.busca@ziradesk.test',
  );
  const organization = organizationRows[0];
  if (!organization) throw new Error('Falha ao criar organização de teste');

  const contactRows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; email: string }>>(
    `INSERT INTO "${schemaName}".contacts (organization_id, name, email)
     VALUES ($1::uuid, $2, $3)
     RETURNING id, name, email`,
    organization.id,
    uniqueText('Contato Busca'),
    `contato.busca.${Date.now()}@ziradesk.test`,
  );
  const contact = contactRows[0];
  if (!contact) throw new Error('Falha ao criar contato de teste');

  return { organization, contact };
}

async function setTicketAutoAssign(enabled: boolean): Promise<void> {
  const { id } = requireSuiteTenant();
  await prisma.tenant.update({
    where: { id },
    data: { settings: { ticket_auto_assign: enabled } },
  });
}

async function setSlaSettings(settings: Record<string, string | number | boolean>): Promise<void> {
  const { id } = requireSuiteTenant();
  await prisma.tenant.update({
    where: { id },
    data: { settings },
  });
}

async function createDepartmentWithAgent(presence: {
  status: 'online' | 'offline';
  isAvailable: boolean;
}): Promise<{ departmentId: string; agentId: string }> {
  const { schemaName } = requireSuiteTenant();

  const departmentRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".departments (name)
     VALUES ($1)
     RETURNING id`,
    uniqueText('Depto Presenca'),
  );
  const departmentId = departmentRows[0]?.id;
  if (!departmentId) throw new Error('Falha ao criar departamento de teste');

  const agentRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".users (name, email, password_hash, role, status, language, settings)
     VALUES ($1, $2, 'not_used_in_jwt_tests', 'agent', 'active', 'pt-BR', '{}'::jsonb)
     RETURNING id`,
    uniqueText('Agente Presenca'),
    `agente.presenca.${Date.now()}.${Math.floor(Math.random() * 1_000_000)}@ziradesk.test`,
  );
  const agentId = agentRows[0]?.id;
  if (!agentId) throw new Error('Falha ao criar agente de teste');

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".agent_departments (user_id, department_id)
     VALUES ($1::uuid, $2::uuid)`,
    agentId,
    departmentId,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${schemaName}".agent_assignments (user_id, status, is_available, last_seen_at)
     VALUES ($1::uuid, $2, $3::boolean, NOW())`,
    agentId,
    presence.status,
    presence.isAvailable,
  );

  return { departmentId, agentId };
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

  it('GET /api/tickets filtra tickets vencidos por overdue=true', async () => {
    const overdueTicket = await createTicket({
      title: uniqueText('Ticket vencido'),
      status: 'open',
      priority: 'medium',
      due_date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    await createTicket({
      title: uniqueText('Ticket no prazo'),
      status: 'open',
      priority: 'medium',
      due_date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await createTicket({
      title: uniqueText('Ticket sem vencimento'),
      status: 'open',
      priority: 'medium',
    });

    const response = await createTestApp()
      .get('/api/tickets')
      .query({ overdue: 'true', assigned_to: TEST_USER_ID })
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data.map((ticket: { id: string }) => ticket.id)).toEqual([overdueTicket.id]);
  });

  it('GET /api/tickets busca por número, contato, organização e inclui resolvidos', async () => {
    const { organization, contact } = await createOrganizationAndContact();
    const ticket = await createTicket({
      title: uniqueText('Ticket resolvido buscavel'),
      status: 'in_progress',
      priority: 'medium',
      contact_id: contact.id,
      organization_id: organization.id,
    });
    await createTicket({ title: uniqueText('Nao deve aparecer'), status: 'open' });

    const resolveResponse = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader())
      .send({ status: 'resolved' });

    expect(resolveResponse.status).toBe(200);

    const searchByNumber = await createTestApp()
      .get('/api/tickets')
      .query({ search: `#${String(ticket.ticket_number).padStart(5, '0')}` })
      .set(authHeader());
    const searchByContact = await createTestApp()
      .get('/api/tickets')
      .query({ search: contact.email })
      .set(authHeader());
    const searchByOrganization = await createTestApp()
      .get('/api/tickets')
      .query({ search: organization.name })
      .set(authHeader());

    for (const response of [searchByNumber, searchByContact, searchByOrganization]) {
      expect(response.status).toBe(200);
      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0]).toMatchObject({
        id: ticket.id,
        status: 'resolved',
      });
    }
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

  it('GET /api/tickets/:id/attachments remove anexos órfãos do storage da listagem', async () => {
    const ticket = await createTicket();

    const upload = await createTestApp()
      .post(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader())
      .attach('file', Buffer.from('conteudo perdido'), {
        filename: 'preview-perdido.txt',
        contentType: 'text/plain',
      });

    expect(upload.status).toBe(201);
    const attachmentId = upload.body.data.id as string;

    await prisma.$executeRawUnsafe(
      `UPDATE "${requireSuiteTenant().schemaName}".ticket_attachments
       SET filename = 'preview-ausente.txt'
       WHERE id = $1::uuid`,
      attachmentId,
    );

    const response = await createTestApp()
      .get(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);

    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
       FROM "${requireSuiteTenant().schemaName}".ticket_attachments
       WHERE id = $1::uuid`,
      attachmentId,
    );
    expect(Number(rows[0]?.count ?? 0n)).toBe(0);
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

  it('POST /api/tickets com department_id e auto-assign ligado mantém queued quando agente do departamento está offline', async () => {
    await setTicketAutoAssign(true);
    const { departmentId } = await createDepartmentWithAgent({ status: 'offline', isAvailable: false });

    const response = await createTestApp()
      .post('/api/tickets')
      .set(authHeader())
      .send({
        title: uniqueText('Ticket sem agente online'),
        department_id: departmentId,
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      status: 'queued',
      assigned_to: null,
    });
  });

  it('POST /api/tickets com department_id e auto-assign ligado atribui agente online e disponível do departamento', async () => {
    await setTicketAutoAssign(true);
    const { departmentId, agentId } = await createDepartmentWithAgent({ status: 'online', isAvailable: true });

    const response = await createTestApp()
      .post('/api/tickets')
      .set(authHeader())
      .send({
        title: uniqueText('Ticket auto-atribuido por presenca'),
        department_id: departmentId,
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      status: 'open',
      assigned_to: agentId,
    });
  });

  it('POST /api/tickets/:id/accept — agente designado aceita ticket open, status vira in_progress', async () => {
    const ticket = await createTicket({ status: 'open', assigned_to: TEST_USER_ID });

    const response = await createTestApp()
      .post(`/api/tickets/${ticket.id}/accept`)
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('in_progress');
  });

  it('POST /api/tickets/:id/accept — agente designado aceita ticket queued, status vira in_progress', async () => {
    const ticket = await createTicket({ status: 'queued', assigned_to: TEST_USER_ID });

    const response = await createTestApp()
      .post(`/api/tickets/${ticket.id}/accept`)
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('in_progress');
  });

  it('POST /api/tickets/:id/accept — agente não designado recebe 403', async () => {
    const ticket = await createTicket({ status: 'open', assigned_to: TEST_USER_ID });
    const otherUserId = '00000000-0000-0000-0000-000000000099';

    const response = await createTestApp()
      .post(`/api/tickets/${ticket.id}/accept`)
      .set(authHeader({ sub: otherUserId }));

    expect(response.status).toBe(403);
  });

  it('POST /api/tickets/:id/accept — ticket já in_progress recebe 409', async () => {
    const ticket = await createTicket({ status: 'in_progress', assigned_to: TEST_USER_ID });

    const response = await createTestApp()
      .post(`/api/tickets/${ticket.id}/accept`)
      .set(authHeader());

    expect(response.status).toBe(409);
  });

  it('POST /api/tickets/:id/accept — SLA automático preenche due_date pela prioridade', async () => {
    await setSlaSettings({ sla_auto_enabled: true, sla_hours_high: 5 });
    try {
      const ticket = await createTicket({ status: 'open', priority: 'high', assigned_to: TEST_USER_ID });
      const before = Date.now();

      const response = await createTestApp()
        .post(`/api/tickets/${ticket.id}/accept`)
        .set(authHeader());

      expect(response.status).toBe(200);
      expect(response.body.data.due_date).toBeTruthy();
      const diffHours = (new Date(response.body.data.due_date).getTime() - before) / 3_600_000;
      expect(diffHours).toBeGreaterThan(4.9);
      expect(diffHours).toBeLessThan(5.2);
    } finally {
      await setSlaSettings({});
    }
  });

  it('POST /api/tickets/:id/accept — SLA automático não sobrescreve due_date manual', async () => {
    await setSlaSettings({ sla_auto_enabled: true, sla_hours_high: 5 });
    try {
      const manualDue = new Date(Date.now() + 100 * 3_600_000).toISOString();
      const ticket = await createTicket({
        status: 'open',
        priority: 'high',
        assigned_to: TEST_USER_ID,
        due_date: manualDue,
      });

      const response = await createTestApp()
        .post(`/api/tickets/${ticket.id}/accept`)
        .set(authHeader());

      expect(response.status).toBe(200);
      // Prazo manual (~100h) preservado, não recalculado para ~5h.
      const diffHours = (new Date(response.body.data.due_date).getTime() - Date.now()) / 3_600_000;
      expect(diffHours).toBeGreaterThan(90);
    } finally {
      await setSlaSettings({});
    }
  });

  it('POST /api/tickets salva custom_fields e GET retorna', async () => {
    const created = await createTestApp()
      .post('/api/tickets')
      .set(authHeader())
      .send({
        title: uniqueText('Ticket CF'),
        assigned_to: TEST_USER_ID,
        custom_fields: { tier: 'gold' },
      });

    expect(created.status).toBe(201);

    const response = await createTestApp()
      .get(`/api/tickets/${created.body.data.id}`)
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.data.custom_fields).toEqual({ tier: 'gold' });
  });

  it('PATCH /api/tickets/:id atualiza custom_fields', async () => {
    const ticket = await createTicket({ custom_fields: { tier: 'gold' } });

    const response = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader())
      .send({ custom_fields: { tier: 'silver' } });

    expect(response.status).toBe(200);
    expect(response.body.data.custom_fields).toEqual({ tier: 'silver' });
  });

  it('PATCH /api/tickets/:id sem custom_fields preserva o valor existente', async () => {
    const ticket = await createTicket({ custom_fields: { tier: 'gold' } });

    const response = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader())
      .send({ priority: 'high' });

    expect(response.status).toBe(200);
    expect(response.body.data.custom_fields).toEqual({ tier: 'gold' });
  });

  it('PATCH /api/tickets/:id — agente designado fecha ticket resolved → 200', async () => {
    const ticket = await createTicket({ status: 'in_progress', assigned_to: TEST_USER_ID });

    await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader({ role: 'agent' }))
      .send({ status: 'resolved' });

    const response = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader({ role: 'agent' }))
      .send({ status: 'closed' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('closed');
  });

  it('PATCH /api/tickets/:id — agente não designado recebe 403', async () => {
    const ticket = await createTicket({ status: 'in_progress', assigned_to: TEST_USER_ID });
    const otherUserId = '00000000-0000-0000-0000-000000000099';

    const response = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader({ role: 'agent', sub: otherUserId }))
      .send({ title: uniqueText('Titulo Atualizado') });

    expect(response.status).toBe(403);
  });

  it('PATCH /api/tickets/:id — agente designado mas ticket não aceito (status open) recebe 403', async () => {
    const ticket = await createTicket({ status: 'open', assigned_to: TEST_USER_ID });

    const response = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader({ role: 'agent' }))
      .send({ title: uniqueText('Titulo Atualizado') });

    expect(response.status).toBe(403);
  });

  it('PATCH /api/tickets/:id — agente designado com ticket in_progress pode editar', async () => {
    const ticket = await createTicket({ status: 'in_progress', assigned_to: TEST_USER_ID });

    const response = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader({ role: 'agent' }))
      .send({ title: uniqueText('Titulo Atualizado') });

    expect(response.status).toBe(200);
  });

  it('PATCH /api/tickets/:id — admin pode editar mesmo sem ser o designado (status open)', async () => {
    const ticket = await createTicket({ status: 'open', assigned_to: TEST_USER_ID });

    const response = await createTestApp()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authHeader({ role: 'admin' }))
      .send({ title: uniqueText('Titulo Atualizado') });

    expect(response.status).toBe(200);
  });

  it('POST /api/tickets/:id/comments — agente não designado recebe 403', async () => {
    const ticket = await createTicket({ status: 'in_progress', assigned_to: TEST_USER_ID });
    const otherUserId = '00000000-0000-0000-0000-000000000099';

    const response = await createTestApp()
      .post(`/api/tickets/${ticket.id}/comments`)
      .set(authHeader({ role: 'agent', sub: otherUserId }))
      .send({ content: 'Comentário de teste', is_internal: false });

    expect(response.status).toBe(403);
  });

  it('POST /api/tickets/:id/comments — agente designado mas ticket não aceito (status open) recebe 403', async () => {
    const ticket = await createTicket({ status: 'open', assigned_to: TEST_USER_ID });

    const response = await createTestApp()
      .post(`/api/tickets/${ticket.id}/comments`)
      .set(authHeader({ role: 'agent' }))
      .send({ content: 'Comentário de teste', is_internal: false });

    expect(response.status).toBe(403);
  });

  it('POST /api/tickets/:id/comments — admin pode comentar mesmo sem ser o designado (status open)', async () => {
    const ticket = await createTicket({ status: 'open', assigned_to: TEST_USER_ID });

    const response = await createTestApp()
      .post(`/api/tickets/${ticket.id}/comments`)
      .set(authHeader({ role: 'admin' }))
      .send({ content: 'Comentário de teste', is_internal: false });

    expect(response.status).toBe(201);
  });
});
