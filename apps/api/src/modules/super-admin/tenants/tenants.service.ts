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
      bio         TEXT,
      phone       VARCHAR(30),
      status      VARCHAR(20)   NOT NULL DEFAULT 'active',
      last_seen_at TIMESTAMPTZ,
      language    VARCHAR(10)   NOT NULL DEFAULT 'pt-BR',
      notification_sound BOOLEAN NOT NULL DEFAULT true,
      notification_desktop BOOLEAN NOT NULL DEFAULT true,
      settings    JSONB         NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".agent_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES "${schemaName}".users(id) ON DELETE CASCADE,
      last_assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active_conversations INTEGER NOT NULL DEFAULT 0,
      is_available BOOLEAN NOT NULL DEFAULT false,
      status VARCHAR(20) NOT NULL DEFAULT 'offline',
      pause_reason VARCHAR(100),
      pause_started_at TIMESTAMPTZ,
      pause_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "${schemaName}".agent_assignments (user_id)
    SELECT id
    FROM "${schemaName}".users
    WHERE status = 'active'
      AND role IN ('owner', 'admin', 'agent')
    ON CONFLICT (user_id) DO NOTHING
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".pause_reasons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label VARCHAR(100) NOT NULL UNIQUE,
      icon VARCHAR(10) NOT NULL DEFAULT '⏸️',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "${schemaName}".pause_reasons (label, icon, sort_order)
    VALUES
      ('Almoço', '🍽️', 1),
      ('Banheiro', '🚻', 2),
      ('Reunião', '📋', 3),
      ('Intervalo', '☕', 4),
      ('Treinamento', '📚', 5),
      ('Outro', '⏸️', 99)
    ON CONFLICT (label) DO NOTHING
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".agent_pause_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES "${schemaName}".users(id) ON DELETE SET NULL,
      pause_reason VARCHAR(100),
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      duration_seconds INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".organizations (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      type            VARCHAR(20)  NOT NULL DEFAULT 'company',
      name            VARCHAR(150) NOT NULL,
      document        VARCHAR(20),
      email           VARCHAR(255),
      phone           VARCHAR(30),
      website         VARCHAR(255),
      status          VARCHAR(30)  NOT NULL DEFAULT 'lead',
      address_street  VARCHAR(200),
      address_city    VARCHAR(100),
      address_state   VARCHAR(2),
      address_zip     VARCHAR(10),
      segment         VARCHAR(100),
      lead_source     VARCHAR(100),
      responsible_id  UUID REFERENCES "${schemaName}".users(id) ON DELETE SET NULL,
      tags            TEXT[]       NOT NULL DEFAULT '{}',
      custom_fields   JSONB        NOT NULL DEFAULT '{}',
      notes           TEXT,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".contacts (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID REFERENCES "${schemaName}".organizations(id) ON DELETE SET NULL,
      name            VARCHAR(150) NOT NULL,
      email           VARCHAR(255),
      phone           VARCHAR(30),
      whatsapp        VARCHAR(30),
      document        VARCHAR(20),
      role            VARCHAR(100),
      department      VARCHAR(100),
      is_primary      BOOLEAN      NOT NULL DEFAULT false,
      avatar_url      VARCHAR(500),
      tags            TEXT[]       NOT NULL DEFAULT '{}',
      custom_fields   JSONB        NOT NULL DEFAULT '{}',
      notes           TEXT,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_contacts_organization"
    ON "${schemaName}".contacts(organization_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_contacts_whatsapp"
    ON "${schemaName}".contacts(whatsapp)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_contacts_phone"
    ON "${schemaName}".contacts(phone)
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
    CREATE TABLE "${schemaName}".business_hours (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      day_of_week INTEGER NOT NULL,
      is_active   BOOLEAN DEFAULT true,
      open_time   TIME NOT NULL DEFAULT '08:00',
      close_time  TIME NOT NULL DEFAULT '18:00',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(day_of_week)
    )
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "${schemaName}".business_hours (day_of_week, is_active, open_time, close_time)
    VALUES
      (0, false, '08:00', '18:00'),
      (1, true,  '08:00', '18:00'),
      (2, true,  '08:00', '18:00'),
      (3, true,  '08:00', '18:00'),
      (4, true,  '08:00', '18:00'),
      (5, true,  '08:00', '18:00'),
      (6, false, '08:00', '18:00')
    ON CONFLICT (day_of_week) DO NOTHING
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".bot_menus (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      is_active     BOOLEAN DEFAULT false,
      greeting      TEXT NOT NULL DEFAULT 'Olá! Bem-vindo ao nosso atendimento. Como posso ajudá-lo?',
      footer        TEXT DEFAULT 'Digite o número da opção desejada.',
      invalid_msg   TEXT DEFAULT 'Opção inválida. Por favor, escolha uma das opções abaixo:',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".bot_options (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bot_menu_id UUID REFERENCES "${schemaName}".bot_menus(id) ON DELETE CASCADE,
      number      INTEGER NOT NULL,
      label       VARCHAR(100) NOT NULL,
      tag         VARCHAR(50),
      response    TEXT,
      has_submenu BOOLEAN NOT NULL DEFAULT false,
      submenu_greeting TEXT,
      parent_option_id UUID REFERENCES "${schemaName}".bot_options(id) ON DELETE CASCADE,
      sort_order  INTEGER DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_bot_options_parent"
    ON "${schemaName}".bot_options(parent_option_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "${schemaName}_idx_bot_options_unique_parent_number"
    ON "${schemaName}".bot_options(
      bot_menu_id,
      COALESCE(parent_option_id, '00000000-0000-0000-0000-000000000000'::uuid),
      number
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".agent_bot_skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES "${schemaName}".users(id) ON DELETE CASCADE,
      bot_option_id UUID REFERENCES "${schemaName}".bot_options(id) ON DELETE CASCADE,
      level VARCHAR(20) DEFAULT 'intermediate',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, bot_option_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_agent_bot_skills_user"
    ON "${schemaName}".agent_bot_skills(user_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_agent_bot_skills_option"
    ON "${schemaName}".agent_bot_skills(bot_option_id)
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "${schemaName}".bot_menus (is_active, greeting, footer)
    SELECT false,
           'Olá! Bem-vindo ao nosso atendimento. Como posso ajudá-lo?',
           'Digite o número da opção desejada.'
    WHERE NOT EXISTS (SELECT 1 FROM "${schemaName}".bot_menus)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".conversations (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id      UUID REFERENCES "${schemaName}".contacts(id) ON DELETE SET NULL,
      organization_id UUID REFERENCES "${schemaName}".organizations(id) ON DELETE SET NULL,
      channel_id      UUID REFERENCES "${schemaName}".channels(id) ON DELETE SET NULL,
      channel_type    VARCHAR(30)  NOT NULL,
      external_id     VARCHAR(255),
      protocol_number VARCHAR(20)  UNIQUE,
      conversation_type VARCHAR(20) NOT NULL DEFAULT 'inbound',
      status          VARCHAR(20)  NOT NULL DEFAULT 'open',
      assigned_to     UUID REFERENCES "${schemaName}".users(id) ON DELETE SET NULL,
      subject         VARCHAR(255),
      last_message    TEXT,
      last_message_at TIMESTAMPTZ,
      resolved_at     TIMESTAMPTZ,
      csat_score      INTEGER CHECK (csat_score BETWEEN 1 AND 5),
      csat_comment    TEXT,
      csat_sent_at    TIMESTAMPTZ,
      csat_responded_at TIMESTAMPTZ,
      csat_stage      VARCHAR(20),
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
    CREATE TABLE "${schemaName}".call_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES "${schemaName}".conversations(id) ON DELETE CASCADE,
      agent_id UUID REFERENCES "${schemaName}".users(id),
      call_sid VARCHAR(50) UNIQUE NOT NULL,
      to_phone VARCHAR(30),
      from_phone VARCHAR(30),
      status VARCHAR(30) DEFAULT 'initiated',
      duration INTEGER,
      recording_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_call_records_conversation"
    ON "${schemaName}".call_records(conversation_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".conversation_helpers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES "${schemaName}".conversations(id) ON DELETE CASCADE,
      helper_user_id UUID REFERENCES "${schemaName}".users(id),
      requested_by UUID REFERENCES "${schemaName}".users(id),
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      accepted_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      UNIQUE(conversation_id, helper_user_id)
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
    CREATE TABLE "${schemaName}".conversation_tags (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       VARCHAR(50) NOT NULL,
      color      VARCHAR(7) NOT NULL DEFAULT '#00C9A7',
      is_active  BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(name)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".conversation_tag_assignments (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES "${schemaName}".conversations(id) ON DELETE CASCADE,
      tag_id          UUID REFERENCES "${schemaName}".conversation_tags(id) ON DELETE CASCADE,
      assigned_by     UUID REFERENCES "${schemaName}".users(id),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(conversation_id, tag_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_tag_assignments_conv"
    ON "${schemaName}".conversation_tag_assignments(conversation_id)
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "${schemaName}".conversation_tags (name, color, sort_order)
    VALUES
      ('Urgente', '#EF4444', 1),
      ('VIP', '#F59E0B', 2),
      ('Aguardando cliente', '#3B82F6', 3),
      ('Proposta enviada', '#8B5CF6', 4),
      ('Bug', '#EC4899', 5),
      ('Resolvido', '#10B981', 6)
    ON CONFLICT (name) DO NOTHING
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".ticket_types (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(80) NOT NULL,
      icon        VARCHAR(20) NOT NULL DEFAULT '🎫',
      color       VARCHAR(7) NOT NULL DEFAULT '#00C9A7',
      is_active   BOOLEAN NOT NULL DEFAULT true,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "${schemaName}_idx_ticket_types_name_unique"
    ON "${schemaName}".ticket_types (LOWER(name))
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".tickets (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id      UUID REFERENCES "${schemaName}".contacts(id) ON DELETE SET NULL,
      organization_id UUID REFERENCES "${schemaName}".organizations(id) ON DELETE SET NULL,
      conversation_id UUID REFERENCES "${schemaName}".conversations(id) ON DELETE SET NULL,
      source_conversation_id UUID REFERENCES "${schemaName}".conversations(id) ON DELETE SET NULL,
      type_id         UUID REFERENCES "${schemaName}".ticket_types(id) ON DELETE SET NULL,
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
    CREATE INDEX "${schemaName}_idx_tickets_type_id"
    ON "${schemaName}".tickets(type_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".ticket_events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id   UUID REFERENCES "${schemaName}".tickets(id) ON DELETE CASCADE,
      user_id     UUID REFERENCES "${schemaName}".users(id),
      event_type  VARCHAR(50) NOT NULL,
      old_value   TEXT,
      new_value   TEXT,
      metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_ticket_events_ticket"
    ON "${schemaName}".ticket_events(ticket_id)
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
    CREATE TABLE "${schemaName}".ticket_attachments (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id   UUID REFERENCES "${schemaName}".tickets(id) ON DELETE CASCADE,
      comment_id  UUID REFERENCES "${schemaName}".ticket_comments(id) ON DELETE CASCADE,
      user_id     UUID REFERENCES "${schemaName}".users(id),
      filename    VARCHAR(255) NOT NULL,
      file_url    VARCHAR(500) NOT NULL,
      file_size   INTEGER,
      mime_type   VARCHAR(100),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_ticket_attachments_ticket"
    ON "${schemaName}".ticket_attachments(ticket_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".ticket_checklists (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id   UUID REFERENCES "${schemaName}".tickets(id) ON DELETE CASCADE,
      title       VARCHAR(200) NOT NULL,
      is_done     BOOLEAN DEFAULT false,
      done_by     UUID REFERENCES "${schemaName}".users(id),
      done_at     TIMESTAMPTZ,
      sort_order  INTEGER DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_ticket_checklists_ticket"
    ON "${schemaName}".ticket_checklists(ticket_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schemaName}".ticket_time_entries (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id   UUID REFERENCES "${schemaName}".tickets(id) ON DELETE CASCADE,
      user_id     UUID REFERENCES "${schemaName}".users(id),
      description VARCHAR(300),
      minutes     INTEGER NOT NULL CHECK (minutes > 0),
      worked_at   DATE DEFAULT CURRENT_DATE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "${schemaName}_idx_time_entries_ticket"
    ON "${schemaName}".ticket_time_entries(ticket_id)
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
