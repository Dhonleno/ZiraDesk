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

  // Limpar em ordem para respeitar FKs
  await exec(`DELETE FROM audit_logs`);
  await exec(`DELETE FROM ticket_comments`);
  await exec(`DELETE FROM tickets`);
  await exec(`DELETE FROM messages`);
  await exec(`DELETE FROM conversations`);
  await exec(`DELETE FROM quick_replies`);
  await exec(`DELETE FROM channels`);

  // Dropar tabelas antigas do modelo B2C
  await exec(`DROP TABLE IF EXISTS clients CASCADE`);
  await exec(`DROP TABLE IF EXISTS agent_skills CASCADE`);
  await exec(`DROP TABLE IF EXISTS skills CASCADE`);

  await exec(`
    CREATE TABLE IF NOT EXISTS agent_bot_skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      bot_option_id UUID REFERENCES bot_options(id) ON DELETE CASCADE,
      level VARCHAR(20) DEFAULT 'intermediate',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, bot_option_id)
    )
  `);

  await exec(`CREATE INDEX IF NOT EXISTS idx_agent_bot_skills_user ON agent_bot_skills(user_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_agent_bot_skills_option ON agent_bot_skills(bot_option_id)`);

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

  // Atualizar conversations: remover client_id, adicionar contact_id + organization_id
  await exec(`ALTER TABLE conversations DROP COLUMN IF EXISTS client_id`);
  await exec(`
    ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS contact_id      UUID REFERENCES contacts(id)      ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL
  `);

  // Atualizar tickets: remover client_id, adicionar contact_id + organization_id
  await exec(`ALTER TABLE tickets DROP COLUMN IF EXISTS client_id`);
  await exec(`
    ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS contact_id      UUID REFERENCES contacts(id)      ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL
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
  console.log('Tabelas atualizadas: conversations (contact_id, organization_id), tickets (contact_id, organization_id)');
  console.log('Tabela removida: clients, skills, agent_skills');
  console.log('Tabela criada: agent_bot_skills');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Erro no reset:', err);
  void prisma.$disconnect();
  process.exit(1);
});
