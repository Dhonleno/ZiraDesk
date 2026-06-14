interface OrganizationFilter {
  search?: string | undefined;
  status?: string | undefined;
  segment?: string | undefined;
  responsible_id?: string | undefined;
  tag?: string | undefined;
}

interface BuildOrganizationFilterOptions {
  filter: OrganizationFilter;
  excludeIds?: string[] | undefined;
  startParamIndex?: number;
}

interface OrganizationFilterWhere {
  sql: string;
  params: unknown[];
}

export function buildOrganizationFilterWhere({
  filter,
  excludeIds = [],
  startParamIndex = 1,
}: BuildOrganizationFilterOptions): OrganizationFilterWhere {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = startParamIndex;

  if (filter.search) {
    conditions.push(
      `(o.name ILIKE $${paramIndex}
        OR o.email ILIKE $${paramIndex}
        OR o.document ILIKE $${paramIndex}
        OR o.phone ILIKE $${paramIndex})`,
    );
    params.push(`%${filter.search}%`);
    paramIndex++;
  }

  if (filter.status) {
    conditions.push(`o.status = $${paramIndex}`);
    params.push(filter.status);
    paramIndex++;
  }

  if (filter.segment) {
    conditions.push(`o.segment = $${paramIndex}`);
    params.push(filter.segment);
    paramIndex++;
  }

  if (filter.responsible_id) {
    conditions.push(`o.responsible_id = $${paramIndex}::uuid`);
    params.push(filter.responsible_id);
    paramIndex++;
  }

  if (filter.tag) {
    conditions.push(`$${paramIndex} = ANY(o.tags)`);
    params.push(filter.tag);
    paramIndex++;
  }

  if (excludeIds.length) {
    conditions.push(`o.id != ALL($${paramIndex}::uuid[])`);
    params.push(excludeIds);
  }

  return {
    sql: conditions.length > 0 ? conditions.join(' AND ') : 'TRUE',
    params,
  };
}
