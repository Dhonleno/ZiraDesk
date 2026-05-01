DO $$
DECLARE
  tenant_schema TEXT;
BEGIN
  FOR tenant_schema IN SELECT schema_name FROM tenants LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.conversation_tags (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         name VARCHAR(50) NOT NULL,
         color VARCHAR(7) NOT NULL DEFAULT ''#00C9A7'',
         is_active BOOLEAN NOT NULL DEFAULT true,
         sort_order INTEGER NOT NULL DEFAULT 0,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE(name)
       )',
      tenant_schema
    );

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.conversation_tag_assignments (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         conversation_id UUID REFERENCES %I.conversations(id) ON DELETE CASCADE,
         tag_id UUID REFERENCES %I.conversation_tags(id) ON DELETE CASCADE,
         assigned_by UUID REFERENCES %I.users(id),
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE(conversation_id, tag_id)
       )',
      tenant_schema,
      tenant_schema,
      tenant_schema,
      tenant_schema
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_tag_assignments_conv ON %I.conversation_tag_assignments(conversation_id)',
      tenant_schema
    );

    EXECUTE format(
      'INSERT INTO %I.conversation_tags (name, color, sort_order)
       VALUES
         (''Urgente'', ''#EF4444'', 1),
         (''VIP'', ''#F59E0B'', 2),
         (''Aguardando cliente'', ''#3B82F6'', 3),
         (''Proposta enviada'', ''#8B5CF6'', 4),
         (''Bug'', ''#EC4899'', 5),
         (''Resolvido'', ''#10B981'', 6)
       ON CONFLICT (name) DO NOTHING',
      tenant_schema
    );
  END LOOP;
END $$;
