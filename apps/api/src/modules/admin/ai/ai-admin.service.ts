import { prisma } from '../../../config/database.js';
import { encryptCredentials, decryptCredentials } from '../../../utils/crypto.js';
import { knowledgeIndexQueue } from '../../../jobs/knowledge-index.job.js';
import {
  ensureAIAgentConfigInfrastructure,
  ensureAIKnowledgeInfrastructure,
  type AIAgentConfig,
} from '../../ai/ai.service.js';

export interface UpdateAIConfigInput {
  is_enabled?: boolean;
  agent_name?: string;
  system_prompt?: string | null;
  fallback_skill_id?: string | null;
  max_attempts?: number;
  confidence_threshold?: number;
  openai_api_key?: string | null;
}

export interface CreateArticleInput {
  title: string;
  content: string;
  source_type: 'manual' | 'url' | 'file';
  source_url?: string;
  file_name?: string;
}

export interface ArticleRow {
  id: string;
  title: string;
  source_type: string;
  source_url: string | null;
  file_name: string | null;
  status: string;
  error_message: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  chunk_count: number;
}

export async function getAIConfig(schemaName: string): Promise<AIAgentConfig | null> {
  await ensureAIAgentConfigInfrastructure(prisma, schemaName);

  const rows = await prisma.$queryRawUnsafe<AIAgentConfig[]>(
    `SELECT id, is_enabled, agent_name, system_prompt, fallback_skill_id,
            max_attempts, confidence_threshold, openai_api_key
     FROM "${schemaName}".ai_agent_config
     LIMIT 1`,
  );

  const config = rows[0];
  if (!config) return null;

  // Mascarar a chave retornada ao frontend (não expor o valor real)
  if (config.openai_api_key) {
    config.openai_api_key = '••••••••';
  }

  return config;
}

export async function updateAIConfig(
  schemaName: string,
  input: UpdateAIConfigInput,
): Promise<void> {
  await ensureAIAgentConfigInfrastructure(prisma, schemaName);

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.is_enabled !== undefined) {
    fields.push(`is_enabled = $${idx++}`);
    values.push(input.is_enabled);
  }
  if (input.agent_name !== undefined) {
    fields.push(`agent_name = $${idx++}`);
    values.push(input.agent_name);
  }
  if ('system_prompt' in input) {
    fields.push(`system_prompt = $${idx++}`);
    values.push(input.system_prompt ?? null);
  }
  if ('fallback_skill_id' in input) {
    fields.push(`fallback_skill_id = $${idx++}`);
    values.push(input.fallback_skill_id ?? null);
  }
  if (input.max_attempts !== undefined) {
    fields.push(`max_attempts = $${idx++}`);
    values.push(input.max_attempts);
  }
  if (input.confidence_threshold !== undefined) {
    fields.push(`confidence_threshold = $${idx++}`);
    values.push(input.confidence_threshold);
  }
  if (input.openai_api_key !== undefined) {
    if (input.openai_api_key && input.openai_api_key !== '••••••••') {
      const encrypted = encryptCredentials({ key: input.openai_api_key });
      fields.push(`openai_api_key = $${idx++}`);
      values.push(encrypted);
    } else if (input.openai_api_key === null) {
      fields.push(`openai_api_key = $${idx++}`);
      values.push(null);
    }
    // Se '••••••••', manter o valor existente (não alterar)
  }

  if (fields.length === 0) return;

  fields.push(`updated_at = NOW()`);

  const sql = `
    UPDATE "${schemaName}".ai_agent_config
       SET ${fields.join(', ')}
     WHERE id = (
       SELECT id
       FROM "${schemaName}".ai_agent_config
       ORDER BY created_at ASC
       LIMIT 1
     )
  `;
  await prisma.$executeRawUnsafe(sql, ...values);
}

export async function listArticles(schemaName: string): Promise<ArticleRow[]> {
  await ensureAIKnowledgeInfrastructure(prisma, schemaName);

  return prisma.$queryRawUnsafe<ArticleRow[]>(
    `SELECT ka.id, ka.title, ka.source_type, ka.source_url, ka.file_name,
            ka.status, ka.error_message, ka.is_active, ka.created_at, ka.updated_at,
            COUNT(kc.id)::int AS chunk_count
     FROM "${schemaName}".knowledge_articles ka
     LEFT JOIN "${schemaName}".knowledge_chunks kc ON kc.article_id = ka.id
     GROUP BY ka.id
     ORDER BY ka.created_at DESC`,
  );
}

export async function createArticle(
  schemaName: string,
  tenantId: string,
  input: CreateArticleInput,
): Promise<{ id: string }> {
  await ensureAIKnowledgeInfrastructure(prisma, schemaName);

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${schemaName}".knowledge_articles
       (title, content, source_type, source_url, file_name, status)
     VALUES ($1, $2, $3, $4, $5, 'processing')
     RETURNING id`,
    input.title,
    input.content,
    input.source_type,
    input.source_url ?? null,
    input.file_name ?? null,
  );

  const id = rows[0]!.id;

  await knowledgeIndexQueue.add('index', { articleId: id, schemaName, tenantId });

  return { id };
}

export async function deleteArticle(schemaName: string, articleId: string): Promise<void> {
  await ensureAIKnowledgeInfrastructure(prisma, schemaName);

  await prisma.$executeRawUnsafe(
    `DELETE FROM "${schemaName}".knowledge_articles WHERE id = $1::uuid`,
    articleId,
  );
}

export async function toggleArticle(
  schemaName: string,
  articleId: string,
  isActive: boolean,
): Promise<void> {
  await ensureAIKnowledgeInfrastructure(prisma, schemaName);

  await prisma.$executeRawUnsafe(
    `UPDATE "${schemaName}".knowledge_articles
     SET is_active = $1, updated_at = NOW()
     WHERE id = $2::uuid`,
    isActive,
    articleId,
  );
}

export function decryptApiKey(encrypted: string | null): string | null {
  if (!encrypted) return null;
  try {
    const creds = decryptCredentials(encrypted);
    return creds['key'] ?? null;
  } catch {
    return null;
  }
}
