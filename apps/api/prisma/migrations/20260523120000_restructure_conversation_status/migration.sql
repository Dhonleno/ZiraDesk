CREATE OR REPLACE FUNCTION public.restructure_conversation_status_for_schema(target_schema TEXT, fill_queue_entered_at BOOLEAN)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  has_status_column BOOLEAN;
  has_assigned_to_column BOOLEAN;
  has_created_at_column BOOLEAN;
  status_data_type TEXT;
  status_udt_schema TEXT;
  status_udt_name TEXT;
  enum_labels TEXT[];
BEGIN
  IF to_regclass(format('%I.conversations', target_schema)) IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('search_path', format('%I, public', target_schema), true);

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = target_schema
      AND table_name = 'conversations'
      AND column_name = 'status'
  ) INTO has_status_column;

  IF NOT has_status_column THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = target_schema
        AND t.typname = 'conversation_status'
    ) THEN
      EXECUTE format(
        'CREATE TYPE %I.conversation_status AS ENUM (''open'', ''waiting'', ''closed'')',
        target_schema
      );
    END IF;

    EXECUTE format(
      'ALTER TABLE conversations ADD COLUMN status %I.conversation_status NOT NULL DEFAULT ''open''',
      target_schema
    );
  ELSE
    SELECT data_type, udt_schema, udt_name
    INTO status_data_type, status_udt_schema, status_udt_name
    FROM information_schema.columns
    WHERE table_schema = target_schema
      AND table_name = 'conversations'
      AND column_name = 'status';

    SELECT array_agg(e.enumlabel::TEXT ORDER BY e.enumsortorder)
    INTO enum_labels
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = target_schema
      AND t.typname = 'conversation_status';

    IF NOT (
      status_data_type = 'USER-DEFINED'
      AND status_udt_schema = target_schema
      AND status_udt_name = 'conversation_status'
      AND enum_labels = ARRAY['open', 'waiting', 'closed']::TEXT[]
    ) THEN
      EXECUTE format('DROP TYPE IF EXISTS %I.conversation_status_new', target_schema);
      EXECUTE format(
        'CREATE TYPE %I.conversation_status_new AS ENUM (''open'', ''waiting'', ''closed'')',
        target_schema
      );

      EXECUTE 'ALTER TABLE conversations ALTER COLUMN status DROP DEFAULT';

      IF status_data_type = 'USER-DEFINED' THEN
        -- Keep the required data UPDATE before ALTER TYPE where the old enum can represent the target value.
        EXECUTE format(
          'UPDATE conversations
              SET status = CASE
                WHEN status::text IN (''open'', ''in_service'', ''pending'', ''bot'') THEN ''open''::%I.%I
                WHEN status::text IN (''resolved'', ''closed'') THEN ''closed''::%I.%I
                ELSE status
              END
            WHERE status::text IN (''open'', ''in_service'', ''pending'', ''bot'', ''resolved'', ''closed'')',
          status_udt_schema,
          status_udt_name,
          status_udt_schema,
          status_udt_name
        );
      ELSE
        -- Required data UPDATE before ALTER TYPE for the current VARCHAR/TEXT implementation.
        EXECUTE
          'UPDATE conversations
              SET status = CASE
                WHEN status::text IN (''open'', ''in_service'', ''pending'', ''bot'') THEN ''open''
                WHEN status::text = ''active_outbound'' THEN ''waiting''
                WHEN status::text IN (''resolved'', ''closed'') THEN ''closed''
                ELSE ''open''
              END
            WHERE status::text IN (''open'', ''in_service'', ''pending'', ''bot'', ''active_outbound'', ''resolved'', ''closed'')
               OR status IS NULL';
      END IF;

      EXECUTE format(
        'ALTER TABLE conversations
           ALTER COLUMN status TYPE %I.conversation_status_new
           USING (
             CASE
               WHEN status::text IN (''open'', ''in_service'', ''pending'', ''bot'') THEN ''open''
               WHEN status::text = ''active_outbound'' THEN ''waiting''
               WHEN status::text IN (''resolved'', ''closed'') THEN ''closed''
               ELSE ''open''
             END
           )::%I.conversation_status_new',
        target_schema,
        target_schema
      );

      IF status_data_type = 'USER-DEFINED' AND status_udt_schema = target_schema THEN
        EXECUTE format('DROP TYPE IF EXISTS %I.%I', status_udt_schema, status_udt_name);
      ELSE
        EXECUTE format('DROP TYPE IF EXISTS %I.conversation_status', target_schema);
      END IF;

      EXECUTE format(
        'ALTER TYPE %I.conversation_status_new RENAME TO conversation_status',
        target_schema
      );
      EXECUTE format(
        'ALTER TABLE conversations ALTER COLUMN status SET DEFAULT ''open''::%I.conversation_status',
        target_schema
      );
    END IF;
  END IF;

  EXECUTE
    'ALTER TABLE conversations
       ADD COLUMN IF NOT EXISTS closure_reason JSONB,
       ADD COLUMN IF NOT EXISTS waiting_expires_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS queue_entered_at TIMESTAMPTZ';

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = target_schema
      AND table_name = 'conversations'
      AND column_name = 'assigned_to'
  ) INTO has_assigned_to_column;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = target_schema
      AND table_name = 'conversations'
      AND column_name = 'created_at'
  ) INTO has_created_at_column;

  IF fill_queue_entered_at AND has_assigned_to_column AND has_created_at_column THEN
    EXECUTE
      'UPDATE conversations
          SET queue_entered_at = created_at
        WHERE assigned_to IS NULL
          AND status::text = ''open''
          AND queue_entered_at IS NULL';
  END IF;
END;
$$;

SELECT public.restructure_conversation_status_for_schema('public', false);

DO $$
DECLARE
  tenant_record RECORD;
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RETURN;
  END IF;

  FOR tenant_record IN
    SELECT schema_name
    FROM public.tenants
    WHERE schema_name IS NOT NULL
  LOOP
    PERFORM public.restructure_conversation_status_for_schema(tenant_record.schema_name, true);
  END LOOP;
END $$;

DROP FUNCTION public.restructure_conversation_status_for_schema(TEXT, BOOLEAN);
