-- Cria conversation_assignments em todos os schemas de tenant ativos
-- que realmente possuem a tabela conversations (ignora schemas de teste órfãos)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schema_name FROM public.tenants WHERE status = 'active'
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = r.schema_name
        AND table_name = 'conversations'
    );

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.conversation_assignments (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES %I.conversations(id) ON DELETE CASCADE,
        agent_id        UUID NOT NULL REFERENCES %I.users(id) ON DELETE CASCADE,
        assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        released_at     TIMESTAMPTZ,
        release_reason  VARCHAR(30),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )', r.schema_name, r.schema_name, r.schema_name);

    EXECUTE format('
      CREATE INDEX IF NOT EXISTS idx_conv_assignments_conversation
        ON %I.conversation_assignments(conversation_id)',
      r.schema_name);

    EXECUTE format('
      CREATE INDEX IF NOT EXISTS idx_conv_assignments_agent
        ON %I.conversation_assignments(agent_id)',
      r.schema_name);

    EXECUTE format('
      CREATE INDEX IF NOT EXISTS idx_conv_assignments_agent_released
        ON %I.conversation_assignments(agent_id, released_at)
        WHERE released_at IS NOT NULL',
      r.schema_name);
  END LOOP;
END $$;

-- Backfill: recupera histórico para conversas fechadas com agente atribuído
-- LIMITAÇÃO: conversas transferidas terão apenas o último agente no histórico
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schema_name FROM public.tenants WHERE status = 'active'
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = r.schema_name
        AND table_name = 'conversation_assignments'
    );

    EXECUTE format('
      INSERT INTO %I.conversation_assignments
        (conversation_id, agent_id, assigned_at, released_at, release_reason)
      SELECT
        c.id,
        c.assigned_to,
        COALESCE(c.assigned_at, c.created_at),
        COALESCE(c.closed_at, c.resolved_at),
        ''closed''
      FROM %I.conversations c
      WHERE c.assigned_to IS NOT NULL
        AND c.status = ''closed''
        AND NOT EXISTS (
          SELECT 1 FROM %I.conversation_assignments ca
          WHERE ca.conversation_id = c.id
        )
      ON CONFLICT DO NOTHING',
      r.schema_name, r.schema_name, r.schema_name);
  END LOOP;
END $$;
