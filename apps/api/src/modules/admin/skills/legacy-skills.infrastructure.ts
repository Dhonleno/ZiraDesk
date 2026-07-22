import type { PrismaClient } from '@prisma/client';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';

function tableRef(schemaName: string, table: string): string {
  return `${quoteIdent(schemaName)}.${table}`;
}

export async function ensureAgentBotSkillsInfrastructure(
  prisma: PrismaClient,
  schemaName: string,
): Promise<void> {
  const usersRef = tableRef(schemaName, 'users');
  const botOptionsRef = tableRef(schemaName, 'bot_options');
  const agentBotSkillsRef = tableRef(schemaName, 'agent_bot_skills');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${agentBotSkillsRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES ${usersRef}(id) ON DELETE CASCADE,
      bot_option_id UUID REFERENCES ${botOptionsRef}(id) ON DELETE CASCADE,
      level VARCHAR(20) DEFAULT 'intermediate',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, bot_option_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_agent_bot_skills_user
    ON ${agentBotSkillsRef}(user_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_agent_bot_skills_option
    ON ${agentBotSkillsRef}(bot_option_id)
  `);
}
