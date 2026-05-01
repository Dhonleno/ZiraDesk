DO $$
DECLARE
  tenant_schema TEXT;
BEGIN
  FOR tenant_schema IN SELECT schema_name FROM tenants LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.skills (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         name VARCHAR(100) NOT NULL,
         description TEXT,
         tag VARCHAR(50),
         color VARCHAR(7) DEFAULT ''#00C9A7'',
         is_active BOOLEAN DEFAULT true,
         created_at TIMESTAMPTZ DEFAULT NOW(),
         UNIQUE(name)
       )',
      tenant_schema
    );

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.agent_skills (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         user_id UUID REFERENCES %I.users(id) ON DELETE CASCADE,
         skill_id UUID REFERENCES %I.skills(id) ON DELETE CASCADE,
         level VARCHAR(20) DEFAULT ''intermediate'',
         created_at TIMESTAMPTZ DEFAULT NOW(),
         UNIQUE(user_id, skill_id)
       )',
      tenant_schema,
      tenant_schema,
      tenant_schema
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_agent_skills_user ON %I.agent_skills(user_id)',
      tenant_schema
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_agent_skills_skill ON %I.agent_skills(skill_id)',
      tenant_schema
    );

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.conversation_helpers (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         conversation_id UUID REFERENCES %I.conversations(id) ON DELETE CASCADE,
         helper_user_id UUID REFERENCES %I.users(id),
         requested_by UUID REFERENCES %I.users(id),
         status VARCHAR(20) DEFAULT ''pending'',
         created_at TIMESTAMPTZ DEFAULT NOW(),
         accepted_at TIMESTAMPTZ,
         ended_at TIMESTAMPTZ,
         UNIQUE(conversation_id, helper_user_id)
       )',
      tenant_schema,
      tenant_schema,
      tenant_schema,
      tenant_schema
    );
  END LOOP;
END $$;
