DO $$
DECLARE
  tenant_schema TEXT;
  old_constraint TEXT;
BEGIN
  FOR tenant_schema IN SELECT schema_name FROM tenants LOOP
    old_constraint := NULL;

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.agent_assignments (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         user_id UUID NOT NULL UNIQUE REFERENCES %I.users(id) ON DELETE CASCADE,
         last_assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         active_conversations INTEGER NOT NULL DEFAULT 0,
         is_available BOOLEAN NOT NULL DEFAULT true,
         status VARCHAR(20) NOT NULL DEFAULT ''online'',
         pause_reason VARCHAR(100),
         pause_started_at TIMESTAMPTZ,
         pause_notes TEXT,
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

    EXECUTE format(
      'ALTER TABLE %I.agent_assignments
       ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT ''online'',
       ADD COLUMN IF NOT EXISTS pause_reason VARCHAR(100),
       ADD COLUMN IF NOT EXISTS pause_started_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS pause_notes TEXT',
      tenant_schema
    );

    EXECUTE format(
      'UPDATE %I.agent_assignments
       SET status = CASE WHEN COALESCE(is_available, false) THEN ''online'' ELSE ''offline'' END
       WHERE status IS NULL OR status = ''''',
      tenant_schema
    );

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.pause_reasons (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         label VARCHAR(100) NOT NULL UNIQUE,
         icon VARCHAR(10) NOT NULL DEFAULT ''⏸️'',
         sort_order INTEGER NOT NULL DEFAULT 0,
         is_active BOOLEAN NOT NULL DEFAULT true,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )',
      tenant_schema
    );

    EXECUTE format(
      'INSERT INTO %I.pause_reasons (label, icon, sort_order)
       VALUES
         (''Almoço'', ''🍽️'', 1),
         (''Banheiro'', ''🚻'', 2),
         (''Reunião'', ''📋'', 3),
         (''Intervalo'', ''☕'', 4),
         (''Treinamento'', ''📚'', 5),
         (''Outro'', ''⏸️'', 99)
       ON CONFLICT (label) DO NOTHING',
      tenant_schema
    );

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.agent_pause_history (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         user_id UUID REFERENCES %I.users(id) ON DELETE SET NULL,
         pause_reason VARCHAR(100),
         started_at TIMESTAMPTZ NOT NULL,
         ended_at TIMESTAMPTZ,
         duration_seconds INTEGER,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )',
      tenant_schema,
      tenant_schema
    );

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.bot_options (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         bot_menu_id UUID REFERENCES %I.bot_menus(id) ON DELETE CASCADE,
         number INTEGER NOT NULL,
         label VARCHAR(100) NOT NULL,
         tag VARCHAR(50),
         response TEXT,
         sort_order INTEGER DEFAULT 0,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )',
      tenant_schema,
      tenant_schema
    );

    EXECUTE format(
      'ALTER TABLE %I.bot_options
       ADD COLUMN IF NOT EXISTS has_submenu BOOLEAN DEFAULT false,
       ADD COLUMN IF NOT EXISTS submenu_greeting TEXT,
       ADD COLUMN IF NOT EXISTS parent_option_id UUID REFERENCES %I.bot_options(id) ON DELETE CASCADE',
      tenant_schema,
      tenant_schema
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_bot_options_parent ON %I.bot_options(parent_option_id)',
      tenant_schema
    );

    SELECT con.conname
      INTO old_constraint
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = tenant_schema
      AND rel.relname = 'bot_options'
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname ORDER BY ord.ordinality)
        FROM unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
        JOIN pg_attribute att
          ON att.attrelid = rel.oid
         AND att.attnum = ord.attnum
      ) = ARRAY['bot_menu_id', 'number']
    LIMIT 1;

    IF old_constraint IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I.bot_options DROP CONSTRAINT %I', tenant_schema, old_constraint);
    END IF;

    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_options_unique_parent_number
       ON %I.bot_options (
         bot_menu_id,
         COALESCE(parent_option_id, ''00000000-0000-0000-0000-000000000000''::uuid),
         number
       )',
      tenant_schema
    );
  END LOOP;
END $$;
