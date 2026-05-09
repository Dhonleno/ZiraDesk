DO $$
DECLARE
  tenant_schema TEXT;
  assignments_table REGCLASS;
BEGIN
  FOR tenant_schema IN SELECT schema_name FROM tenants LOOP
    assignments_table := to_regclass(format('%I.agent_assignments', tenant_schema));
    IF assignments_table IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.agent_assignments
         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ',
      tenant_schema
    );

    EXECUTE format(
      'UPDATE %I.agent_assignments
       SET updated_at = COALESCE(updated_at, created_at, NOW())
       WHERE updated_at IS NULL',
      tenant_schema
    );

    EXECUTE format(
      'ALTER TABLE %I.agent_assignments
       ALTER COLUMN updated_at SET DEFAULT NOW()',
      tenant_schema
    );

    EXECUTE format(
      'ALTER TABLE %I.agent_assignments
       ALTER COLUMN updated_at SET NOT NULL',
      tenant_schema
    );
  END LOOP;
END $$;
