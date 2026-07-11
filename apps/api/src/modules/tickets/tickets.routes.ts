import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { hasPermission } from '@ziradesk/shared';
import { prisma } from '../../config/database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { maskEmail, maskPhone, maskDocument, maskName } from '../../utils/pii-mask.js';
import {
  createTicketSchema,
  updateTicketSchema,
  listTicketsQuerySchema,
  exportTicketsQuerySchema,
  createCommentSchema,
  updateCommentSchema,
  assignTicketSchema,
  createChecklistItemSchema,
  updateChecklistItemSchema,
  createTimeEntrySchema,
} from './tickets.schema.js';
import {
  listTickets,
  exportTickets,
  getTicket,
  createTicket,
  updateTicket,
  deleteTicket,
  assignTicket,
  claimTicketFromQueue,
  listComments,
  addComment,
  updateComment,
  deleteComment,
  listAttachments,
  addAttachment,
  deleteAttachment,
  readAttachmentContent,
  listChecklistItems,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  listTimeEntries,
  addTimeEntry,
  deleteTimeEntry,
  getTicketTimeline,
  getStats,
  NotFoundError,
  ForbiddenError,
  BusinessRuleError,
  PayloadTooLargeError,
  ConflictError,
} from './tickets.service.js';

const guard = [authMiddleware, tenantSchemaFromJwt];
const ticketsViewGuard = [...guard, requirePermission('tickets:view')];
const ticketsEditGuard = [...guard, requirePermission('tickets:edit')];
const ticketsDeleteGuard = [...guard, requirePermission('tickets:delete')];
const RELATION_TYPES = new Set(['relates_to', 'duplicates', 'blocks', 'is_blocked_by']);

function canViewFullPii(role: string): boolean {
  return hasPermission(role as Parameters<typeof hasPermission>[0], 'pii:view-full');
}

function maskTicketContactPii<T extends { contact_name?: string | null; contact_email?: string | null; contact_phone?: string | null; contact_document?: string | null }>(ticket: T): T {
  return {
    ...ticket,
    contact_name:     maskName(ticket.contact_name ?? null),
    contact_email:    maskEmail(ticket.contact_email ?? null),
    contact_phone:    maskPhone(ticket.contact_phone ?? null),
    contact_document: maskDocument(ticket.contact_document ?? null),
  };
}

function ensureSafeSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/i.test(schemaName)) {
    throw new Error('Schema do tenant inválido');
  }
  return schemaName.replace(/"/g, '""');
}

async function insertTicketPiiAuditLog(schemaName: string, userId: string, ticketId: string): Promise<void> {
  const safeSchemaName = ensureSafeSchemaName(schemaName);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${safeSchemaName}".audit_logs (user_id, action, entity, entity_id, new_data)
     VALUES ($1::uuid, 'ticket.pii.accessed', 'ticket', $2::uuid, $3::jsonb)`,
    userId,
    ticketId,
    JSON.stringify({
      user_id: userId,
      ticket_id: ticketId,
      timestamp: new Date().toISOString(),
    }),
  );
}

function isMultipartTooLargeError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE';
}

async function ensureTicketRelationsInfrastructure(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ticket_relations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      related_id    UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      relation_type VARCHAR(30) NOT NULL,
      created_by    UUID REFERENCES users(id),
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ticket_id, related_id),
      CHECK(ticket_id <> related_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ticket_relations_ticket
    ON ticket_relations(ticket_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ticket_relations_related
    ON ticket_relations(related_id)
  `);
}

export async function ticketsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
    },
  });

  // GET /api/tickets
  app.get('/', { preHandler: ticketsViewGuard }, async (request, reply) => {
    const parsed = listTicketsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }
    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const result = await listTickets(parsed.data, schemaName);
    const includeFullPii = canViewFullPii(request.user.role);
    return reply.send({
      success: true,
      ...result,
      data: includeFullPii ? result.data : result.data.map(maskTicketContactPii),
    });
  });

  // GET /api/tickets/stats  — must be before /:id to avoid conflict
  app.get('/stats', { preHandler: ticketsViewGuard }, async (_request, reply) => {
    const stats = await getStats();
    return reply.send({ success: true, data: stats });
  });

  // GET /api/tickets/export?format=csv
  app.get('/export', { preHandler: ticketsViewGuard }, async (request, reply) => {
    const parsed = exportTicketsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Query inválida', details: parsed.error.flatten() },
      });
    }

    if (parsed.data.format !== 'csv') {
      return reply.code(400).send({
        success: false,
        error: { message: 'Formato de exportação inválido' },
      });
    }

    const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
    const tickets = await exportTickets(parsed.data, schemaName);

    const headers = [
      'ID',
      'Título',
      'Status',
      'Prioridade',
      'Categoria',
      'Tipo',
      'Responsável',
      'Contato',
      'Organização',
      'Prazo',
      'Criado em',
      'Atualizado em',
      'Resolvido em',
    ];

    const statusLabels: Record<string, string> = {
      open: 'Aberto',
      in_progress: 'Em andamento',
      waiting: 'Aguardando',
      resolved: 'Resolvido',
      closed: 'Fechado',
    };

    const priorityLabels: Record<string, string> = {
      low: 'Baixa',
      medium: 'Média',
      high: 'Alta',
      urgent: 'Urgente',
    };

    const formatDate = (value: Date | null): string => (
      value
        ? value.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : ''
    );

    const escapeCsvField = (value: string | null | undefined): string => (
      `"${String(value ?? '').replace(/"/g, '""')}"`
    );

    const rows = tickets.map((ticket) => [
      escapeCsvField(ticket.id.slice(0, 8).toUpperCase()),
      escapeCsvField(ticket.title),
      escapeCsvField(statusLabels[ticket.status] ?? ticket.status),
      escapeCsvField(priorityLabels[ticket.priority] ?? ticket.priority),
      escapeCsvField(ticket.category),
      escapeCsvField(ticket.ticket_type_name),
      escapeCsvField(ticket.assigned_to_name),
      escapeCsvField(ticket.contact_name),
      escapeCsvField(ticket.organization_name),
      escapeCsvField(formatDate(ticket.due_date)),
      escapeCsvField(formatDate(ticket.created_at)),
      escapeCsvField(formatDate(ticket.updated_at)),
      escapeCsvField(formatDate(ticket.resolved_at)),
    ]);

    const csv = [
      headers.map((header) => escapeCsvField(header)).join(';'),
      ...rows.map((row) => row.join(';')),
    ].join('\n');

    const bom = '\uFEFF';
    const fileDate = new Date().toISOString().slice(0, 10);

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="tickets-${fileDate}.csv"`)
      .send(bom + csv);
  });

  // GET /api/tickets/search?q=termo&exclude=id
  app.get('/search', { preHandler: ticketsViewGuard }, async (request, reply) => {
    await ensureTicketRelationsInfrastructure();

    const { q, exclude } = request.query as { q?: string; exclude?: string };
    const term = q?.trim() ?? '';
    if (term.length < 2) {
      return reply.send({ success: true, data: [] });
    }

    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
    }>>(
      `SELECT id, title, status, priority
       FROM tickets
       WHERE (title ILIKE '%' || $1 || '%' OR id::text ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR id::text <> $2::text)
       ORDER BY created_at DESC
       LIMIT 10`,
      term,
      exclude?.trim() || null,
    );

    return reply.send({ success: true, data: rows });
  });

  // POST /api/tickets
  app.post('/', { preHandler: ticketsEditGuard }, async (request, reply) => {
    const parsed = createTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const ticket = await createTicket(parsed.data, request.user.id, request.user.tenantId!, schemaName);
      return reply.code(201).send({ success: true, data: ticket });
    } catch (err) {
      if (err instanceof BusinessRuleError) {
        return reply.code(422).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // GET /api/tickets/:id/relations
  app.get<{ Params: { id: string } }>('/:id/relations', { preHandler: ticketsViewGuard }, async (request, reply) => {
    await ensureTicketRelationsInfrastructure();
    const { id } = request.params;

    const rows = await prisma.$queryRawUnsafe<Array<{
      relation_id: string;
      relation_type: string;
      created_at: Date;
      related_ticket_id: string;
      related_title: string;
      related_status: string;
      related_priority: string;
      direction: 'outgoing' | 'incoming';
    }>>(
      `SELECT 
         tr.id AS relation_id,
         tr.relation_type,
         tr.created_at,
         CASE 
           WHEN tr.ticket_id = $1::uuid THEN tr.related_id
           ELSE tr.ticket_id
         END AS related_ticket_id,
         CASE 
           WHEN tr.ticket_id = $1::uuid THEN t2.title
           ELSE t1.title
         END AS related_title,
         CASE 
           WHEN tr.ticket_id = $1::uuid THEN t2.status
           ELSE t1.status
         END AS related_status,
         CASE 
           WHEN tr.ticket_id = $1::uuid THEN t2.priority
           ELSE t1.priority
         END AS related_priority,
         CASE
           WHEN tr.ticket_id = $1::uuid THEN 'outgoing'
           ELSE 'incoming'
         END AS direction
       FROM ticket_relations tr
       JOIN tickets t1 ON t1.id = tr.ticket_id
       JOIN tickets t2 ON t2.id = tr.related_id
       WHERE tr.ticket_id = $1::uuid
          OR tr.related_id = $1::uuid
       ORDER BY tr.created_at DESC`,
      id,
    );

    return reply.send({ success: true, data: rows });
  });

  // POST /api/tickets/:id/relations
  app.post<{ Params: { id: string } }>('/:id/relations', { preHandler: ticketsEditGuard }, async (request, reply) => {
    await ensureTicketRelationsInfrastructure();
    const { id } = request.params;
    const { related_id, relation_type } = request.body as {
      related_id?: string;
      relation_type?: string;
    };

    if (!related_id || !relation_type) {
      return reply.code(400).send({ success: false, error: { message: 'Dados inválidos' } });
    }

    if (!RELATION_TYPES.has(relation_type)) {
      return reply.code(400).send({ success: false, error: { message: 'Tipo de relação inválido' } });
    }

    if (id === related_id) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Não é possível vincular um ticket a si mesmo' },
      });
    }

    const tickets = await prisma.$queryRawUnsafe<Array<{ id: string; title: string }>>(
      `SELECT id, title
       FROM tickets
       WHERE id IN ($1::uuid, $2::uuid)`,
      id,
      related_id,
    );

    if (tickets.length !== 2) {
      return reply.code(404).send({ success: false, error: { message: 'Ticket não encontrado' } });
    }

    const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
       FROM ticket_relations
       WHERE (ticket_id = $1::uuid AND related_id = $2::uuid)
          OR (ticket_id = $2::uuid AND related_id = $1::uuid)
       LIMIT 1`,
      id,
      related_id,
    );

    if (existing.length > 0) {
      return reply.code(409).send({
        success: false,
        error: { message: 'Estes tickets já estão vinculados' },
      });
    }

    let ticketId = id;
    let relatedId = related_id;
    let normalizedType = relation_type;
    if (relation_type === 'is_blocked_by') {
      ticketId = related_id;
      relatedId = id;
      normalizedType = 'blocks';
    }

    const inserted = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO ticket_relations (ticket_id, related_id, relation_type, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
       ON CONFLICT (ticket_id, related_id) DO NOTHING
       RETURNING id`,
      ticketId,
      relatedId,
      normalizedType,
      request.user.id,
    );

    if (inserted.length === 0) {
      return reply.code(409).send({
        success: false,
        error: { message: 'Estes tickets já estão vinculados' },
      });
    }

    const byId = new Map(tickets.map((ticket) => [ticket.id, ticket.title]));
    const sourceTitle = byId.get(id) ?? 'Desconhecido';
    const targetTitle = byId.get(related_id) ?? 'Desconhecido';

    const sourceRelationType = relation_type;
    const targetRelationType =
      relation_type === 'blocks'
        ? 'is_blocked_by'
        : relation_type === 'is_blocked_by'
          ? 'blocks'
          : relation_type;

    await prisma.$executeRawUnsafe(
      `INSERT INTO ticket_events (ticket_id, user_id, event_type, new_value, metadata)
       VALUES
         ($1::uuid, $2::uuid, 'relation_added', $3, $4::jsonb),
         ($5::uuid, $2::uuid, 'relation_added', $6, $7::jsonb)`,
      id,
      request.user.id,
      sourceRelationType,
      JSON.stringify({
        related_id,
        related_title: targetTitle,
      }),
      related_id,
      targetRelationType,
      JSON.stringify({
        related_id: id,
        related_title: sourceTitle,
      }),
    );

    return reply.code(201).send({ success: true });
  });

  // DELETE /api/tickets/:id/relations/:relationId
  app.delete<{ Params: { id: string; relationId: string } }>(
    '/:id/relations/:relationId',
    { preHandler: ticketsEditGuard },
    async (request, reply) => {
      await ensureTicketRelationsInfrastructure();
      const { id, relationId } = request.params;

      const deleted = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `DELETE FROM ticket_relations
         WHERE id = $1::uuid
           AND (ticket_id = $2::uuid OR related_id = $2::uuid)
         RETURNING id`,
        relationId,
        id,
      );

      if (deleted.length === 0) {
        return reply.code(404).send({ success: false, error: { message: 'Vínculo não encontrado' } });
      }

      return reply.send({ success: true });
    },
  );

  // GET /api/tickets/:id/timeline
  app.get<{ Params: { id: string } }>('/:id/timeline', { preHandler: ticketsViewGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const timeline = await getTicketTimeline(request.params.id, schemaName);
      return reply.send({ success: true, data: timeline });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // GET /api/tickets/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: ticketsViewGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const ticket = await getTicket(request.params.id, schemaName);
      if (schemaName) {
        await insertTicketPiiAuditLog(schemaName, request.user.id, request.params.id);
      }
      return reply.send({ success: true, data: ticket });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // PATCH /api/tickets/:id
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: ticketsEditGuard }, async (request, reply) => {
    const parsed = updateTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const ticket = await updateTicket(request.params.id, parsed.data, request.user.id, request.user.tenantId!, schemaName);
      return reply.send({ success: true, data: ticket });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof BusinessRuleError)
        return reply.code(422).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // DELETE /api/tickets/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: ticketsDeleteGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const result = await deleteTicket(request.params.id, request.user.id, request.user.tenantId!, schemaName);
      return reply.send({ success: true, data: result });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // POST /api/tickets/:id/assign
  app.post<{ Params: { id: string } }>('/:id/assign', { preHandler: ticketsEditGuard }, async (request, reply) => {
    const parsed = assignTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const ticket = await assignTicket(
        request.params.id,
        parsed.data.user_id,
        request.user.id,
        request.user.tenantId!,
      );
      return reply.send({ success: true, data: ticket });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // POST /api/tickets/:id/claim
  app.post<{ Params: { id: string } }>('/:id/claim', { preHandler: ticketsEditGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const ticket = await claimTicketFromQueue(
        request.params.id,
        request.user.id,
        request.user.tenantId!,
        schemaName,
      );
      return reply.send({ success: true, data: ticket });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      if (err instanceof ConflictError)
        return reply.code(409).send({ success: false, error: { message: err.message } });
      if (err instanceof BusinessRuleError)
        return reply.code(422).send({ success: false, error: { message: err.message } });
      if (err instanceof ForbiddenError)
        return reply.code(403).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/tickets/:id/comments
  app.get<{ Params: { id: string } }>('/:id/comments', { preHandler: ticketsViewGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const comments = await listComments(request.params.id, schemaName);
      return reply.send({ success: true, data: comments });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // GET /api/tickets/:id/checklist
  app.get<{ Params: { id: string } }>('/:id/checklist', { preHandler: ticketsViewGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const items = await listChecklistItems(request.params.id, schemaName);
      return reply.send({ success: true, data: items });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // POST /api/tickets/:id/checklist
  app.post<{ Params: { id: string } }>('/:id/checklist', { preHandler: ticketsEditGuard }, async (request, reply) => {
    const parsed = createChecklistItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const item = await addChecklistItem(request.params.id, parsed.data.title);
      return reply.code(201).send({ success: true, data: item });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // PATCH /api/tickets/:id/checklist/:itemId
  app.patch<{ Params: { id: string; itemId: string } }>(
    '/:id/checklist/:itemId',
    { preHandler: ticketsEditGuard },
    async (request, reply) => {
      const parsed = updateChecklistItemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Dados inválidos', details: parsed.error.flatten() },
        });
      }

      try {
        const item = await updateChecklistItem(
          request.params.id,
          request.params.itemId,
          parsed.data,
          request.user.id,
        );
        return reply.send({ success: true, data: item });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // DELETE /api/tickets/:id/checklist/:itemId
  app.delete<{ Params: { id: string; itemId: string } }>(
    '/:id/checklist/:itemId',
    { preHandler: ticketsEditGuard },
    async (request, reply) => {
      try {
        const result = await deleteChecklistItem(request.params.id, request.params.itemId);
        return reply.send({ success: true, data: result });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // GET /api/tickets/:id/time
  app.get<{ Params: { id: string } }>('/:id/time', { preHandler: ticketsViewGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const entries = await listTimeEntries(request.params.id, schemaName);
      return reply.send({ success: true, data: entries });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // POST /api/tickets/:id/time
  app.post<{ Params: { id: string } }>('/:id/time', { preHandler: ticketsEditGuard }, async (request, reply) => {
    const parsed = createTimeEntrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    try {
      const entry = await addTimeEntry(request.params.id, request.user.id, parsed.data);
      return reply.code(201).send({ success: true, data: entry });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // DELETE /api/tickets/:id/time/:entryId
  app.delete<{ Params: { id: string; entryId: string } }>(
    '/:id/time/:entryId',
    { preHandler: ticketsEditGuard },
    async (request, reply) => {
      try {
        const result = await deleteTimeEntry(
          request.params.id,
          request.params.entryId,
          request.user.id,
          request.user.role,
        );
        return reply.send({ success: true, data: result });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        if (err instanceof ForbiddenError) {
          return reply.code(403).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // POST /api/tickets/:id/comments
  app.post<{ Params: { id: string } }>('/:id/comments', { preHandler: ticketsEditGuard }, async (request, reply) => {
    const parsed = createCommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }
    try {
      const comment = await addComment(
        request.params.id,
        parsed.data,
        request.user.id,
        request.user.tenantId!,
      );
      return reply.code(201).send({ success: true, data: comment });
    } catch (err) {
      if (err instanceof NotFoundError)
        return reply.code(404).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  // DELETE /api/tickets/:id/comments/:commentId
  app.patch<{ Params: { id: string; commentId: string } }>(
    '/:id/comments/:commentId',
    { preHandler: ticketsEditGuard },
    async (request, reply) => {
      const parsed = updateCommentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Dados inválidos', details: parsed.error.flatten() },
        });
      }
      try {
        const result = await updateComment(
          request.params.id,
          request.params.commentId,
          parsed.data,
          request.user.id,
          request.user.role,
          request.user.tenantId!,
        );
        return reply.send(result);
      } catch (err) {
        if (err instanceof NotFoundError)
          return reply.code(404).send({ success: false, error: { message: err.message } });
        if (err instanceof ForbiddenError)
          return reply.code(403).send({ success: false, error: { message: err.message } });
        throw err;
      }
    },
  );

  // DELETE /api/tickets/:id/comments/:commentId
  app.delete<{ Params: { id: string; commentId: string } }>(
    '/:id/comments/:commentId',
    { preHandler: ticketsEditGuard },
    async (request, reply) => {
      try {
        const result = await deleteComment(
          request.params.commentId,
          request.user.id,
          request.user.role,
          request.user.tenantId!,
        );
        return reply.send({ success: true, data: result });
      } catch (err) {
        if (err instanceof NotFoundError)
          return reply.code(404).send({ success: false, error: { message: err.message } });
        if (err instanceof ForbiddenError)
          return reply.code(403).send({ success: false, error: { message: err.message } });
        throw err;
      }
    },
  );

  // GET /api/tickets/:id/attachments
  app.get<{ Params: { id: string } }>('/:id/attachments', { preHandler: ticketsViewGuard }, async (request, reply) => {
    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const attachments = await listAttachments(request.params.id, schemaName);
      return reply.send({ success: true, data: attachments });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // POST /api/tickets/:id/attachments
  app.post<{ Params: { id: string } }>('/:id/attachments', { preHandler: ticketsEditGuard }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Content-Type deve ser multipart/form-data' },
      });
    }

    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let mimeType = '';
    let commentId: string | null = null;

    try {
      for await (const part of request.parts()) {
        if (part.type === 'file' && part.fieldname === 'file' && !fileBuffer) {
          fileBuffer = await part.toBuffer();
          fileName = part.filename;
          mimeType = part.mimetype;
          continue;
        }

        if (part.type === 'field' && part.fieldname === 'comment_id') {
          const rawValue = String(part.value ?? '').trim();
          commentId = rawValue || null;
          continue;
        }

        if (part.type === 'file') {
          await part.toBuffer();
        }
      }
    } catch (err) {
      if (isMultipartTooLargeError(err)) {
        return reply.code(413).send({ success: false, error: { message: 'Arquivo excede o limite de 10MB' } });
      }
      throw err;
    }

    if (!fileBuffer || !fileName || !mimeType) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Arquivo não enviado' },
      });
    }

    try {
      const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
      const data = await addAttachment({
        ticketId: request.params.id,
        commentId,
        userId: request.user.id,
        fileName,
        mimeType,
        buffer: fileBuffer,
        ...(schemaName ? { schemaName } : {}),
      });
      return reply.code(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof PayloadTooLargeError || isMultipartTooLargeError(err)) {
        return reply.code(413).send({ success: false, error: { message: 'Arquivo excede o limite de 10MB' } });
      }
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ success: false, error: { message: err.message } });
      }
      if (err instanceof ForbiddenError) {
        return reply.code(403).send({ success: false, error: { message: err.message } });
      }
      throw err;
    }
  });

  // DELETE /api/tickets/attachments/:attachmentId
  app.delete<{ Params: { attachmentId: string } }>(
    '/attachments/:attachmentId',
    { preHandler: ticketsEditGuard },
    async (request, reply) => {
      try {
        const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
        const result = await deleteAttachment(request.params.attachmentId, request.user.id, schemaName);
        return reply.send({ success: true, data: result });
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        if (err instanceof ForbiddenError) {
          return reply.code(403).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // GET /api/tickets/attachments/:attachmentId/content
  app.get<{ Params: { attachmentId: string } }>(
    '/attachments/:attachmentId/content',
    { preHandler: ticketsViewGuard },
    async (request, reply) => {
      try {
        const schemaName = 'schemaName' in request.user ? request.user.schemaName : undefined;
        const { content, filename, mimeType } = await readAttachmentContent(request.params.attachmentId, schemaName);
        reply.header('Content-Type', mimeType);
        reply.header('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
        reply.header('Cache-Control', 'private, max-age=3600');
        return reply.send(content);
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ success: false, error: { message: err.message } });
        }
        throw err;
      }
    },
  );
}
