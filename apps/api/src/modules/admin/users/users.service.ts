import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { Resend } from 'resend';
import { prisma } from '../../../config/database.js';
import { env } from '../../../config/env.js';
import type { InviteUserInput, UpdateUserInput, ListUsersQuery } from './users.schema.js';

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

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  last_seen_at: Date | null;
  created_at: Date;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function listUsers(query: ListUsersQuery) {
  const { page, per_page, search, role, status } = query;
  const offset = (page - 1) * per_page;
  const searchParam = search ?? null;
  const roleParam = role ?? null;
  const statusParam = status ?? null;

  const rows = await prisma.$queryRawUnsafe<UserRow[]>(
    `SELECT id, name, email, role, status, last_seen_at, created_at
     FROM users
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
    `SELECT COUNT(*) AS count FROM users
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

export async function getUser(id: string) {
  const rows = await prisma.$queryRawUnsafe<UserRow[]>(
    `SELECT id, name, email, role, status, last_seen_at, created_at FROM users WHERE id = $1::uuid LIMIT 1`,
    id,
  );
  if (!rows[0]) throw new NotFoundError('Usuário');
  return rows[0];
}

export async function inviteUser(data: InviteUserInput, tenantId: string) {
  const existing = await prisma.$queryRawUnsafe<[{ id: string }]>(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    data.email,
  );
  if (existing[0]) throw new ConflictError('E-mail já cadastrado neste tenant');

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { plan: { select: { maxUsers: true } } },
  });
  if (!tenant) throw new NotFoundError('Tenant');

  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) AS count FROM users WHERE status = 'active'`,
  );
  const currentUsers = Number(countRows[0]?.count ?? 0);

  if (currentUsers >= tenant.plan.maxUsers) {
    throw new PlanLimitError(
      `Limite de ${tenant.plan.maxUsers} usuários atingido para o seu plano`,
    );
  }

  const tempPassword = randomBytes(9).toString('base64url').slice(0, 12);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  if (!env.RESEND_API_KEY) {
    throw new ConflictError('Envio de convite por e-mail não configurado. Defina RESEND_API_KEY.');
  }

  const created = await prisma.$queryRawUnsafe<UserRow[]>(
    `INSERT INTO users (name, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING id, name, email, role, status, last_seen_at, created_at`,
    data.name,
    data.email,
    passwordHash,
    data.role,
  );

  const user = created[0]!;
  const resend = new Resend(env.RESEND_API_KEY);
  const fromEmail = env.RESEND_FROM_EMAIL || `suporte@${tenant.slug}.ziradesk.com.br`;
  const loginUrl = `${env.APP_URL.replace(/\/$/, '')}/login`;

  try {
    const { error } = await resend.emails.send({
      from: `ZiraDesk <${fromEmail}>`,
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
    });

    if (error) {
      throw new Error(error.message);
    }
  } catch (sendError) {
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, user.id);

    const reason = sendError instanceof Error ? sendError.message : 'erro desconhecido';
    throw new ConflictError(
      `Não foi possível enviar o convite por e-mail (${reason}). Verifique RESEND_FROM_EMAIL/domínio no Resend e tente novamente.`,
    );
  }

  return { user, tempPassword };
}

export async function updateUser(id: string, data: UpdateUserInput, schemaName?: string) {
  await getUser(id);

  const rows = await prisma.$queryRawUnsafe<UserRow[]>(
    `UPDATE users
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

  if ('max_conversations' in data && schemaName) {
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

export async function resetUserPassword(id: string) {
  const user = await getUser(id);
  if (user.role === 'owner') {
    throw new ForbiddenError('Não é possível redefinir a senha do proprietário da conta');
  }

  const tempPassword = randomBytes(9).toString('base64url').slice(0, 12);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  await prisma.$executeRawUnsafe(
    `UPDATE users SET password_hash = $1 WHERE id = $2::uuid`,
    passwordHash,
    id,
  );

  return { tempPassword };
}

export async function deleteUser(id: string, requesterId: string) {
  if (id === requesterId) {
    throw new ForbiddenError('Você não pode remover a si mesmo');
  }

  const user = await getUser(id);
  if (user.role === 'owner') {
    throw new ForbiddenError('Não é possível remover o proprietário da conta');
  }

  const rows = await prisma.$queryRawUnsafe<UserRow[]>(
    `UPDATE users SET status = 'inactive' WHERE id = $1::uuid
     RETURNING id, name, email, role, status, last_seen_at, created_at`,
    id,
  );
  return rows[0]!;
}
