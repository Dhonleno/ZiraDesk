import type { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { createLeadSchema } from './leads.schema.js';

export async function leadsRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/leads — formulário público da landing page.
  // Sem auth e sem tenant: o lead é anterior a qualquer cadastro.
  // Diferente de /auth/forgot-password, não há anti-enumeração aqui — nada
  // no corpo revela existência de conta —, então erro de validação vira 400.
  app.post('/', async (request, reply) => {
    const parsed = createLeadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    // Colunas opcionais são nullable no banco; `exactOptionalPropertyTypes`
    // não aceita o `string | undefined` que o zod produz com .optional().
    const { name, email, company, phone, message } = parsed.data;
    await prisma.lead.create({
      data: {
        name,
        email,
        company: company ?? null,
        phone: phone ?? null,
        message: message ?? null,
      },
    });

    request.log.info({ event: 'leads.created' }, 'Lead recebido pelo formulário público');

    return reply.code(201).send({ success: true });
  });
}
