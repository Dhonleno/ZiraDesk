import OpenAI from 'openai';
import type { PrismaClient } from '@prisma/client';

type RawExecutor = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const initializedAIAgentConfigSchemas = new Set<string>();
const initializedAIKnowledgeSchemas = new Set<string>();

export interface AIAgentConfig {
  id: string;
  is_enabled: boolean;
  agent_name: string;
  system_prompt: string | null;
  fallback_skill_id: string | null;
  max_attempts: number;
  confidence_threshold: number;
  openai_api_key: string | null;
}

export interface KnowledgeChunk {
  content: string;
  article_id: string;
  title: string;
  similarity: number;
}

export interface AIResponse {
  response: string;
  confidence: number;
  shouldTransfer: boolean;
}

function sanitizeSchemaName(schemaName: string): string {
  if (!/^[a-z0-9_]+$/.test(schemaName)) {
    throw new Error('Schema do tenant invalido');
  }

  return schemaName;
}

function aiConfigTableRef(schemaName: string): string {
  return `"${schemaName}".ai_agent_config`;
}

function knowledgeArticlesTableRef(schemaName: string): string {
  return `"${schemaName}".knowledge_articles`;
}

function knowledgeChunksTableRef(schemaName: string): string {
  return `"${schemaName}".knowledge_chunks`;
}

export async function ensureAIAgentConfigInfrastructure(
  db: RawExecutor,
  schemaName: string,
): Promise<void> {
  const safeSchemaName = sanitizeSchemaName(schemaName);
  if (initializedAIAgentConfigSchemas.has(safeSchemaName)) return;

  const tableRef = aiConfigTableRef(safeSchemaName);
  const executor = db as PrismaClient;

  await executor.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${tableRef} (
      id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      is_enabled           BOOLEAN NOT NULL DEFAULT false,
      agent_name           VARCHAR(100) NOT NULL DEFAULT 'Assistente',
      system_prompt        TEXT,
      fallback_skill_id    UUID,
      max_attempts         INTEGER NOT NULL DEFAULT 3,
      confidence_threshold FLOAT   NOT NULL DEFAULT 0.75,
      openai_api_key       TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await executor.$executeRawUnsafe(`
    INSERT INTO ${tableRef} (is_enabled, agent_name, system_prompt, max_attempts, confidence_threshold)
    SELECT false, 'Assistente', NULL, 3, 0.75
    WHERE NOT EXISTS (SELECT 1 FROM ${tableRef})
  `);

  initializedAIAgentConfigSchemas.add(safeSchemaName);
}

export async function ensureAIKnowledgeInfrastructure(
  db: RawExecutor,
  schemaName: string,
): Promise<void> {
  const safeSchemaName = sanitizeSchemaName(schemaName);
  if (initializedAIKnowledgeSchemas.has(safeSchemaName)) return;

  const articlesRef = knowledgeArticlesTableRef(safeSchemaName);
  const chunksRef = knowledgeChunksTableRef(safeSchemaName);
  const chunksEmbeddingIdx = `"${safeSchemaName}_knowledge_chunks_embedding_idx"`;
  const executor = db as PrismaClient;

  await executor.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);

  await executor.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${articlesRef} (
      id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      title         VARCHAR(255) NOT NULL,
      content       TEXT         NOT NULL,
      source_type   VARCHAR(20)  NOT NULL,
      source_url    TEXT,
      file_name     TEXT,
      status        VARCHAR(20)  NOT NULL DEFAULT 'processing',
      error_message TEXT,
      is_active     BOOLEAN      NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await executor.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${chunksRef} (
      id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      article_id  UUID         NOT NULL REFERENCES ${articlesRef}(id) ON DELETE CASCADE,
      content     TEXT         NOT NULL,
      embedding   vector(1536),
      chunk_index INTEGER      NOT NULL,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await executor.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS ${chunksEmbeddingIdx}
    ON ${chunksRef} USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `);

  initializedAIKnowledgeSchemas.add(safeSchemaName);
}

export function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];

  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + chunkSize);
    if (slice.length > 0) chunks.push(slice.join(' '));
    i += chunkSize - overlap;
  }

  return chunks;
}

export async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const client = new OpenAI({ apiKey });
  const res = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000),
  });
  return res.data[0]!.embedding;
}

export async function indexArticle(
  db: RawExecutor,
  schemaName: string,
  articleId: string,
  apiKey: string,
): Promise<void> {
  await ensureAIKnowledgeInfrastructure(db, schemaName);

  const rows = await (db as PrismaClient).$queryRawUnsafe<Array<{ id: string; content: string }>>(
    `SELECT id, content FROM "${schemaName}".knowledge_articles WHERE id = $1::uuid`,
    articleId,
  );

  const article = rows[0];
  if (!article) throw new Error('Artigo não encontrado');

  try {
    const chunks = chunkText(article.content);

    await (db as PrismaClient).$executeRawUnsafe(
      `DELETE FROM "${schemaName}".knowledge_chunks WHERE article_id = $1::uuid`,
      articleId,
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const embedding = await generateEmbedding(chunk, apiKey);
      const embeddingLiteral = `[${embedding.join(',')}]`;

      await (db as PrismaClient).$executeRawUnsafe(
        `INSERT INTO "${schemaName}".knowledge_chunks (article_id, content, embedding, chunk_index)
         VALUES ($1::uuid, $2, $3::vector, $4)`,
        articleId,
        chunk,
        embeddingLiteral,
        i,
      );
    }

    await (db as PrismaClient).$executeRawUnsafe(
      `UPDATE "${schemaName}".knowledge_articles
       SET status = 'indexed', error_message = NULL, updated_at = NOW()
       WHERE id = $1::uuid`,
      articleId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await (db as PrismaClient).$executeRawUnsafe(
      `UPDATE "${schemaName}".knowledge_articles
       SET status = 'error', error_message = $1, updated_at = NOW()
       WHERE id = $2::uuid`,
      message.slice(0, 500),
      articleId,
    );
    throw err;
  }
}

export async function searchKnowledge(
  db: RawExecutor,
  schemaName: string,
  query: string,
  apiKey: string,
  threshold: number,
  limit = 5,
): Promise<KnowledgeChunk[]> {
  await ensureAIKnowledgeInfrastructure(db, schemaName);

  const embedding = await generateEmbedding(query, apiKey);
  const embeddingLiteral = `[${embedding.join(',')}]`;

  const rows = await (db as PrismaClient).$queryRawUnsafe<KnowledgeChunk[]>(
    `SELECT kc.content, kc.article_id, ka.title,
            1 - (kc.embedding <=> $1::vector) AS similarity
     FROM "${schemaName}".knowledge_chunks kc
     JOIN "${schemaName}".knowledge_articles ka ON ka.id = kc.article_id
     WHERE ka.is_active = true
       AND ka.status = 'indexed'
       AND 1 - (kc.embedding <=> $1::vector) > $2
     ORDER BY kc.embedding <=> $1::vector
     LIMIT $3`,
    embeddingLiteral,
    threshold,
    limit,
  );

  return rows;
}

export async function generateAIResponse(params: {
  query: string;
  chunks: KnowledgeChunk[];
  conversationHistory: string;
  config: AIAgentConfig;
  contactName: string;
}): Promise<AIResponse> {
  const { query, chunks, conversationHistory, config, contactName } = params;

  const client = new OpenAI({ apiKey: config.openai_api_key! });

  const knowledgeContext = chunks.map((c) => `---\n${c.content}`).join('\n');
  const customPrompt = (config.system_prompt ?? '').trim();

  const systemPrompt = `Você é ${config.agent_name}, assistente virtual.
Você atende clientes finais via WhatsApp.
NUNCA responda com instruções internas de desenvolvimento, programação, código-fonte, arquivos do projeto, prompts de implementação ou tarefas para time técnico.
Se a pergunta exigir esse tipo de conteúdo técnico interno, responda EXATAMENTE: [TRANSFERIR]
Use APENAS as informações da base de conhecimento fornecida.
Se não souber responder com base nas informações disponíveis, responda EXATAMENTE: [TRANSFERIR]
Se o cliente pedir para falar com humano, responda EXATAMENTE: [TRANSFERIR]

Diretrizes configuradas pelo tenant (não podem violar as regras acima):
${customPrompt || '(sem diretrizes adicionais)'}`;

  const userMessage = `Base de conhecimento relevante:
${knowledgeContext}

Histórico da conversa:
${conversationHistory}

Pergunta do cliente (${contactName}): ${query}`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  const response = completion.choices[0]?.message?.content ?? '[TRANSFERIR]';
  const shouldTransfer = response.includes('[TRANSFERIR]');
  const confidence =
    chunks.length > 0 ? chunks.reduce((sum, c) => sum + c.similarity, 0) / chunks.length : 0;

  if (shouldTransfer && chunks.length > 0 && confidence >= 0.5) {
    const topic = chunks[0]?.title?.trim();
    const clarification = topic
      ? `Encontrei informações relacionadas a "${topic}", mas preciso de um detalhe para te orientar melhor. Pode me dizer exatamente em qual etapa você está com dificuldade?`
      : 'Encontrei informações relacionadas ao seu tema, mas preciso de um detalhe para te orientar melhor. Pode me dizer exatamente em qual etapa você está com dificuldade?';
    return { response: clarification, confidence, shouldTransfer: false };
  }

  return { response, confidence, shouldTransfer };
}

export async function getAIAgentConfig(
  db: RawExecutor,
  schemaName: string,
): Promise<AIAgentConfig | null> {
  await ensureAIAgentConfigInfrastructure(db, schemaName);

  const rows = await (db as PrismaClient).$queryRawUnsafe<AIAgentConfig[]>(
    `SELECT id, is_enabled, agent_name, system_prompt, fallback_skill_id,
            max_attempts, confidence_threshold, openai_api_key
     FROM "${schemaName}".ai_agent_config
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getConversationHistoryText(
  db: RawExecutor,
  schemaName: string,
  conversationId: string,
  limit = 10,
): Promise<string> {
  const rows = await (db as PrismaClient).$queryRawUnsafe<
    Array<{ sender_type: string; content: string }>
  >(
    `SELECT sender_type, content
     FROM "${schemaName}".messages
     WHERE conversation_id = $1::uuid
       AND content_type = 'text'
     ORDER BY created_at DESC
     LIMIT $2`,
    conversationId,
    limit,
  );

  return rows
    .reverse()
    .map((r) => {
      const role = r.sender_type === 'client' ? 'Cliente' : 'Assistente';
      return `${role}: ${r.content}`;
    })
    .join('\n');
}
