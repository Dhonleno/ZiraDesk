import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

type CloseConfigSeedInput = {
  label: string;
  order: number;
};

/**
 * Registros de sistema: gravados pelos fluxos automáticos de encerramento
 * (jobs, webhook, monitor), nunca escolhidos manualmente pelo agente.
 * O id é fixo e prefixado com `sys_` para jamais colidir com os cuids
 * gerados para registros criados pelo admin.
 */
type CloseConfigSystemSeedInput = {
  id: string;
  label: string;
  order: number;
};

export const SYSTEM_CLOSE_TYPES: ReadonlyArray<CloseConfigSystemSeedInput> = [
  { id: 'sys_auto', label: 'Encerramento automático', order: 999 },
];

export const SYSTEM_CLOSE_OUTCOMES: ReadonlyArray<CloseConfigSystemSeedInput> = [
  { id: 'sys_no_reply', label: 'Sem resposta do cliente', order: 990 },
  { id: 'sys_inactivity', label: 'Encerrado por inatividade', order: 991 },
  { id: 'sys_delivery_fail', label: 'Falha na entrega', order: 992 },
  { id: 'sys_supervisor', label: 'Encerrado pela supervisão', order: 993 },
  { id: 'sys_queue_24h', label: 'Expirado na fila (24h)', order: 994 },
  { id: 'sys_by_client', label: 'Encerrado pelo cliente', order: 995 },
  { id: 'sys_auto_generic', label: 'Encerramento automático', order: 996 },
];

/** Único tipo de sistema: todo fechamento automático cai neste balde. */
export const SYSTEM_CLOSE_TYPE_ID = 'sys_auto';

/** Lookup nomeado dos desfechos de sistema, um por caminho de fechamento automático. */
export const SYSTEM_OUTCOME_IDS = {
  NO_REPLY: 'sys_no_reply',
  INACTIVITY: 'sys_inactivity',
  DELIVERY_FAIL: 'sys_delivery_fail',
  SUPERVISOR: 'sys_supervisor',
  QUEUE_24H: 'sys_queue_24h',
  BY_CLIENT: 'sys_by_client',
  AUTO_GENERIC: 'sys_auto_generic',
} as const;

export type SystemOutcomeId = (typeof SYSTEM_OUTCOME_IDS)[keyof typeof SYSTEM_OUTCOME_IDS];

const SYSTEM_LABEL_BY_ID = new Map<string, string>(
  [...SYSTEM_CLOSE_TYPES, ...SYSTEM_CLOSE_OUTCOMES].map((item) => [item.id, item.label]),
);

export interface SystemClosureReason {
  reason: string;
  notes: string | null;
  closeTypeId: string;
  closeTypeLabel: string | null;
  closeOutcomeId: SystemOutcomeId;
  closeOutcomeLabel: string | null;
  resolvedAt: Date;
  agentId: string | null;
  [key: string]: unknown;
}

/**
 * Monta o `closure_reason` dos fechamentos automáticos no mesmo formato que
 * `closeConversation` grava para o agente, para que os dois sejam legíveis pela
 * mesma consulta. Os labels vêm das constantes de seed, então acompanham
 * qualquer renomeação sem duplicar string.
 */
export function buildSystemClosureReason(params: {
  reason: string;
  outcomeId: SystemOutcomeId;
  resolvedAt: Date;
  notes?: string | null;
  agentId?: string | null;
  extra?: Record<string, unknown>;
}): SystemClosureReason {
  return {
    reason: params.reason,
    notes: params.notes ?? null,
    closeTypeId: SYSTEM_CLOSE_TYPE_ID,
    closeTypeLabel: SYSTEM_LABEL_BY_ID.get(SYSTEM_CLOSE_TYPE_ID) ?? null,
    closeOutcomeId: params.outcomeId,
    closeOutcomeLabel: SYSTEM_LABEL_BY_ID.get(params.outcomeId) ?? null,
    resolvedAt: params.resolvedAt,
    agentId: params.agentId ?? null,
    ...(params.extra ?? {}),
  };
}

const DEFAULT_CLOSE_TYPES: ReadonlyArray<CloseConfigSeedInput> = [
  { label: 'Dúvida', order: 0 },
  { label: 'Solicitação de serviço', order: 1 },
  { label: 'Consulta de demanda', order: 2 },
  { label: 'Reclamação', order: 3 },
  { label: 'Informação', order: 4 },
  { label: 'Outros', order: 5 },
];

const DEFAULT_CLOSE_OUTCOMES: ReadonlyArray<CloseConfigSeedInput> = [
  { label: 'Resolvido no atendimento', order: 0 },
  { label: 'Demanda aberta', order: 1 },
  { label: 'Transferido para outro setor', order: 2 },
  { label: 'Aguardando retorno do cliente', order: 3 },
  { label: 'Sem resolução', order: 4 },
];

function validateSchemaName(schema: string): string {
  if (!/^[a-z0-9_]+$/.test(schema)) {
    throw new Error('Schema inválido para seed de close config');
  }

  return schema;
}

function generateCuid(): string {
  const timePart = Date.now().toString(36).padStart(8, '0').slice(-8);
  const randomPart = randomBytes(8).toString('hex');
  return `c${timePart}${randomPart}`;
}

function buildBulkInsertQuery(
  tableName: 'conversation_close_types' | 'conversation_close_outcomes',
  items: ReadonlyArray<CloseConfigSeedInput>,
): { query: string; params: ReadonlyArray<unknown> } {
  const params: unknown[] = [];
  const values: string[] = [];

  for (const [index, item] of items.entries()) {
    const base = index * 4;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, true, $${base + 4})`);
    params.push(generateCuid(), item.label, index === 0, item.order);
  }

  const query = `
    INSERT INTO ${tableName} (id, label, is_default, is_active, sort_order)
    VALUES ${values.join(', ')}
    ON CONFLICT (label) DO NOTHING
  `;

  return { query, params };
}

function buildSystemInsertQuery(
  tableName: 'conversation_close_types' | 'conversation_close_outcomes',
  items: ReadonlyArray<CloseConfigSystemSeedInput>,
): { query: string; params: ReadonlyArray<unknown> } {
  const params: unknown[] = [];
  const values: string[] = [];

  for (const [index, item] of items.entries()) {
    const base = index * 3;
    values.push(`($${base + 1}, $${base + 2}, false, true, true, $${base + 3})`);
    params.push(item.id, item.label, item.order);
  }

  // ON CONFLICT sem alvo cobre tanto a PK (id) quanto o UNIQUE (label): rodar
  // duas vezes não duplica, e um label já ocupado por registro do admin não
  // aborta o seed inteiro.
  const query = `
    INSERT INTO ${tableName} (id, label, is_default, is_active, is_system, sort_order)
    VALUES ${values.join(', ')}
    ON CONFLICT DO NOTHING
  `;

  return { query, params };
}

export async function seedCloseConfig(prisma: PrismaClient, schema: string): Promise<void> {
  const safeSchema = validateSchemaName(schema);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchema}", public`);

    const typesInsert = buildBulkInsertQuery('conversation_close_types', DEFAULT_CLOSE_TYPES);
    await tx.$executeRawUnsafe(typesInsert.query, ...typesInsert.params);

    const outcomesInsert = buildBulkInsertQuery('conversation_close_outcomes', DEFAULT_CLOSE_OUTCOMES);
    await tx.$executeRawUnsafe(outcomesInsert.query, ...outcomesInsert.params);

    const systemTypesInsert = buildSystemInsertQuery('conversation_close_types', SYSTEM_CLOSE_TYPES);
    await tx.$executeRawUnsafe(systemTypesInsert.query, ...systemTypesInsert.params);

    const systemOutcomesInsert = buildSystemInsertQuery('conversation_close_outcomes', SYSTEM_CLOSE_OUTCOMES);
    await tx.$executeRawUnsafe(systemOutcomesInsert.query, ...systemOutcomesInsert.params);
  });
}
