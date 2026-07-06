interface ContactFilter {
  search?: string | undefined;
  status?: string | undefined;
  tags?: string[] | undefined;
  organization_id?: string | undefined;
  standalone_only?: boolean | undefined;
  linked_only?: boolean | undefined;
}

interface BuildContactFilterOptions {
  schemaName?: string;
  filter: ContactFilter;
  excludeIds?: string[] | undefined;
  startParamIndex?: number;
  requirePhone?: boolean;
}

interface ContactFilterWhere {
  sql: string;
  params: unknown[];
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function buildContactFilterWhere({
  schemaName,
  filter,
  excludeIds = [],
  startParamIndex = 1,
  requirePhone = true,
}: BuildContactFilterOptions): ContactFilterWhere {
  const tablePrefix = schemaName ? `${quoteIdent(schemaName)}.` : '';
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = startParamIndex;

  if (requirePhone) {
    conditions.push(
      `(NULLIF(BTRIM(ct.whatsapp), '') IS NOT NULL OR NULLIF(BTRIM(ct.phone), '') IS NOT NULL)`,
    );
  }

  if (filter.organization_id) {
    conditions.push(`ct.organization_id = $${paramIndex}::uuid`);
    params.push(filter.organization_id);
    paramIndex++;
  }

  if (filter.search) {
    conditions.push(
      `(ct.name ILIKE $${paramIndex}
        OR ct.email ILIKE $${paramIndex}
        OR ct.whatsapp ILIKE $${paramIndex}
        OR ct.phone ILIKE $${paramIndex})`,
    );
    params.push(`%${filter.search}%`);
    paramIndex++;
  }

  if (filter.status) {
    conditions.push(
      `EXISTS (
        SELECT 1
        FROM ${tablePrefix}organizations organization
        WHERE organization.id = ct.organization_id
          AND organization.status = $${paramIndex}
      )`,
    );
    params.push(filter.status);
    paramIndex++;
  }

  if (filter.tags?.length) {
    conditions.push(
      `EXISTS (
        SELECT 1
        FROM ${tablePrefix}contact_tag_assignments assignment
        JOIN ${tablePrefix}contact_tags contact_tag ON contact_tag.id = assignment.tag_id
        WHERE assignment.contact_id = ct.id
          AND (
            contact_tag.id::text = ANY($${paramIndex}::text[])
            OR contact_tag.name = ANY($${paramIndex}::text[])
          )
      )`,
    );
    params.push(filter.tags);
    paramIndex++;
  }

  if (filter.standalone_only) {
    conditions.push('ct.organization_id IS NULL');
  } else if (filter.linked_only) {
    conditions.push('ct.organization_id IS NOT NULL');
  }

  if (excludeIds.length) {
    conditions.push(`ct.id != ALL($${paramIndex}::uuid[])`);
    params.push(excludeIds);
  }

  return {
    sql: conditions.length > 0 ? conditions.join(' AND ') : 'TRUE',
    params,
  };
}
