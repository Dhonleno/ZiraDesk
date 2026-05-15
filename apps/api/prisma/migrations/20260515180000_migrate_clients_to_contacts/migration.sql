DO $$
DECLARE
  tenant_record RECORD;
  constraint_record RECORD;
  clients_has_notes BOOLEAN;
  notes_select_expr TEXT;
BEGIN
  FOR tenant_record IN
    SELECT schema_name
    FROM tenants
  LOOP
    -- Migração aplicável apenas a tenants que ainda possuem tabela legada `clients`.
    IF to_regclass(format('%I.clients', tenant_record.schema_name)) IS NULL THEN
      CONTINUE;
    END IF;

    -- Garante colunas novas em conversas/tickets antes do backfill.
    EXECUTE format('ALTER TABLE %I.conversations ADD COLUMN IF NOT EXISTS contact_id UUID', tenant_record.schema_name);
    EXECUTE format('ALTER TABLE %I.conversations ADD COLUMN IF NOT EXISTS organization_id UUID', tenant_record.schema_name);
    EXECUTE format('ALTER TABLE %I.tickets ADD COLUMN IF NOT EXISTS contact_id UUID', tenant_record.schema_name);
    EXECUTE format('ALTER TABLE %I.tickets ADD COLUMN IF NOT EXISTS organization_id UUID', tenant_record.schema_name);

    -- Migra clients -> contacts mantendo o mesmo ID para preservar vínculo histórico.
    IF to_regclass(format('%I.contacts', tenant_record.schema_name)) IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = tenant_record.schema_name
          AND table_name = 'clients'
          AND column_name = 'notes'
      )
      INTO clients_has_notes;

      notes_select_expr := CASE
        WHEN clients_has_notes THEN 'c.notes'
        ELSE 'NULL::text'
      END;

      EXECUTE format(
        'INSERT INTO %1$I.contacts (
           id, name, email, phone, whatsapp, document, tags, custom_fields, notes, created_at, updated_at
         )
         SELECT
           c.id,
           c.name,
           c.email,
           c.phone,
           c.phone AS whatsapp,
           c.document,
           COALESCE(c.tags, ''{}''::text[]),
           COALESCE(c.custom_fields, ''{}''::jsonb),
           %2$s,
           c.created_at,
           c.updated_at
         FROM %1$I.clients c
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           whatsapp = EXCLUDED.whatsapp,
           document = EXCLUDED.document,
           tags = EXCLUDED.tags,
           custom_fields = EXCLUDED.custom_fields,
           notes = EXCLUDED.notes,
           updated_at = GREATEST(%1$I.contacts.updated_at, EXCLUDED.updated_at)',
        tenant_record.schema_name,
        notes_select_expr
      );
    END IF;

    -- Conversas: client_id -> contact_id.
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = tenant_record.schema_name
        AND table_name = 'conversations'
        AND column_name = 'client_id'
    ) THEN
      EXECUTE format(
        'UPDATE %I.conversations
         SET contact_id = client_id
         WHERE contact_id IS NULL
           AND client_id IS NOT NULL',
        tenant_record.schema_name
      );

      FOR constraint_record IN
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = tenant_record.schema_name
          AND tc.table_name = 'conversations'
          AND kcu.column_name = 'client_id'
      LOOP
        EXECUTE format(
          'ALTER TABLE %I.conversations DROP CONSTRAINT IF EXISTS %I',
          tenant_record.schema_name,
          constraint_record.constraint_name
        );
      END LOOP;

      EXECUTE format(
        'ALTER TABLE %I.conversations DROP COLUMN IF EXISTS client_id',
        tenant_record.schema_name
      );
    END IF;

    -- Tickets: client_id -> contact_id.
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = tenant_record.schema_name
        AND table_name = 'tickets'
        AND column_name = 'client_id'
    ) THEN
      EXECUTE format(
        'UPDATE %I.tickets
         SET contact_id = client_id
         WHERE contact_id IS NULL
           AND client_id IS NOT NULL',
        tenant_record.schema_name
      );

      FOR constraint_record IN
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = tenant_record.schema_name
          AND tc.table_name = 'tickets'
          AND kcu.column_name = 'client_id'
      LOOP
        EXECUTE format(
          'ALTER TABLE %I.tickets DROP CONSTRAINT IF EXISTS %I',
          tenant_record.schema_name,
          constraint_record.constraint_name
        );
      END LOOP;

      EXECUTE format(
        'ALTER TABLE %I.tickets DROP COLUMN IF EXISTS client_id',
        tenant_record.schema_name
      );
    END IF;

    -- Limpa artefato legado.
    EXECUTE format('DROP TABLE IF EXISTS %I.clients', tenant_record.schema_name);
  END LOOP;
END $$;
