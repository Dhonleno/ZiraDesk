import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/database.js';
import type { CreateTenantInput, UpdateTenantInput, ListTenantsQuery } from './tenants.schema.js';

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

function toSchemaName(slug: string): string {
  // "minha-empresa" → "tenant_minha_empresa"
  return `tenant_${slug.replace(/-/g, '_')}`;
}

async function createTenantTables(schemaName: string): Promise<void> {
  // Cada execução é separada para rastreabilidade de erros
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".users (
      id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(100)  NOT NULL,
      email       VARCHAR(255)  NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role        VARCHAR(30)   NOT NULL DEFAULT 'agent',
      avatar_url  VARCHAR(500),
      status      VARCHAR(20)   NOT NULL DEFAULT 'active',
      last_seen_at TIMESTAMPTZ,
      language    VARCHAR(10)   NOT NULL DEFAULT 'pt-BR',
      settings    JSONB         NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".clients (
      id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      type           VARCHAR(20)  NOT NULL DEFAULT 'person',
      name           VARCHAR(150) NOT NULL,
      email          VARCHAR(255),
      phone          VARCHAR(30),
      document       VARCHAR(20),
      website        VARCHAR(500),
      status         VARCHAR(30)  NOT NULL DEFAULT 'lead',
      address_street VARCHAR(200),
      address_city   VARCHAR(100),
      address_state  VARCHAR(2),
      address_zip    VARCHAR(10),
      birth_date     DATE,
      gender         VARCHAR(20),
      occupation     VARCHAR(100),
      income         DECIMAL(15,2),
      segment        VARCHAR(100),
      lead_source    VARCHAR(100),
      responsible_id UUID REFERENCES "${schemaName}".users(id) ON DELETE SET NULL,
      tags           TEXT[]       NOT NULL DEFAULT '{}',
      custom_fields  JSONB        NOT NULL DEFAULT '{}',
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".channels (
      id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      type        VARCHAR(30)  NOT NULL,
      name        VARCHAR(100) NOT NULL,
      credentials JSONB        NOT NULL DEFAULT '{}',
      status      VARCHAR(20)  NOT NULL DEFAULT 'active',
      settings    JSONB        NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".conversations (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id       UUID REFERENCES "${schemaName}".clients(id) ON DELETE SET NULL,
      channel_id      UUID REFERENCES "${schemaName}".channels(id) ON DELETE SET NULL,
      channel_type    VARCHAR(30)  NOT NULL,
      external_id     VARCHAR(255),
      protocol_number VARCHAR(20)  UNIQUE,
      status          VARCHAR(20)  NOT NULL DEFAULT 'open',
      assigned_to     UUID REFERENCES "${schemaName}".users(id) ON DELETE SET NULL,
      subject         VARCHAR(255),
      last_message    TEXT,
      last_message_at TIMESTAMPTZ,
      resolved_at     TIMESTAMPTZ,
      metadata        JSONB        NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "${schemaName}".generate_protocol()
    RETURNS VARCHAR AS $$
    DECLARE
      year_month TEXT;
      next_seq INTEGER;
      protocol TEXT;
    BEGIN
      year_month := TO_CHAR(NOW(), 'YYYYMM');
      PERFORM pg_advisory_xact_lock(hashtext('protocol:' || year_month)::bigint);

      SELECT COALESCE(MAX(CAST(SUBSTRING(protocol_number FROM 11) AS INTEGER)), 0) + 1
        INTO next_seq
        FROM "${schemaName}".conversations
       WHERE protocol_number LIKE 'ZD-' || year_month || '-%';

      protocol := 'ZD-' || year_month || '-' || LPAD(next_seq::TEXT, 6, '0');
      RETURN protocol;
    END;
    $$ LANGUAGE plpgsql
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".messages (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID         NOT NULL REFERENCES "${schemaName}".conversations(id) ON DELETE CASCADE,
      sender_type     VARCHAR(20)  NOT NULL,
      sender_id       UUID,
      content         TEXT,
      content_type    VARCHAR(30)  NOT NULL DEFAULT 'text',
      media_url       VARCHAR(500),
      external_id     VARCHAR(255),
      status          VARCHAR(20)  NOT NULL DEFAULT 'sent',
      is_internal     BOOLEAN      NOT NULL DEFAULT FALSE,
      metadata        JSONB        NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".quick_replies (
      id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      title       VARCHAR(120) NOT NULL,
      shortcut    VARCHAR(50)  NOT NULL UNIQUE,
      content     TEXT         NOT NULL,
      category    VARCHAR(30)  NOT NULL DEFAULT 'other',
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".tickets (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id       UUID REFERENCES "${schemaName}".clients(id) ON DELETE SET NULL,
      conversation_id UUID REFERENCES "${schemaName}".conversations(id) ON DELETE SET NULL,
      title           VARCHAR(255) NOT NULL,
      description     TEXT,
      status          VARCHAR(30)  NOT NULL DEFAULT 'open',
      priority        VARCHAR(20)  NOT NULL DEFAULT 'medium',
      category        VARCHAR(100),
      assigned_to     UUID REFERENCES "${schemaName}".users(id) ON DELETE SET NULL,
      resolved_at     TIMESTAMPTZ,
      due_date        TIMESTAMPTZ,
      tags            TEXT[]       NOT NULL DEFAULT '{}',
      custom_fields   JSONB        NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".ticket_comments (
      id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id   UUID         NOT NULL REFERENCES "${schemaName}".tickets(id) ON DELETE CASCADE,
      user_id     UUID         NOT NULL REFERENCES "${schemaName}".users(id) ON DELETE CASCADE,
      content     TEXT         NOT NULL,
      is_internal BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".audit_logs (
      id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID,
      action     VARCHAR(100) NOT NULL,
      entity     VARCHAR(50)  NOT NULL,
      entity_id  UUID,
      old_data   JSONB,
      new_data   JSONB,
      ip_address INET,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
}

export async function createTenant(data: CreateTenantInput): Promise<{
  tenant: { id: string; name: string; slug: string; schemaName: string };
  tempPassword: string;
}> {
  const existing = await prisma.tenant.findUnique({ where: { slug: data.slug } });
  if (existing) throw new ConflictError('Subdomínio já está em uso');

  const plan = await prisma.plan.findUnique({ where: { id: data.planId } });
  if (!plan) throw new NotFoundError('Plano');

  const schemaName = toSchemaName(data.slug);
  let tenantId: string | null = null;
  let schemaCreated = false;

  try {
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + data.trialDays);

    const tenant = await prisma.tenant.create({
      data: {
        name: data.name,
        slug: data.slug,
        schemaName,
        planId: data.planId,
        status: 'trial',
        trialEndsAt,
      },
    });
    tenantId = tenant.id;

    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    schemaCreated = true;

    await createTenantTables(schemaName);

    // Gera senha temporária (12 chars base64url)
    const tempPassword = randomBytes(9).toString('base64url').slice(0, 12);
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}".users (name, email, password_hash, role, status, language, settings)
       VALUES ($1, $2, $3, 'owner', 'active', 'pt-BR', '{}')`,
      data.ownerName,
      data.ownerEmail,
      passwordHash,
    );

    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: 'trialing',
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEndsAt,
      },
    });

    return {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, schemaName: tenant.schemaName },
      tempPassword,
    };
  } catch (err) {
    // Rollback manual: DDL não participa de transações Prisma
    if (schemaCreated) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
    }
    if (tenantId) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    throw err;
  }
}

export async function listTenants(query: ListTenantsQuery) {
  const { page, perPage, status, search } = query;
  const skip = (page - 1) * perPage;

  const where: Prisma.TenantWhereInput = {};

  if (status) {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { slug: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      include: { plan: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: perPage,
    }),
    prisma.tenant.count({ where }),
  ]);

  return {
    data: tenants,
    meta: {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    },
  };
}

export async function getTenant(id: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      plan: true,
      subscriptions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
  if (!tenant) throw new NotFoundError('Tenant');
  return tenant;
}

export async function updateTenant(id: string, data: UpdateTenantInput) {
  await getTenant(id);
  return prisma.tenant.update({
    where: { id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: data as any,
  });
}

export async function deleteTenant(id: string) {
  await getTenant(id);
  // Soft delete — preserva dados por 30 dias; schema é mantido
  return prisma.tenant.update({
    where: { id },
    data: { status: 'cancelled' },
  });
}

export async function suspendTenant(id: string) {
  await getTenant(id);
  return prisma.tenant.update({ where: { id }, data: { status: 'suspended' } });
}

export async function activateTenant(id: string) {
  await getTenant(id);
  return prisma.tenant.update({ where: { id }, data: { status: 'active' } });
}
