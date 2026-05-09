DO $$
DECLARE
  tenant_schema TEXT;
BEGIN
  FOR tenant_schema IN SELECT schema_name FROM tenants LOOP
    EXECUTE format(
      'ALTER TABLE %I.agent_assignments
         ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ',
      tenant_schema
    );

    EXECUTE format(
      'UPDATE %I.agent_assignments
       SET last_seen_at = NOW()
       WHERE last_seen_at IS NULL',
      tenant_schema
    );
  END LOOP;
END $$;

