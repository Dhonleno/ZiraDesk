import { PrismaClient } from '@prisma/client';
import { encryptCredentials } from '../utils/crypto.js';

const prisma = new PrismaClient();
const SCHEMA = 'tenant_demo';

async function exec(sql: string, ...params: unknown[]) {
  return prisma.$executeRawUnsafe(sql, ...params);
}

function buildWhatsappChannelCredentials(): string {
  if (process.env.WHATSAPP_CHANNEL_CREDENTIALS) {
    return process.env.WHATSAPP_CHANNEL_CREDENTIALS;
  }

  const credentials = {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    wabaId: process.env.WHATSAPP_WABA_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  };
  const filledCredentials = Object.fromEntries(
    Object.entries(credentials).filter(([, value]) => typeof value === 'string' && value.trim()),
  );

  if (Object.keys(filledCredentials).length === 0) return '{}';
  return JSON.stringify(encryptCredentials(filledCredentials));
}

async function main() {
  console.log(`Limpando dados do ${SCHEMA}...`);

  await exec(`SET search_path TO "${SCHEMA}", public`);

  await exec(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS bio TEXT,
    ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
    ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'pt-BR',
    ADD COLUMN IF NOT EXISTS notification_sound BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS notification_desktop BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  // Limpar em ordem para respeitar FKs
  await exec(`DELETE FROM audit_logs`);
  await exec(`
    DO $$
    BEGIN
      IF to_regclass('ticket_events') IS NOT NULL THEN
        DELETE FROM ticket_events;
      END IF;
      IF to_regclass('ticket_relations') IS NOT NULL THEN
        DELETE FROM ticket_relations;
      END IF;
      IF to_regclass('ticket_attachments') IS NOT NULL THEN
        DELETE FROM ticket_attachments;
      END IF;
    END
    $$;
  `);
  await exec(`DELETE FROM ticket_comments`);
  await exec(`DELETE FROM tickets`);
  await exec(`DELETE FROM messages`);
  await exec(`DELETE FROM conversations`);
  await exec(`DELETE FROM quick_replies`);
  await exec(`DELETE FROM channels`);

  // Dropar tabelas antigas do modelo B2C
  await exec(`DROP TABLE IF EXISTS clients CASCADE`);

  await exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_skills_name" ON skills(name)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS bot_option_skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bot_option_id UUID NOT NULL REFERENCES bot_options(id) ON DELETE CASCADE,
      skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      required BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(bot_option_id, skill_id)
    )
  `);

  await exec(`CREATE INDEX IF NOT EXISTS "idx_bot_option_skills_option" ON bot_option_skills(bot_option_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS "idx_bot_option_skills_skill" ON bot_option_skills(skill_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS agent_skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      level VARCHAR(20) NOT NULL DEFAULT 'intermediate',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, skill_id)
    )
  `);

  await exec(`CREATE INDEX IF NOT EXISTS "idx_agent_skills_user" ON agent_skills(user_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS "idx_agent_skills_skill" ON agent_skills(skill_id)`);

  await exec(`DELETE FROM agent_skills`);
  await exec(`DELETE FROM bot_option_skills`);
  await exec(`DELETE FROM skills`);

  await exec(`
    INSERT INTO skills (name, description)
    VALUES
      ('Suporte Tecnico', 'Atendimento tecnico e suporte ao produto'),
      ('Comercial', 'Pre-vendas e negociacao comercial'),
      ('Financeiro', 'Cobrancas, pagamentos e notas fiscais')
    ON CONFLICT (name) DO UPDATE
    SET description = EXCLUDED.description,
        is_active = true,
        updated_at = NOW()
  `);

  await exec(`
    INSERT INTO agent_skills (user_id, skill_id, level)
    SELECT u.id, s.id, 'intermediate'
    FROM users u
    CROSS JOIN skills s
    WHERE u.status = 'active'
      AND u.role IN ('owner', 'admin', 'supervisor', 'agent')
    ON CONFLICT (user_id, skill_id) DO NOTHING
  `);

  // Criar tabela organizations
  await exec(`
    CREATE TABLE IF NOT EXISTS organizations (
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
      responsible_id  UUID REFERENCES users(id) ON DELETE SET NULL,
      tags            TEXT[]       NOT NULL DEFAULT '{}',
      custom_fields   JSONB        NOT NULL DEFAULT '{}',
      notes           TEXT,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  // Criar tabela contacts
  await exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
      name            VARCHAR(150) NOT NULL,
      email           VARCHAR(255),
      phone           VARCHAR(30),
      whatsapp        VARCHAR(30),
      document        VARCHAR(20),
      role            VARCHAR(100),
      department      VARCHAR(100),
      is_primary      BOOLEAN      NOT NULL DEFAULT false,
      avatar_url      VARCHAR(500),
      portal_enabled  BOOLEAN      NOT NULL DEFAULT false,
      portal_password_hash VARCHAR(255),
      portal_last_login TIMESTAMPTZ,
      portal_invited_at TIMESTAMPTZ,
      tags            TEXT[]       NOT NULL DEFAULT '{}',
      custom_fields   JSONB        NOT NULL DEFAULT '{}',
      notes           TEXT,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await exec(`CREATE INDEX IF NOT EXISTS idx_contacts_organization ON contacts(organization_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp ON contacts(whatsapp)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone)`);

  await exec(`
    ALTER TABLE contacts
    ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS portal_password_hash VARCHAR(255),
    ADD COLUMN IF NOT EXISTS portal_last_login TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS portal_invited_at TIMESTAMPTZ
  `);

  // Atualizar conversations: remover client_id, adicionar contact_id + organization_id
  await exec(`ALTER TABLE conversations DROP COLUMN IF EXISTS client_id`);
  await exec(`
    ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS contact_id      UUID REFERENCES contacts(id)      ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS csat_score INTEGER,
    ADD COLUMN IF NOT EXISTS csat_comment TEXT,
    ADD COLUMN IF NOT EXISTS csat_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS csat_responded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS csat_stage VARCHAR(20),
    ADD COLUMN IF NOT EXISTS csat_expires_at TIMESTAMPTZ
  `);

  // Atualizar tickets: remover client_id, adicionar contact_id + organization_id
  await exec(`ALTER TABLE tickets DROP COLUMN IF EXISTS client_id`);
  await exec(`
    ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS contact_id      UUID REFERENCES contacts(id)      ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS type_id UUID,
    ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS email_message_id VARCHAR(500)
  `);

  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_email_message_id
    ON tickets(email_message_id)
    WHERE email_message_id IS NOT NULL
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS ticket_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(80) NOT NULL,
      icon VARCHAR(20) NOT NULL DEFAULT '🎫',
      color VARCHAR(7) NOT NULL DEFAULT '#00C9A7',
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_types_name_unique
    ON ticket_types (LOWER(name))
  `);

  await exec(`
    ALTER TABLE tickets
    DROP CONSTRAINT IF EXISTS tickets_type_id_fkey
  `);

  await exec(`
    ALTER TABLE tickets
    ADD CONSTRAINT tickets_type_id_fkey
    FOREIGN KEY (type_id) REFERENCES ticket_types(id) ON DELETE SET NULL
  `);

  await exec(`
    CREATE INDEX IF NOT EXISTS idx_tickets_type_id ON tickets(type_id)
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS ticket_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id),
      event_type VARCHAR(50) NOT NULL,
      old_value TEXT,
      new_value TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await exec(`CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events(ticket_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS ticket_relations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      related_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      relation_type VARCHAR(30) NOT NULL,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ticket_id, related_id),
      CHECK(ticket_id <> related_id)
    )
  `);

  await exec(`CREATE INDEX IF NOT EXISTS idx_ticket_relations_ticket ON ticket_relations(ticket_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_ticket_relations_related ON ticket_relations(related_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS ticket_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
      comment_id UUID REFERENCES ticket_comments(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id),
      filename VARCHAR(255) NOT NULL,
      file_url VARCHAR(500) NOT NULL,
      file_size INTEGER,
      mime_type VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await exec(`CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON ticket_attachments(ticket_id)`);

  await exec(`
    ALTER TABLE ticket_comments
    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'agent'
  `);

  await exec(`
    ALTER TABLE ticket_comments
    ALTER COLUMN user_id DROP NOT NULL
  `);

  // Recriar canal WhatsApp com credenciais do env (se definido)
  const credentials = buildWhatsappChannelCredentials();
  await exec(
    `INSERT INTO channels (id, type, name, credentials, status, created_at)
     VALUES (gen_random_uuid(), 'whatsapp', 'WhatsApp Principal', $1::jsonb, 'active', NOW())`,
    credentials,
  );

  console.log(`${SCHEMA} resetado com sucesso!`);
  console.log('Tabelas criadas: organizations, contacts');
  console.log('Tabelas atualizadas: conversations (contact_id, organization_id), tickets (contact_id, organization_id, source_conversation_id)');
  console.log('Tabela removida: clients');
  console.log('Tabelas criadas: skills, agent_skills, bot_option_skills, ticket_events');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Erro no reset:', err);
  void prisma.$disconnect();
  process.exit(1);
});
