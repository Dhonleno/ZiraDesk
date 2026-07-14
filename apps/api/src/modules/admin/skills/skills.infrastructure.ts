import type { PrismaClient } from '@prisma/client';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';

function tableRef(schemaName: string, table: string): string {
  return `${quoteIdent(schemaName)}.${table}`;
}

export async function ensureSkillsInfrastructure(
  db: PrismaClient,
  schemaName: string,
): Promise<void> {
  const skillsRef = tableRef(schemaName, 'skills');
  const botOptionsRef = tableRef(schemaName, 'bot_options');
  const botOptionSkillsRef = tableRef(schemaName, 'bot_option_skills');
  const usersRef = tableRef(schemaName, 'users');
  const agentSkillsRef = tableRef(schemaName, 'agent_skills');

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${skillsRef} (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(100) NOT NULL,
      description TEXT,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uidx_skills_name"
    ON ${skillsRef}(name)
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${botOptionSkillsRef} (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bot_option_id UUID NOT NULL REFERENCES ${botOptionsRef}(id) ON DELETE CASCADE,
      skill_id      UUID NOT NULL REFERENCES ${skillsRef}(id) ON DELETE CASCADE,
      required      BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(bot_option_id, skill_id)
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_bot_option_skills_option"
    ON ${botOptionSkillsRef}(bot_option_id)
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_bot_option_skills_skill"
    ON ${botOptionSkillsRef}(skill_id)
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${agentSkillsRef} (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES ${usersRef}(id) ON DELETE CASCADE,
      skill_id   UUID NOT NULL REFERENCES ${skillsRef}(id) ON DELETE CASCADE,
      level      VARCHAR(20) NOT NULL DEFAULT 'intermediate',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, skill_id)
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_agent_skills_user"
    ON ${agentSkillsRef}(user_id)
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_agent_skills_skill"
    ON ${agentSkillsRef}(skill_id)
  `);
}
