DO $$
DECLARE
  tenant_schema TEXT;
BEGIN
  FOR tenant_schema IN SELECT schema_name FROM tenants LOOP
    EXECUTE format(
      'ALTER TABLE %I.agent_assignments
         ALTER COLUMN is_available SET DEFAULT false,
         ALTER COLUMN status SET DEFAULT ''offline''',
      tenant_schema
    );
  END LOOP;
END $$;
