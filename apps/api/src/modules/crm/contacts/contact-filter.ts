interface ContactFilter {
  search?: string | undefined;
  status?: string | undefined;
  tags?: string[] | undefined;
}

interface BuildContactFilterOptions {
  schemaName: string;
  filter: ContactFilter;
  excludeIds?: string[] | undefined;
  startParamIndex?: number;
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
}: BuildContactFilterOptions): ContactFilterWhere {
  const schema = quoteIdent(schemaName);
  const conditions = [
    `(NULLIF(BTRIM(ct.whatsapp), '') IS NOT NULL OR NULLIF(BTRIM(ct.phone), '') IS NOT NULL)`,
  ];
  const params: unknown[] = [];
  let paramIndex = startParamIndex;

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
        FROM ${schema}.organizations organization
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
        FROM ${schema}.contact_tag_assignments assignment
        WHERE assignment.contact_id = ct.id
          AND assignment.tag_id = ANY($${paramIndex}::uuid[])
      )`,
    );
    params.push(filter.tags);
    paramIndex++;
  }

  if (excludeIds.length) {
    conditions.push(`ct.id != ALL($${paramIndex}::uuid[])`);
    params.push(excludeIds);
  }

  return {
    sql: conditions.join(' AND '),
    params,
  };
}
