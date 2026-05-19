import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../../config/database.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { hasTenantEmailProvider, sendEmail } from '../../../services/email.service.js';
import type { InviteUserInput, UpdateUserInput, ListUsersQuery } from './users.schema.js';
import type { Role } from '@ziradesk/shared';

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanLimitError';
  }
}

type InviteEmailErrorCode = 'EMAIL_SEND_FAILED';

export class InviteEmailError extends Error {
  code: InviteEmailErrorCode;
  statusCode: number;

  constructor(code: InviteEmailErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = 'InviteEmailError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

type RoleUpdateErrorCode = 'CANNOT_CHANGE_OWN_ROLE' | 'ONLY_OWNER_CAN_ASSIGN_OWNER';

export class RoleUpdateError extends Error {
  code: RoleUpdateErrorCode;

  constructor(code: RoleUpdateErrorCode, message: string) {
    super(message);
    this.name = 'RoleUpdateError';
    this.code = code;
  }
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  last_seen_at: Date | null;
  created_at: Date;
}

interface ExistingUserRow {
  id: string;
  name: string;
  role: string;
  status: string;
  password_hash: string;
}

interface InviteUserResult {
  user: UserRow;
  tempPassword: string | null;
  emailSent: boolean;
  warning?: 'EMAIL_NOT_CONFIGURED';
}

function validateSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new ForbiddenError('Schema do tenant inválido');
  }
  return schemaName;
}

function usersTable(schemaName: string): string {
  return `"${validateSchemaName(schemaName)}".users`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function listUsers(query: ListUsersQuery, schemaName: string) {
  const { page, per_page, search, role, status } = query;
  const offset = (page - 1) * per_page;
  const searchParam = search ?? null;
  const roleParam = role ?? null;
  const statusParam = status ?? null;
  const usersRef = usersTable(schemaName);

  const rows = await prisma.$queryRawUnsafe<UserRow[]>(
    `SELECT id, name, email, role, status, last_seen_at, created_at
     FROM ${usersRef}
     WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR role = $2)
       AND ($3::text IS NULL OR status = $3)
     ORDER BY created_at DESC
     LIMIT $4 OFFSET $5`,
    searchParam,
    roleParam,
    statusParam,
    per_page,
    offset,
  );

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count FROM ${usersRef}
     WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR role = $2)
       AND ($3::text IS NULL OR status = $3)`,
    searchParam,
    roleParam,
    statusParam,
  );

  const total = Number(countRows[0]?.count ?? 0);
  return {
    data: rows,
    meta: { total, page, per_page, total_pages: Math.ceil(total / per_page) },
  };
}

export async function getUser(id: string, schemaName: string) {
  const usersRef = usersTable(schemaName);
  const rows = await prisma.$queryRawUnsafe<UserRow[]>(
    `SELECT id, name, email, role, status, last_seen_at, created_at FROM ${usersRef} WHERE id = $1::uuid LIMIT 1`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Usuário');
  return rows[0];
}

export async function inviteUser(
  data: InviteUserInput,
  tenantId: string,
  schemaName: string,
  options?: { sendInviteEmail?: boolean },
): Promise<InviteUserResult> {
  const sendInviteEmail = options?.sendInviteEmail ?? true;
  const canSendInviteEmail = sendInviteEmail
    ? await hasTenantEmailProvider(schemaName)
    : false;

  if (sendInviteEmail && !canSendInviteEmail) {
    logger.warn(
      { tenantId, email: data.email },
      '[Invite] Email not configured — returning temp password',
    );
  }

  const usersRef = usersTable(schemaName);
  const existing = await prisma.$queryRawUnsafe<ExistingUserRow[]>(
    `SELECT id, name, role, status, password_hash
       FROM ${usersRef}
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
    data.email,
  );
  if (existing[0]?.status === 'active') {
    throw new ConflictError('E-mail já cadastrado neste tenant');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { plan: { select: { maxUsers: true } } },
  });
  if (!tenant) throw new NotFoundError('Tenant');

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count FROM ${usersRef} WHERE status = 'active'`,
  );
  const currentUsers = Number(countRows[0]?.count ?? 0);
  const willIncreaseActiveUsers = existing[0]?.status !== 'active';

  if (willIncreaseActiveUsers && currentUsers >= tenant.plan.maxUsers) {
    throw new PlanLimitError(
      `Limite de ${tenant.plan.maxUsers} usuários atingido para o seu plano`,
    );
  }

  const tempPassword = randomBytes(9).toString('base64url').slice(0, 12);
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const previousUser = existing[0] ?? null;
  let user: UserRow;

  if (!previousUser) {
    const created = await prisma.$queryRawUnsafe<UserRow[]>(
      `INSERT INTO ${usersRef} (name, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, name, email, role, status, last_seen_at, created_at`,
      data.name,
      data.email,
      passwordHash,
      data.role,
    );
    user = created[0]!;
  } else {
    const updated = await prisma.$queryRawUnsafe<UserRow[]>(
      `UPDATE ${usersRef}
       SET name = $1,
           role = $2,
           status = 'active',
           password_hash = $3
       WHERE id = $4::uuid
       RETURNING id, name, email, role, status, last_seen_at, created_at`,
      data.name,
      previousUser.role === 'owner' ? 'owner' : data.role,
      passwordHash,
      previousUser.id,
    );
    user = updated[0]!;
  }

  if (!sendInviteEmail) {
    return { user, tempPassword, emailSent: false };
  }

  if (!canSendInviteEmail) {
    return {
      user,
      tempPassword,
      emailSent: false,
      warning: 'EMAIL_NOT_CONFIGURED',
    };
  }

  const loginUrl = `${env.APP_URL.replace(/\/$/, '')}/login`;

  logger.info({ tenantId, email: data.email }, '[Invite] Sending email');

  try {
    await sendEmail({
      tenantId,
      tenantSchema: schemaName,
      to: user.email,
      subject: 'Convite para acessar o ZiraDesk',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#111827;">
          <h2 style="margin:0 0 12px;">Convite de acesso</h2>
          <p style="margin:0 0 10px;">Olá, ${escapeHtml(user.name)}.</p>
          <p style="margin:0 0 10px;">
            Você foi convidado para acessar o workspace <strong>${escapeHtml(tenant.name)}</strong> no ZiraDesk.
          </p>
          <p style="margin:0 0 10px;"><strong>E-mail:</strong> ${escapeHtml(user.email)}</p>
          <p style="margin:0 0 10px;"><strong>Senha temporária:</strong> <code>${escapeHtml(tempPassword)}</code></p>
          <p style="margin:0 0 10px;">Faça login em: <a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a></p>
          <p style="margin:0;">Por segurança, altere essa senha após o primeiro acesso.</p>
        </div>
      `,
      from: { name: tenant.name },
    });

    logger.info({ tenantId, email: data.email }, '[Invite] Email sent');
  } catch (sendError) {
    logger.error({ tenantId, email: data.email, err: sendError }, '[Invite] Email send failed');

    if (!previousUser) {
      await prisma.$executeRawUnsafe(`DELETE FROM ${usersRef} WHERE id = $1::uuid`, user.id);
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE ${usersRef}
         SET name = $1,
             role = $2,
             status = $3,
             password_hash = $4
         WHERE id = $5::uuid`,
        previousUser.name,
        previousUser.role,
        previousUser.status,
        previousUser.password_hash,
        previousUser.id,
      );
    }
    throw new InviteEmailError('EMAIL_SEND_FAILED', 'Falha ao enviar e-mail de convite', 502);
  }

  return { user, tempPassword: null, emailSent: true };
}

export async function updateUser(
  id: string,
  data: UpdateUserInput,
  schemaName: string,
  actor?: { id: string; role: Role },
) {
  const usersRef = usersTable(schemaName);
  await getUser(id, schemaName);

  if (data.role) {
    if (actor?.id === id) {
      throw new RoleUpdateError('CANNOT_CHANGE_OWN_ROLE', 'Você não pode alterar seu próprio perfil');
    }

    if (data.role === 'owner' && actor?.role !== 'owner') {
      throw new RoleUpdateError('ONLY_OWNER_CAN_ASSIGN_OWNER', 'Apenas owners podem atribuir o perfil owner');
    }
  }

  const rows = await prisma.$queryRawUnsafe<UserRow[]>(
    `UPDATE ${usersRef}
     SET name   = COALESCE($1, name),
         role   = COALESCE($2, role),
         status = COALESCE($3, status)
     WHERE id = $4::uuid
     RETURNING id, name, email, role, status, last_seen_at, created_at`,
    data.name ?? null,
    data.role ?? null,
    data.status ?? null,
    id,
  );

  if ('max_conversations' in data) {
    await prisma.$executeRawUnsafe(
      `UPDATE "${schemaName}".agent_assignments
       SET max_conversations = $2
       WHERE user_id = $1::uuid`,
      id,
      data.max_conversations ?? null,
    );
  }

  return rows[0]!;
}

export async function resetUserPassword(
  id: string,
  schemaName: string,
  options?: { allowOwner?: boolean },
) {
  const user = await getUser(id, schemaName);
  const usersRef = usersTable(schemaName);
  if (user.role === 'owner' && !options?.allowOwner) {
    throw new ForbiddenError('Não é possível redefinir a senha do proprietário da conta');
  }

  const tempPassword = randomBytes(9).toString('base64url').slice(0, 12);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  await prisma.$executeRawUnsafe(
    `UPDATE ${usersRef} SET password_hash = $1 WHERE id = $2::uuid`,
    passwordHash,
    id,
  );

  return { tempPassword };
}

export async function deleteUser(id: string, requesterId: string, schemaName: string) {
  if (id === requesterId) {
    throw new ForbiddenError('Você não pode remover a si mesmo');
  }

  const user = await getUser(id, schemaName);
  const usersRef = usersTable(schemaName);
  if (user.role === 'owner') {
    throw new ForbiddenError('Não é possível remover o proprietário da conta');
  }

  const rows = await prisma.$queryRawUnsafe<UserRow[]>(
    `UPDATE ${usersRef} SET status = 'inactive' WHERE id = $1::uuid
     RETURNING id, name, email, role, status, last_seen_at, created_at`,
    id,
  );
  return rows[0]!;
}
