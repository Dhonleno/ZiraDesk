DO $$
DECLARE
  tenant_schema TEXT;
BEGIN
  IF to_regclass('public.conversations') IS NOT NULL THEN
    ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS csat_expires_at TIMESTAMPTZ;
  END IF;

  IF to_regclass('public.tenants') IS NOT NULL THEN
    FOR tenant_schema IN
      SELECT schema_name
      FROM public.tenants
    LOOP
      EXECUTE format(
        'ALTER TABLE IF EXISTS %I.conversations ADD COLUMN IF NOT EXISTS csat_expires_at TIMESTAMPTZ',
        tenant_schema
      );
    END LOOP;
  END IF;
END $$;
