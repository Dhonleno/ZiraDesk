import type { PrismaClient } from '@prisma/client';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';

/**
 * Fase 1 do roteamento canonico (Grupo -> Assunto).
 *
 * PURAMENTE ADITIVO. Cria 5 tabelas novas e adiciona colunas em bot_options e
 * conversations. Nao remove nada, nao altera comportamento: as colunas nascem
 * vazias e o motor atual (bot_option_id + bot_option_skills) segue intacto.
 *
 * As colunas legadas de roteamento em conversations (bot_option_id,
 * department_id, routing_used_skill_id, routing_started_at, queue_entered_at)
 * convivem e NAO sao tocadas aqui.
 *
 * Idempotente: re-executar nao produz mudanca. CREATE TABLE / ADD COLUMN /
 * CREATE INDEX usam IF NOT EXISTS; os CHECK usam guarda em pg_constraint,
 * porque o Postgres nao suporta ADD CONSTRAINT IF NOT EXISTS (16.14).
 *
 * Depende de tabelas que ja existem no schema do tenant: users, skills,
 * bot_options, conversations.
 */

function tableRef(schemaName: string, table: string): string {
  return `${quoteIdent(schemaName)}.${table}`;
}

/**
 * ALTER TABLE ... ADD CONSTRAINT nao aceita IF NOT EXISTS. A guarda por
 * pg_constraint deixa a operacao idempotente. O nome da constraint e local ao
 * schema do tenant, entao nao colide entre tenants.
 */
async function ensureCheckConstraint(
  db: PrismaClient,
  schemaName: string,
  table: string,
  constraintName: string,
  checkExpression: string,
): Promise<void> {
  const ref = tableRef(schemaName, table);
  await db.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = '${constraintName}'
          AND conrelid = '${ref}'::regclass
      ) THEN
        ALTER TABLE ${ref}
          ADD CONSTRAINT ${constraintName} CHECK (${checkExpression});
      END IF;
    END $$;
  `);
}

export async function ensureCanonicalRoutingInfrastructure(
  db: PrismaClient,
  schemaName: string,
): Promise<void> {
  const routingGroupsRef = tableRef(schemaName, 'routing_groups');
  const subjectsRef = tableRef(schemaName, 'subjects');
  const agentGroupsRef = tableRef(schemaName, 'agent_groups');
  const routingGroupSkillsRef = tableRef(schemaName, 'routing_group_skills');
  const subjectSkillsRef = tableRef(schemaName, 'subject_skills');
  const usersRef = tableRef(schemaName, 'users');
  const skillsRef = tableRef(schemaName, 'skills');
  const botOptionsRef = tableRef(schemaName, 'bot_options');
  const conversationsRef = tableRef(schemaName, 'conversations');

  // ── 1. routing_groups ───────────────────────────────────────────────────
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${routingGroupsRef} (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       VARCHAR(100) NOT NULL,
      is_active  BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uidx_routing_groups_name"
    ON ${routingGroupsRef}(name)
  `);

  // ── 2. subjects ─────────────────────────────────────────────────────────
  // RESTRICT: apagar um grupo que ainda tem assunto e erro de configuracao,
  // nao cascata silenciosa.
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${subjectsRef} (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id   UUID NOT NULL REFERENCES ${routingGroupsRef}(id) ON DELETE RESTRICT,
      name       VARCHAR(100) NOT NULL,
      is_active  BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_subjects_group"
    ON ${subjectsRef}(group_id)
  `);

  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uidx_subjects_group_name"
    ON ${subjectsRef}(group_id, name)
  `);

  // ── 3. agent_groups ─────────────────────────────────────────────────────
  // CASCADE no usuario (remover o agente limpa o vinculo), RESTRICT no grupo
  // (grupo com agente nao deve sumir por baixo do roteamento).
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${agentGroupsRef} (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES ${usersRef}(id) ON DELETE CASCADE,
      group_id   UUID NOT NULL REFERENCES ${routingGroupsRef}(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, group_id)
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_agent_groups_group"
    ON ${agentGroupsRef}(group_id)
  `);

  // ── 4. routing_group_skills ─────────────────────────────────────────────
  // Tabela de juncao: CASCADE dos dois lados, mesmo padrao de
  // bot_option_skills. Apagar o grupo ou a skill remove o vinculo.
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${routingGroupSkillsRef} (
      group_id   UUID NOT NULL REFERENCES ${routingGroupsRef}(id) ON DELETE CASCADE,
      skill_id   UUID NOT NULL REFERENCES ${skillsRef}(id) ON DELETE CASCADE,
      required   BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, skill_id)
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_routing_group_skills_skill"
    ON ${routingGroupSkillsRef}(skill_id)
  `);

  // ── 5. subject_skills ───────────────────────────────────────────────────
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${subjectSkillsRef} (
      subject_id UUID NOT NULL REFERENCES ${subjectsRef}(id) ON DELETE CASCADE,
      skill_id   UUID NOT NULL REFERENCES ${skillsRef}(id) ON DELETE CASCADE,
      required   BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (subject_id, skill_id)
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_subject_skills_skill"
    ON ${subjectSkillsRef}(skill_id)
  `);

  // ── 6. bot_options.subject_id ───────────────────────────────────────────
  // O menu vira adaptador de navegacao: a opcao aponta para o assunto
  // canonico. parent_option_id / has_submenu seguem governando a navegacao.
  await db.$executeRawUnsafe(`
    ALTER TABLE ${botOptionsRef}
    ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES ${subjectsRef}(id) ON DELETE RESTRICT
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_bot_options_subject"
    ON ${botOptionsRef}(subject_id)
    WHERE subject_id IS NOT NULL
  `);

  // ── 7. conversations: 9 colunas de classificacao ────────────────────────
  // initial_* congela a classificacao de entrada; current_* acompanha
  // transferencias. Nenhuma toca as 5 colunas legadas de roteamento.
  await db.$executeRawUnsafe(`
    ALTER TABLE ${conversationsRef}
    ADD COLUMN IF NOT EXISTS initial_subject_id UUID REFERENCES ${subjectsRef}(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS initial_group_id   UUID REFERENCES ${routingGroupsRef}(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS current_subject_id UUID REFERENCES ${subjectsRef}(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS current_group_id   UUID REFERENCES ${routingGroupsRef}(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS classification_source     VARCHAR(32),
    ADD COLUMN IF NOT EXISTS classified_at             TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS classification_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS routing_hold_reason       VARCHAR(64),
    ADD COLUMN IF NOT EXISTS routing_hold_since        TIMESTAMPTZ
  `);

  // Assunto e grupo andam juntos: ou os dois preenchidos, ou os dois nulos.
  // Como as colunas nascem NULL em toda linha existente, os dois CHECK sao
  // satisfeitos pelo acervo atual e a validacao nao rejeita nada.
  await ensureCheckConstraint(
    db,
    schemaName,
    'conversations',
    'chk_conversations_initial_classification',
    '(initial_subject_id IS NULL) = (initial_group_id IS NULL)',
  );

  await ensureCheckConstraint(
    db,
    schemaName,
    'conversations',
    'chk_conversations_current_classification',
    '(current_subject_id IS NULL) = (current_group_id IS NULL)',
  );

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_conversations_initial_subject"
    ON ${conversationsRef}(initial_subject_id)
    WHERE initial_subject_id IS NOT NULL
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_conversations_initial_group"
    ON ${conversationsRef}(initial_group_id)
    WHERE initial_group_id IS NOT NULL
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_conversations_current_subject"
    ON ${conversationsRef}(current_subject_id)
    WHERE current_subject_id IS NOT NULL
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_conversations_current_group"
    ON ${conversationsRef}(current_group_id)
    WHERE current_group_id IS NOT NULL
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_conversations_routing_hold"
    ON ${conversationsRef}(routing_hold_since)
    WHERE routing_hold_reason IS NOT NULL
  `);
}
