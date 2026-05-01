DO $$
DECLARE
  tenant_schema TEXT;
BEGIN
  FOR tenant_schema IN SELECT schema_name FROM tenants LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I.agent_skills CASCADE', tenant_schema);
    EXECUTE format('DROP TABLE IF EXISTS %I.skills CASCADE', tenant_schema);

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.agent_bot_skills (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         user_id UUID REFERENCES %I.users(id) ON DELETE CASCADE,
         bot_option_id UUID REFERENCES %I.bot_options(id) ON DELETE CASCADE,
         level VARCHAR(20) DEFAULT ''intermediate'',
         created_at TIMESTAMPTZ DEFAULT NOW(),
         UNIQUE(user_id, bot_option_id)
       )',
      tenant_schema,
      tenant_schema,
      tenant_schema
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_agent_bot_skills_user ON %I.agent_bot_skills(user_id)',
      tenant_schema
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_agent_bot_skills_option ON %I.agent_bot_skills(bot_option_id)',
      tenant_schema
    );
  END LOOP;
END $$;
