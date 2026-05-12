import OpenAI from 'openai';
import type { PrismaClient } from '@prisma/client';

type RawExecutor = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

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

  const systemPrompt = `Você é ${config.agent_name}, assistente virtual.
${config.system_prompt ?? ''}

Use APENAS as informações da base de conhecimento fornecida.
Se não souber responder com base nas informações disponíveis, responda EXATAMENTE: [TRANSFERIR]
Se o cliente pedir para falar com humano, responda EXATAMENTE: [TRANSFERIR]`;

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

  return { response, confidence, shouldTransfer };
}

export async function getAIAgentConfig(
  db: RawExecutor,
  schemaName: string,
): Promise<AIAgentConfig | null> {
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
