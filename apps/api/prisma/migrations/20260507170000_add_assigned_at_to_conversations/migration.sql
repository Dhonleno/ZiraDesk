-- Add assigned_at to conversations (tracks when the current agent was assigned)
DO $$
DECLARE
  schema_rec RECORD;
BEGIN
  FOR schema_rec IN
    SELECT schema_name FROM public.tenants WHERE schema_name IS NOT NULL
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = schema_rec.schema_name
        AND table_name = 'conversations'
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = schema_rec.schema_name
          AND table_name = 'conversations'
          AND column_name = 'assigned_at'
      ) THEN
        EXECUTE format(
          'ALTER TABLE %I.conversations ADD COLUMN assigned_at TIMESTAMPTZ',
          schema_rec.schema_name
        );
      END IF;
    END IF;
  END LOOP;
END $$;
