import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { redis } from '../../config/redis.js';
import type { SupportedLanguage } from '../../middleware/language.js';

const BCRYPT_COST = 12;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface UserResetJwtPayload {
  sub: string;
  schemaName: string;
  tenantSlug: string;
  type: 'user-reset';
}

export function generateUserResetToken(
  payload: UserResetJwtPayload,
  expiresIn: string = '1h',
): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

export function verifyUserResetToken(token: string): UserResetJwtPayload {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as UserResetJwtPayload;
    if (payload.type !== 'user-reset') throw new Error('invalid type');
    return payload;
  } catch {
    throw new Error('Token inválido ou expirado');
  }
}

const messages = {
  'pt-BR': {
    invalidCredentials: 'E-mail ou senha inválidos',
    userNotFound: 'Usuário não encontrado',
    tokenExpired: 'Sessão expirada, faça login novamente',
  },
  'en-US': {
    invalidCredentials: 'Invalid email or password',
    userNotFound: 'User not found',
    tokenExpired: 'Session expired, please login again',
  },
  es: {
    invalidCredentials: 'Correo o contraseña inválidos',
    userNotFound: 'Usuario no encontrado',
    tokenExpired: 'Sesión expirada, inicia sesión nuevamente',
  },
} satisfies Record<SupportedLanguage, { invalidCredentials: string; userNotFound: string; tokenExpired: string }>;

export function getAuthMessages(lang: SupportedLanguage) {
  return messages[lang];
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  issuedAtMs: number;
}

interface UserPayload {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_url?: string | null;
  tenantId?: string;
  schemaName?: string;
  isSuperAdmin: boolean;
}

function signTokens(payload: UserPayload): TokenPair {
  const issuedAtMs = Date.now();
  const base = {
    sub: payload.id,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    iatMs: issuedAtMs,
    isSuperAdmin: payload.isSuperAdmin,
    ...(payload.tenantId ? { tenantId: payload.tenantId } : {}),
    ...(payload.schemaName ? { schemaName: payload.schemaName } : {}),
  };

  const accessToken = jwt.sign(base, env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
  const refreshToken = jwt.sign(base, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });

  return { accessToken, refreshToken, issuedAtMs };
}

export async function loginWithEmailPassword(
  email: string,
  password: string,
  lang: SupportedLanguage = 'pt-BR',
  tenantSchemaName?: string,
  tenantId?: string,
): Promise<{ tokens: TokenPair; user: UserPayload }> {
  const msg = getAuthMessages(lang);

  // Tenta autenticar como super_admin primeiro (sem tenant)
  if (!tenantSchemaName) {
    const superAdmin = await prisma.superAdmin.findUnique({ where: { email } });

    if (superAdmin) {
      const valid = await bcrypt.compare(password, superAdmin.passwordHash);
      if (!valid) throw new Error(msg.invalidCredentials);

      const user: UserPayload = {
        id: superAdmin.id,
        name: superAdmin.name,
        email: superAdmin.email,
        role: 'super_admin',
        isSuperAdmin: true,
      };

      return { tokens: signTokens(user), user };
    }
  }

  // Autenticação de usuário de tenant
  // Usa nome qualificado de schema para evitar race condition com connection pool
  const schema = tenantSchemaName ?? 'public';
  const result = await prisma.$queryRawUnsafe<
    Array<{ id: string; name: string; email: string; role: string; avatar_url: string | null; password_hash: string }>
  >(`SELECT id, name, email, role, avatar_url, password_hash FROM "${schema}".users WHERE email = $1 LIMIT 1`, email);

  const dbUser = result[0];

  if (!dbUser) throw new Error(msg.invalidCredentials);

  const valid = await bcrypt.compare(password, dbUser.password_hash);
  if (!valid) throw new Error(msg.invalidCredentials);

  const user: UserPayload = {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
    avatar_url: dbUser.avatar_url,
    ...(tenantId ? { tenantId } : {}),
    ...(tenantSchemaName ? { schemaName: tenantSchemaName } : {}),
    isSuperAdmin: false,
  };

  return { tokens: signTokens(user), user };
}

export async function verifyRefreshToken(
  token: string,
  lang: SupportedLanguage = 'pt-BR',
): Promise<UserPayload> {
  const msg = getAuthMessages(lang);

  let payload: {
    sub: string;
    email: string;
    name: string;
    role: string;
    tenantId?: string;
    schemaName?: string;
    isSuperAdmin: boolean;
    iatMs?: number;
  };

  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as {
      sub: string;
      email: string;
      name: string;
      role: string;
      tenantId?: string;
      schemaName?: string;
      isSuperAdmin: boolean;
      iatMs?: number;
    };
  } catch {
    throw new Error(msg.tokenExpired);
  }

  const forcedLogoutAfterRaw = await redis.get(`auth:force_logout_after:${payload.sub}`);
  const forcedLogoutAfter = forcedLogoutAfterRaw ? Number(forcedLogoutAfterRaw) : Number.NaN;
  const tokenIatMs =
    typeof payload.iatMs === 'number'
      ? payload.iatMs
      : typeof (payload as { iat?: number }).iat === 'number'
        ? (payload as { iat: number }).iat * 1000
        : Number.NaN;
  if (Number.isFinite(forcedLogoutAfter) && Number.isFinite(tokenIatMs) && tokenIatMs < forcedLogoutAfter) {
    throw new Error(msg.tokenExpired);
  }

  if (payload.isSuperAdmin) {
    const superAdmin = await prisma.superAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true },
    });
    if (!superAdmin) throw new Error(msg.tokenExpired);

    return {
      id: superAdmin.id,
      name: superAdmin.name,
      email: superAdmin.email,
      role: 'super_admin',
      isSuperAdmin: true,
    };
  }

  if (!payload.tenantId) throw new Error(msg.tokenExpired);

  const tenant = await prisma.tenant.findUnique({
    where: { id: payload.tenantId },
    select: { schemaName: true, status: true },
  });
  if (!tenant || (tenant.status !== 'active' && tenant.status !== 'trial')) {
    throw new Error(msg.tokenExpired);
  }

  const schemaName = tenant.schemaName.replaceAll('"', '""');
  const users = await prisma.$queryRawUnsafe<
    Array<{ id: string; name: string; email: string; role: string; avatar_url: string | null }>
  >(
    `SELECT id, name, email, role, avatar_url
     FROM "${schemaName}".users
     WHERE id = $1::uuid AND status = 'active'
     LIMIT 1`,
    payload.sub,
  );
  const user = users[0];
  if (!user) throw new Error(msg.tokenExpired);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar_url: user.avatar_url,
    tenantId: payload.tenantId,
    schemaName: tenant.schemaName,
    isSuperAdmin: false,
  };
}

export function refreshAccessToken(payload: UserPayload): string {
  const base = {
    sub: payload.id,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    iatMs: Date.now(),
    isSuperAdmin: payload.isSuperAdmin,
    ...(payload.tenantId ? { tenantId: payload.tenantId } : {}),
    ...(payload.schemaName ? { schemaName: payload.schemaName } : {}),
  };

  return jwt.sign(base, env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export { REFRESH_TOKEN_TTL_SECONDS };
