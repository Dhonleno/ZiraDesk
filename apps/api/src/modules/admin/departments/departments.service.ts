import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';

export interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  agent_count: number;
  created_at: Date;
}

export interface DepartmentOut {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  agentCount: number;
  createdAt: Date;
}

function mapDept(r: DepartmentRow): DepartmentOut {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isActive: r.is_active,
    agentCount: r.agent_count,
    createdAt: r.created_at,
  };
}

export interface AgentRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  avatar_url: string | null;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

function tableRef(schemaName: string, table: string): string {
  return `${quoteIdent(schemaName)}.${table}`;
}

async function resolveSchemaName(tenantId: string, schemaName?: string): Promise<string> {
  if (schemaName) return schemaName;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { schemaName: true },
  });

  if (!tenant) throw new NotFoundError('Tenant nao encontrado');
  return tenant.schemaName;
}

export async function listDepartments(tenantId: string, schemaName?: string): Promise<DepartmentOut[]> {
  const resolved = await resolveSchemaName(tenantId, schemaName);
  const deptRef = tableRef(resolved, 'departments');
  const adRef = tableRef(resolved, 'agent_departments');

  const rows = await prisma.$queryRawUnsafe<DepartmentRow[]>(
    `SELECT
       d.id,
       d.name,
       d.description,
       d.is_active,
       COUNT(DISTINCT ad.user_id)::integer AS agent_count,
       d.created_at
     FROM ${deptRef} d
     LEFT JOIN ${adRef} ad ON ad.department_id = d.id
     GROUP BY d.id, d.name, d.description, d.is_active, d.created_at
     ORDER BY d.name ASC`,
  );
  return rows.map(mapDept);
}

export async function createDepartment(
  tenantId: string,
  data: { name: string; description?: string },
  schemaName?: string,
): Promise<DepartmentRow> {
  const resolved = await resolveSchemaName(tenantId, schemaName);
  const deptRef = tableRef(resolved, 'departments');

  const rows = await prisma.$queryRawUnsafe<DepartmentRow[]>(
    `INSERT INTO ${deptRef} (name, description)
     VALUES ($1, $2)
     RETURNING id, name, description, is_active, 0::integer AS agent_count, created_at`,
    data.name,
    data.description ?? null,
  );

  return rows[0]!;
}

export async function updateDepartment(
  tenantId: string,
  id: string,
  data: Partial<{ name: string; description: string | null; isActive: boolean }>,
  schemaName?: string,
): Promise<DepartmentRow> {
  const resolved = await resolveSchemaName(tenantId, schemaName);
  const deptRef = tableRef(resolved, 'departments');

  const setParts: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [id];
  let idx = 2;

  if (data.name !== undefined) {
    setParts.push(`name = $${idx++}`);
    params.push(data.name);
  }
  if ('description' in data) {
    setParts.push(`description = $${idx++}`);
    params.push(data.description ?? null);
  }
  if (data.isActive !== undefined) {
    setParts.push(`is_active = $${idx++}`);
    params.push(data.isActive);
  }

  const rows = await prisma.$queryRawUnsafe<DepartmentRow[]>(
    `UPDATE ${deptRef}
     SET ${setParts.join(', ')}
     WHERE id = $1::uuid
     RETURNING id, name, description, is_active, 0::integer AS agent_count, created_at`,
    ...params,
  );

  if (!rows[0]) throw new NotFoundError('Departamento nao encontrado');
  return rows[0];
}

export async function deleteDepartment(tenantId: string, id: string, schemaName?: string): Promise<void> {
  const resolved = await resolveSchemaName(tenantId, schemaName);
  const deptRef = tableRef(resolved, 'departments');
  const adRef = tableRef(resolved, 'agent_departments');

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM ${adRef} WHERE department_id = $1::uuid`,
    id,
  );
  const count = Number(countRows[0]?.count ?? 0n);
  if (count > 0) throw new ConflictError('Departamento possui agentes vinculados');

  const deleted = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `DELETE FROM ${deptRef} WHERE id = $1::uuid RETURNING id`,
    id,
  );

  if (!deleted[0]) throw new NotFoundError('Departamento nao encontrado');
}

export async function addAgentToDepartment(
  tenantId: string,
  departmentId: string,
  userId: string,
  schemaName?: string,
): Promise<void> {
  const resolved = await resolveSchemaName(tenantId, schemaName);
  const adRef = tableRef(resolved, 'agent_departments');

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${adRef} (user_id, department_id)
     VALUES ($1::uuid, $2::uuid)
     ON CONFLICT (user_id, department_id) DO NOTHING`,
    userId,
    departmentId,
  );
}

export async function removeAgentFromDepartment(
  tenantId: string,
  departmentId: string,
  userId: string,
  schemaName?: string,
): Promise<void> {
  const resolved = await resolveSchemaName(tenantId, schemaName);
  const adRef = tableRef(resolved, 'agent_departments');

  await prisma.$executeRawUnsafe(
    `DELETE FROM ${adRef}
     WHERE user_id = $1::uuid
       AND department_id = $2::uuid`,
    userId,
    departmentId,
  );
}

export async function listDepartmentAgents(
  tenantId: string,
  departmentId: string,
  schemaName?: string,
): Promise<AgentRow[]> {
  const resolved = await resolveSchemaName(tenantId, schemaName);
  const adRef = tableRef(resolved, 'agent_departments');
  const usersRef = tableRef(resolved, 'users');

  return prisma.$queryRawUnsafe<AgentRow[]>(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.avatar_url
     FROM ${adRef} ad
     JOIN ${usersRef} u ON u.id = ad.user_id
     WHERE ad.department_id = $1::uuid
     ORDER BY u.name ASC`,
    departmentId,
  );
}
