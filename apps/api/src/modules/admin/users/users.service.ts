import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../../config/database.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { redis } from '../../../config/redis.js';
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

type InviteEmailErrorCode = 'EMAIL_SEND_FAILED' | 'EMAIL_NOT_CONFIGURED';

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
  must_change_password: boolean;
}

interface InviteUserResult {
  user: UserRow;
  emailSent: boolean;
  tempPassword?: string | null;
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

  if (sendInviteEmail) {
    const canSendInviteEmail = await hasTenantEmailProvider(schemaName);
    if (!canSendInviteEmail) {
      logger.warn({ tenantId, email: data.email }, '[Invite] Email not configured');
      throw new InviteEmailError('EMAIL_NOT_CONFIGURED', 'E-mail não configurado para este tenant', 400);
    }
  }

  const usersRef = usersTable(schemaName);
  const existing = await prisma.$queryRawUnsafe<ExistingUserRow[]>(
    `SELECT id, name, role, status, password_hash, must_change_password
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

  const hasUserLimit = tenant.plan.maxUsers >= 0;
  if (willIncreaseActiveUsers && hasUserLimit && currentUsers >= tenant.plan.maxUsers) {
    throw new PlanLimitError(
      `Limite de ${tenant.plan.maxUsers} usuários atingido para o seu plano`,
    );
  }

  const previousUser = existing[0] ?? null;
  let user: UserRow;

  if (!sendInviteEmail) {
    // Super-admin flow: usa senha provisória para acesso imediato
    const tempPassword = randomBytes(9).toString('base64url').slice(0, 12);
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    if (!previousUser) {
      const created = await prisma.$queryRawUnsafe<UserRow[]>(
        `INSERT INTO ${usersRef} (name, email, password_hash, role, status, must_change_password)
         VALUES ($1, $2, $3, $4, 'active', true)
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
             password_hash = $3,
             must_change_password = true
         WHERE id = $4::uuid
         RETURNING id, name, email, role, status, last_seen_at, created_at`,
        data.name,
        previousUser.role === 'owner' ? 'owner' : data.role,
        passwordHash,
        previousUser.id,
      );
      user = updated[0]!;
    }
    return { user, emailSent: false, tempPassword };
  }

  // Fluxo regular: hash inutilizável — o usuário define a senha pelo link de convite
  const unusableHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);

  if (!previousUser) {
    const created = await prisma.$queryRawUnsafe<UserRow[]>(
      `INSERT INTO ${usersRef} (name, email, password_hash, role, status, must_change_password)
       VALUES ($1, $2, $3, $4, 'active', false)
       RETURNING id, name, email, role, status, last_seen_at, created_at`,
      data.name,
      data.email,
      unusableHash,
      data.role,
    );
    user = created[0]!;
  } else {
    const updated = await prisma.$queryRawUnsafe<UserRow[]>(
      `UPDATE ${usersRef}
       SET name = $1,
           role = $2,
           status = 'active',
           password_hash = $3,
           must_change_password = false
       WHERE id = $4::uuid
       RETURNING id, name, email, role, status, last_seen_at, created_at`,
      data.name,
      previousUser.role === 'owner' ? 'owner' : data.role,
      unusableHash,
      previousUser.id,
    );
    user = updated[0]!;
  }

  const inviteToken = jwt.sign(
    { sub: user.id, schemaName, tenantSlug: tenant.slug, type: 'user-reset' },
    env.JWT_SECRET,
    { expiresIn: '72h' },
  );
  const resetUrl = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${inviteToken}&invite=true`;

  logger.info({ tenantId, email: data.email }, '[Invite] Sending email with link');

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
            Você foi convidado para acessar o workspace
            <strong>${escapeHtml(tenant.name)}</strong> no ZiraDesk.
          </p>
          <p style="margin:0 0 10px;">Clique no botão abaixo para definir sua senha e acessar a plataforma:</p>
          <p style="margin:0 0 20px;">
            <a href="${escapeHtml(resetUrl)}"
               style="display:inline-block;padding:10px 20px;background:#00C9A7;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
              Definir minha senha
            </a>
          </p>
          <p style="margin:0 0 10px;color:#6b7280;font-size:13px;">O link expira em 72 horas.</p>
          <p style="margin:0;color:#6b7280;font-size:13px;">Se você não esperava este convite, ignore este e-mail.</p>
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
             password_hash = $4,
             must_change_password = $5
         WHERE id = $6::uuid`,
        previousUser.name,
        previousUser.role,
        previousUser.status,
        previousUser.password_hash,
        previousUser.must_change_password,
        previousUser.id,
      );
    }
    throw new InviteEmailError('EMAIL_SEND_FAILED', 'Falha ao enviar e-mail de convite', 502);
  }

  return { user, emailSent: true };
}

export async function updateUser(
  id: string,
  data: UpdateUserInput,
  schemaName: string,
  actor?: { id: string; role: Role },
) {
  const usersRef = usersTable(schemaName);
  const currentUser = await getUser(id, schemaName);

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

  if (data.role && data.role !== currentUser.role) {
    const forcedLogoutAt = Math.floor(Date.now() / 1000).toString();
    await Promise.all([
      redis.del(`refresh:${id}`),
      redis.set(`auth:force_logout_after:${id}`, forcedLogoutAt, 'EX', 60 * 60 * 24 * 30),
    ]);
  }

  return rows[0]!;
}

export async function resetUserPassword(
  id: string,
  tenantId: string,
  schemaName: string,
  options?: { allowOwner?: boolean },
) {
  const user = await getUser(id, schemaName);
  const usersRef = usersTable(schemaName);
  if (user.role === 'owner' && !options?.allowOwner) {
    throw new ForbiddenError('Não é possível redefinir a senha do proprietário da conta');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, slug: true },
  });
  if (!tenant) throw new NotFoundError('Tenant');

  const token = jwt.sign(
    { sub: user.id, schemaName, tenantSlug: tenant.slug, type: 'user-reset' },
    env.JWT_SECRET,
    { expiresIn: '24h' },
  );
  const resetUrl = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${token}`;

  await prisma.$executeRawUnsafe(
    `UPDATE ${usersRef} SET must_change_password = true WHERE id = $1::uuid`,
    id,
  );

  await sendEmail({
    tenantId,
    tenantSchema: schemaName,
    to: user.email,
    subject: 'Redefinição de senha',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#111827;">
        <h2 style="margin:0 0 12px;">Redefinição de senha</h2>
        <p style="margin:0 0 10px;">Olá, ${escapeHtml(user.name)}.</p>
        <p style="margin:0 0 10px;">
          O administrador solicitou a redefinição da sua senha no <strong>${escapeHtml(tenant.name)}</strong>.
        </p>
        <p style="margin:0 0 16px;">
          <a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:10px 20px;background:#00C9A7;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
            Redefinir senha
          </a>
        </p>
        <p style="margin:0 0 10px;">O link expira em 24 horas.</p>
        <p style="margin:0;color:#6b7280;font-size:13px;">Se você não esperava este e-mail, entre em contato com o suporte.</p>
      </div>
    `,
    from: { name: tenant.name },
  });

  logger.info({ tenantId, userId: id }, '[ResetPassword] Email sent');
  return { success: true };
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
