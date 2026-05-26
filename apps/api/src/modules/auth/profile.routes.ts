import multipart from '@fastify/multipart';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantSchemaFromJwt } from '../../middleware/tenantSchemaFromJwt.js';
import { quoteIdent } from '../omnichannel/conversations/protocols.js';
import { getStorage } from '../../lib/storage/index.js';
import {
  getUserLgpdState,
  updateUserLgpdConsent,
  exportUserLgpdData,
  submitUserAnonymizeRequest,
  listUserLgpdRequests,
  ForbiddenError as LgpdForbiddenError,
} from '../admin/users/users.lgpd.service.js';
import { ensureUsersLgpdInfrastructure } from '../admin/users/users.infrastructure.js';
import { updateUserLgpdConsentSchema, submitAnonymizeRequestSchema, exportUserLgpdQuerySchema } from '../admin/users/users.schema.js';

const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  language: z.enum(['pt-BR', 'en-US', 'es']).optional(),
  notification_sound: z.boolean().optional(),
  notification_desktop: z.boolean().optional(),
});

const passwordUpdateSchema = z
  .object({
    current_password: z.string().optional(),
    new_password: z.string().optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().optional(),
  })
  .transform((value) => ({
    current_password: value.current_password ?? value.currentPassword ?? '',
    new_password: value.new_password ?? value.newPassword ?? '',
  }));

function avatarExtFromMime(mimeType: string): 'jpg' | 'png' | 'webp' {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function avatarMimeFromFileName(fileName: string): string {
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.webp')) return 'image/webp';
  if (fileName.endsWith('.jpg')) return 'image/jpeg';
  return 'application/octet-stream';
}

async function ensureUserProfileColumns(schemaName: string): Promise<void> {
  const usersRef = `${quoteIdent(schemaName)}.users`;

  await prisma.$executeRawUnsafe(`
    ALTER TABLE ${usersRef}
    ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS bio TEXT,
    ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
    ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'pt-BR',
    ADD COLUMN IF NOT EXISTS notification_sound BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS notification_desktop BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);
}

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_AVATAR_SIZE,
      files: 1,
    },
  });

  const guard = [authMiddleware, tenantSchemaFromJwt];

  app.get<{ Params: { fileName: string } }>('/me/avatar/:fileName', async (request, reply) => {
    const { fileName } = request.params;
    if (!/^[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(fileName)) {
      return reply.code(404).send({ success: false, error: { message: 'Avatar não encontrado' } });
    }
    try {
      const file = await getStorage().download(`avatars/${fileName}`);
      reply.header('Content-Type', avatarMimeFromFileName(fileName));
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(file);
    } catch {
      return reply.code(404).send({ success: false, error: { message: 'Avatar não encontrado' } });
    }
  });

  app.get('/me', { preHandler: guard }, async (request, reply) => {
    if (request.user.isSuperAdmin) {
      return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    }

    const schemaName = request.user.schemaName;
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    await ensureUserProfileColumns(schemaName);

    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      email: string;
      role: string;
      avatar_url: string | null;
      bio: string | null;
      phone: string | null;
      language: string | null;
      notification_sound: boolean | null;
      notification_desktop: boolean | null;
      status: string;
      created_at: Date;
    }>>(
      `SELECT
         id, name, email, role, avatar_url, bio, phone, language,
         notification_sound, notification_desktop, status, created_at
       FROM ${quoteIdent(schemaName)}.users
       WHERE id = $1::uuid
       LIMIT 1`,
      request.user.id,
    );

    const user = rows[0];
    if (!user) {
      return reply.code(404).send({ success: false, error: { message: 'Usuário não encontrado' } });
    }

    return reply.send({ success: true, data: user });
  });

  app.patch('/me', { preHandler: guard }, async (request, reply) => {
    if (request.user.isSuperAdmin) {
      return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    }

    const schemaName = request.user.schemaName;
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    const parsed = profileUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Dados inválidos', details: parsed.error.flatten() },
      });
    }

    await ensureUserProfileColumns(schemaName);
    const payload = parsed.data;

    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      email: string;
      role: string;
      avatar_url: string | null;
      bio: string | null;
      phone: string | null;
      language: string | null;
      notification_sound: boolean | null;
      notification_desktop: boolean | null;
      status: string;
      created_at: Date;
    }>>(
      `UPDATE ${quoteIdent(schemaName)}.users
       SET
         name = COALESCE($1::text, name),
         bio = CASE WHEN $2::text IS NULL THEN bio ELSE NULLIF($2::text, '') END,
         phone = CASE WHEN $3::text IS NULL THEN phone ELSE NULLIF($3::text, '') END,
         language = COALESCE($4::text, language),
         notification_sound = COALESCE($5::boolean, notification_sound),
         notification_desktop = COALESCE($6::boolean, notification_desktop),
         updated_at = NOW()
       WHERE id = $7::uuid
       RETURNING
         id, name, email, role, avatar_url, bio, phone, language,
         notification_sound, notification_desktop, status, created_at`,
      payload.name ?? null,
      payload.bio ?? null,
      payload.phone ?? null,
      payload.language ?? null,
      payload.notification_sound ?? null,
      payload.notification_desktop ?? null,
      request.user.id,
    );

    if (!rows[0]) {
      return reply.code(404).send({ success: false, error: { message: 'Usuário não encontrado' } });
    }

    return reply.send({ success: true, data: rows[0] });
  });

  app.patch('/me/password', { preHandler: guard }, async (request, reply) => {
    if (request.user.isSuperAdmin) {
      return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    }

    const schemaName = request.user.schemaName;
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    const parsed = passwordUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { message: 'current_password e new_password são obrigatórios' },
      });
    }

    const { current_password, new_password } = parsed.data;
    if (!current_password) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Informe a senha atual' },
      });
    }

    if (new_password.length < 8) {
      return reply.code(400).send({
        success: false,
        error: { message: 'A nova senha deve ter pelo menos 8 caracteres' },
      });
    }

    if (new_password.length > 200) {
      return reply.code(400).send({
        success: false,
        error: { message: 'A nova senha excede o limite permitido' },
      });
    }

    await ensureUserProfileColumns(schemaName);

    const userRows = await prisma.$queryRawUnsafe<Array<{ password_hash: string }>>(
      `SELECT password_hash
       FROM ${quoteIdent(schemaName)}.users
       WHERE id = $1::uuid
       LIMIT 1`,
      request.user.id,
    );

    if (!userRows[0]) {
      return reply.code(404).send({ success: false, error: { message: 'Usuário não encontrado' } });
    }

    const valid = await bcrypt.compare(current_password, userRows[0].password_hash);
    if (!valid) {
      return reply.code(400).send({ success: false, error: { message: 'Senha atual incorreta' } });
    }

    const hash = await bcrypt.hash(new_password, 12);

    await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdent(schemaName)}.users
       SET password_hash = $1, updated_at = NOW()
       WHERE id = $2::uuid`,
      hash,
      request.user.id,
    );

    return reply.send({ success: true });
  });

  app.get('/me/lgpd', { preHandler: guard }, async (request, reply) => {
    if (request.user.isSuperAdmin) return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    await ensureUsersLgpdInfrastructure(schemaName);
    const state = await getUserLgpdState(request.user.id, schemaName);
    const requestsResult = await listUserLgpdRequests(
      { page: 1, per_page: 20, user_id: request.user.id },
      schemaName,
    );
    return reply.send({ success: true, data: { ...state, requests: requestsResult.data } });
  });

  app.patch('/me/lgpd/consent', { preHandler: guard }, async (request, reply) => {
    if (request.user.isSuperAdmin) return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    const parsed = updateUserLgpdConsentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { message: 'Dados inválidos' } });

    await ensureUsersLgpdInfrastructure(schemaName);
    const result = await updateUserLgpdConsent(
      request.user.id,
      { ...parsed.data, source: parsed.data.source ?? 'self_service' },
      request.user.id,
      schemaName,
    );
    return reply.send({ success: true, data: result });
  });

  app.get('/me/lgpd/export', { preHandler: guard }, async (request, reply) => {
    if (request.user.isSuperAdmin) return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    const parsed = exportUserLgpdQuerySchema.safeParse(request.query);
    const includeAuditLogs = parsed.success ? parsed.data.include_audit_logs : true;

    await ensureUsersLgpdInfrastructure(schemaName);
    const data = await exportUserLgpdData(request.user.id, request.user.id, { includeAuditLogs }, schemaName);
    return reply.send({ success: true, data });
  });

  app.post('/me/lgpd/anonymize-request', { preHandler: guard }, async (request, reply) => {
    if (request.user.isSuperAdmin) return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    const schemaName = request.user.schemaName;
    if (!schemaName) return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });

    const parsed = submitAnonymizeRequestSchema.safeParse(request.body);
    const reason = parsed.success ? parsed.data.reason : undefined;

    await ensureUsersLgpdInfrastructure(schemaName);
    try {
      const request_ = await submitUserAnonymizeRequest(request.user.id, reason, schemaName);
      return reply.code(201).send({ success: true, data: request_ });
    } catch (err) {
      if (err instanceof LgpdForbiddenError) return reply.code(403).send({ success: false, error: { message: err.message } });
      throw err;
    }
  });

  app.post('/me/avatar', { preHandler: guard }, async (request, reply) => {
    if (request.user.isSuperAdmin) {
      return reply.code(403).send({ success: false, error: { message: 'Acesso não permitido' } });
    }

    if (!request.isMultipart()) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Content-Type deve ser multipart/form-data' },
      });
    }

    const schemaName = request.user.schemaName;
    if (!schemaName) {
      return reply.code(500).send({ success: false, error: { message: 'Schema do tenant não resolvido' } });
    }

    let fileBuffer: Buffer | null = null;
    let mimeType: string | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file' && !fileBuffer) {
        fileBuffer = await part.toBuffer();
        mimeType = part.mimetype;
        continue;
      }

      if (part.type === 'file') {
        await part.toBuffer();
      }
    }

    if (!fileBuffer || !mimeType) {
      return reply.code(400).send({ success: false, error: { message: 'Arquivo não enviado' } });
    }

    if (!ACCEPTED_AVATAR_TYPES.has(mimeType)) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Tipo não suportado. Use JPG, PNG ou WEBP' },
      });
    }

    if (fileBuffer.length > MAX_AVATAR_SIZE) {
      return reply.code(400).send({ success: false, error: { message: 'Arquivo muito grande. Máximo 2MB' } });
    }

    const existingRows = await prisma.$queryRawUnsafe<Array<{ avatar_url: string | null }>>(
      `SELECT avatar_url FROM ${quoteIdent(schemaName)}.users WHERE id = $1::uuid LIMIT 1`,
      request.user.id,
    );
    const oldAvatarUrl = existingRows[0]?.avatar_url ?? null;
    if (oldAvatarUrl) {
      const avatarsIdx = oldAvatarUrl.indexOf('avatars/');
      if (avatarsIdx !== -1) {
        const oldKey = oldAvatarUrl.slice(avatarsIdx).split('?')[0] ?? '';
        await getStorage().delete(oldKey).catch(() => {});
      }
    }

    const ext = avatarExtFromMime(mimeType);
    const key = `avatars/${request.user.id}-${Date.now()}.${ext}`;
    const avatarUrl = await getStorage().upload(key, fileBuffer, mimeType);

    await ensureUserProfileColumns(schemaName);
    await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdent(schemaName)}.users
       SET avatar_url = $1::text, updated_at = NOW()
       WHERE id = $2::uuid`,
      avatarUrl,
      request.user.id,
    );

    return reply.send({ success: true, data: { avatar_url: avatarUrl } });
  });
}
