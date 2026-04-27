import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import type { SupportedLanguage } from '../../middleware/language.js';

const BCRYPT_COST = 12;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

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
}

interface UserPayload {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId?: string;
  isSuperAdmin: boolean;
}

function signTokens(payload: UserPayload): TokenPair {
  const base = {
    sub: payload.id,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    isSuperAdmin: payload.isSuperAdmin,
    ...(payload.tenantId ? { tenantId: payload.tenantId } : {}),
  };

  const accessToken = jwt.sign(base, env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
  const refreshToken = jwt.sign(base, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });

  return { accessToken, refreshToken };
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
    Array<{ id: string; name: string; email: string; role: string; password_hash: string }>
  >(`SELECT id, name, email, role, password_hash FROM "${schema}".users WHERE email = $1 LIMIT 1`, email);

  const dbUser = result[0];

  if (!dbUser) throw new Error(msg.invalidCredentials);

  const valid = await bcrypt.compare(password, dbUser.password_hash);
  if (!valid) throw new Error(msg.invalidCredentials);

  const user: UserPayload = {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
    ...(tenantId ? { tenantId } : {}),
    isSuperAdmin: false,
  };

  return { tokens: signTokens(user), user };
}

export function verifyRefreshToken(
  token: string,
  lang: SupportedLanguage = 'pt-BR',
): UserPayload {
  const msg = getAuthMessages(lang);

  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as {
      sub: string;
      email: string;
      name: string;
      role: string;
      tenantId?: string;
      isSuperAdmin: boolean;
    };

    const result: UserPayload = {
      id: payload.sub,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      isSuperAdmin: payload.isSuperAdmin,
    };
    if (payload.tenantId) result.tenantId = payload.tenantId;
    return result;
  } catch {
    throw new Error(msg.tokenExpired);
  }
}

export function refreshAccessToken(payload: UserPayload): string {
  const base = {
    sub: payload.id,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    isSuperAdmin: payload.isSuperAdmin,
    ...(payload.tenantId ? { tenantId: payload.tenantId } : {}),
  };

  return jwt.sign(base, env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export { REFRESH_TOKEN_TTL_SECONDS };
