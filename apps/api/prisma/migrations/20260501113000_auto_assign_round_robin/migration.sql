DO $$
DECLARE
  tenant_schema TEXT;
BEGIN
  FOR tenant_schema IN SELECT schema_name FROM tenants LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.agent_assignments (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         user_id UUID NOT NULL UNIQUE REFERENCES %I.users(id) ON DELETE CASCADE,
         last_assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         active_conversations INTEGER NOT NULL DEFAULT 0,
         is_available BOOLEAN NOT NULL DEFAULT true,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )',
      tenant_schema,
      tenant_schema
    );

    EXECUTE format(
      'INSERT INTO %I.agent_assignments (user_id)
       SELECT id
       FROM %I.users
       WHERE status = ''active''
         AND role IN (''owner'', ''admin'', ''agent'')
       ON CONFLICT (user_id) DO NOTHING',
      tenant_schema,
      tenant_schema
    );
  END LOOP;
END $$;

UPDATE tenants
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object(
    'auto_assign',
    CASE
      WHEN COALESCE(settings, '{}'::jsonb) ? 'auto_assign'
      THEN settings->'auto_assign'
      ELSE 'false'::jsonb
    END,
    'auto_assign_algorithm',
    to_jsonb(COALESCE(settings->>'auto_assign_algorithm', 'round_robin'))
  );
