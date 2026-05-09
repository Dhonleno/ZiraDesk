import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { getMonitorSnapshot } from './monitor.service.js';
import { ensureConversationProtocolInfrastructure } from './conversations/protocols.js';
import { ensureConversationCsatInfrastructure } from './conversations/csat.infrastructure.js';
import { ensureCloseConfigInfrastructure } from '../admin/close-config/close-config.service.js';

type TvDbClient = Pick<PrismaClient, '$transaction'>;
type TxClient = Prisma.TransactionClient;

function toSafeSchema(schemaName: string): string {
  return schemaName.replace(/"/g, '""');
}

async function withTenantSchema<T>(
  db: TvDbClient,
  schemaName: string,
  run: (tx: TxClient) => Promise<T>,
): Promise<T> {
  const safeSchema = toSafeSchema(schemaName);
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchema}", public`);
    return run(tx);
  });
}

function formatDurationSince(dateIso: string): string {
  const start = new Date(dateIso).getTime();
  const diffMs = Math.max(0, Date.now() - start);
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return '--';
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function normalizeAgentStatus(status: string): 'online' | 'paused' | 'offline' {
  if (status === 'online' || status === 'paused' || status === 'offline') return status;
  return 'offline';
}

function isLegacySchemaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    (message.includes('column') && message.includes('does not exist'))
    || (message.includes('relation') && message.includes('does not exist'))
  );
}

interface TvAgentCardsItem {
  id: string;
  name: string;
  avatarInitials: string;
  status: 'online' | 'paused' | 'offline';
  pauseReason: string | null;
  pauseStartedAt: string | null;
  pauseDuration: string | null;
  activeConversations: number;
  isAvailable: boolean;
}

interface TvConversationCard {
  id: string;
  protocol: string;
  channelType: string;
  contactName: string;
  contactPhone: string;
  agentName: string | null;
  assignedAt: string | null;
  createdAt: string;
  status: string;
  waitTime: number | null;
}

interface TvQueryRow {
  queued: number | null;
  in_service: number | null;
  resolved_today: number | null;
  abandoned: number | null;
  tme: number | null;
  tma: number | null;
  csat: number | null;
  sla: number | null;
  conversation_cards: TvConversationCard[] | null;
}

async function queryTvRow(tx: TxClient, legacyMode = false): Promise<TvQueryRow | undefined> {
  const modernSql = `WITH conversation_cards AS (
      SELECT
        c.id,
        COALESCE(NULLIF(c.protocol_number, ''), UPPER(SUBSTRING(REPLACE(c.id::text, '-', '') FROM 1 FOR 12))) AS protocol,
        c.channel_type AS channel_type,
        COALESCE(NULLIF(TRIM(ct.name), ''), 'Sem nome') AS contact_name,
        COALESCE(NULLIF(TRIM(ct.whatsapp), ''), NULLIF(TRIM(ct.phone), ''), '') AS contact_phone,
        u.name AS agent_name,
        c.assigned_at,
        c.created_at,
        c.status,
        CASE
          WHEN c.assigned_to IS NULL THEN FLOOR(EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 60)::integer
          ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(c.assigned_at, c.created_at))) / 60)::integer
        END AS wait_time
      FROM conversations c
      LEFT JOIN contacts ct ON ct.id = c.contact_id
      LEFT JOIN users u ON u.id = c.assigned_to
      WHERE (
        c.assigned_to IS NULL
        AND c.status IN ('open', 'pending', 'bot')
      ) OR (
        c.assigned_to IS NOT NULL
        AND c.status IN ('open', 'in_service', 'pending', 'bot')
      )
    ),
    first_response AS (
      SELECT
        c.id,
        MIN(EXTRACT(EPOCH FROM (m.created_at - c.created_at))) AS first_response_seconds
      FROM conversations c
      LEFT JOIN messages m
        ON m.conversation_id = c.id
        AND m.sender_type = 'agent'
        AND m.is_internal = false
      WHERE c.created_at::date = CURRENT_DATE
      GROUP BY c.id
    )
    SELECT
      COUNT(*) FILTER (
        WHERE c.assigned_to IS NULL
          AND c.status IN ('open', 'pending', 'bot')
      )::integer AS queued,
      COUNT(*) FILTER (
        WHERE c.assigned_to IS NOT NULL
          AND c.status IN ('open', 'in_service', 'pending', 'bot')
      )::integer AS in_service,
      COUNT(*) FILTER (
        WHERE c.status = 'resolved'
          AND c.resolved_at IS NOT NULL
          AND c.resolved_at::date = CURRENT_DATE
      )::integer AS resolved_today,
      COUNT(*) FILTER (
        WHERE c.status = 'closed'
          AND c.resolved_at IS NULL
          AND COALESCE(c.closed_at, c.created_at)::date = CURRENT_DATE
      )::integer AS abandoned,
      ROUND(AVG(EXTRACT(EPOCH FROM (c.assigned_at - c.created_at)) / 60.0)
        FILTER (
          WHERE c.assigned_at IS NOT NULL
            AND c.assigned_at::date = CURRENT_DATE
        ))::integer AS tme,
      ROUND(AVG(EXTRACT(EPOCH FROM (c.resolved_at - c.assigned_at)) / 60.0)
        FILTER (
          WHERE c.status = 'resolved'
            AND c.assigned_at IS NOT NULL
            AND c.resolved_at IS NOT NULL
            AND c.resolved_at::date = CURRENT_DATE
        ))::integer AS tma,
      ROUND(
        AVG(c.csat_score) FILTER (
          WHERE c.csat_score IS NOT NULL
            AND COALESCE(c.csat_responded_at, c.resolved_at, c.created_at)::date = CURRENT_DATE
        )::numeric,
        1
      ) AS csat,
      ROUND(
        COUNT(fr.id) FILTER (
          WHERE fr.first_response_seconds IS NOT NULL
            AND fr.first_response_seconds <= 300
        ) * 100.0 / NULLIF(COUNT(fr.id), 0),
        1
      ) AS sla,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', cc.id,
              'protocol', cc.protocol,
              'channelType', cc.channel_type,
              'contactName', cc.contact_name,
              'contactPhone', cc.contact_phone,
              'agentName', cc.agent_name,
              'assignedAt', cc.assigned_at,
              'createdAt', cc.created_at,
              'status', cc.status,
              'waitTime', cc.wait_time
            )
            ORDER BY
              CASE WHEN cc.assigned_at IS NULL THEN 0 ELSE 1 END ASC,
              cc.created_at ASC
          )
          FROM conversation_cards cc
        ),
        '[]'::json
      ) AS conversation_cards
    FROM conversations c
    LEFT JOIN first_response fr ON fr.id = c.id`;

  const legacySql = `WITH conversation_cards AS (
      SELECT
        c.id,
        UPPER(SUBSTRING(REPLACE(c.id::text, '-', '') FROM 1 FOR 12)) AS protocol,
        c.channel_type AS channel_type,
        COALESCE(NULLIF(TRIM(cl.name), ''), 'Sem nome') AS contact_name,
        COALESCE(NULLIF(TRIM(cl.phone), ''), '') AS contact_phone,
        u.name AS agent_name,
        NULL::timestamptz AS assigned_at,
        c.created_at,
        c.status,
        FLOOR(EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 60)::integer AS wait_time
      FROM conversations c
      LEFT JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN users u ON u.id = c.assigned_to
      WHERE (
        c.assigned_to IS NULL
        AND c.status IN ('open', 'pending', 'bot')
      ) OR (
        c.assigned_to IS NOT NULL
        AND c.status IN ('open', 'in_service', 'pending', 'bot')
      )
    ),
    first_response AS (
      SELECT
        c.id,
        MIN(EXTRACT(EPOCH FROM (m.created_at - c.created_at))) AS first_response_seconds
      FROM conversations c
      LEFT JOIN messages m
        ON m.conversation_id = c.id
        AND m.sender_type = 'agent'
        AND m.is_internal = false
      WHERE c.created_at::date = CURRENT_DATE
      GROUP BY c.id
    )
    SELECT
      COUNT(*) FILTER (
        WHERE c.assigned_to IS NULL
          AND c.status IN ('open', 'pending', 'bot')
      )::integer AS queued,
      COUNT(*) FILTER (
        WHERE c.assigned_to IS NOT NULL
          AND c.status IN ('open', 'in_service', 'pending', 'bot')
      )::integer AS in_service,
      COUNT(*) FILTER (
        WHERE c.status = 'resolved'
          AND c.resolved_at IS NOT NULL
          AND c.resolved_at::date = CURRENT_DATE
      )::integer AS resolved_today,
      COUNT(*) FILTER (
        WHERE c.status = 'closed'
          AND c.resolved_at IS NULL
          AND c.created_at::date = CURRENT_DATE
      )::integer AS abandoned,
      NULL::integer AS tme,
      ROUND(AVG(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 60.0)
        FILTER (
          WHERE c.status = 'resolved'
            AND c.resolved_at IS NOT NULL
            AND c.resolved_at::date = CURRENT_DATE
        ))::integer AS tma,
      ROUND(
        AVG(c.csat_score) FILTER (
          WHERE c.csat_score IS NOT NULL
            AND COALESCE(c.resolved_at, c.created_at)::date = CURRENT_DATE
        )::numeric,
        1
      ) AS csat,
      ROUND(
        COUNT(fr.id) FILTER (
          WHERE fr.first_response_seconds IS NOT NULL
            AND fr.first_response_seconds <= 300
        ) * 100.0 / NULLIF(COUNT(fr.id), 0),
        1
      ) AS sla,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', cc.id,
              'protocol', cc.protocol,
              'channelType', cc.channel_type,
              'contactName', cc.contact_name,
              'contactPhone', cc.contact_phone,
              'agentName', cc.agent_name,
              'assignedAt', cc.assigned_at,
              'createdAt', cc.created_at,
              'status', cc.status,
              'waitTime', cc.wait_time
            )
            ORDER BY cc.created_at ASC
          )
          FROM conversation_cards cc
        ),
        '[]'::json
      ) AS conversation_cards
    FROM conversations c
    LEFT JOIN first_response fr ON fr.id = c.id`;

  const sql = legacyMode ? legacySql : modernSql;
  const rows = await tx.$queryRawUnsafe<TvQueryRow[]>(sql);
  return rows[0];
}

export interface TvSnapshot {
  agents: {
    offline: number;
    online: number;
    available: number;
    inService: number;
    paused: number;
  };
  conversations: {
    queued: number;
    inService: number;
    resolvedToday: number;
    abandoned: number;
  };
  stats: {
    tme: number;
    tma: number;
    csat: number;
    sla: number;
  };
  agentCards: TvAgentCardsItem[];
  conversationCards: TvConversationCard[];
}

export async function getTvSnapshot(
  schemaName: string,
  db: TvDbClient = prisma,
): Promise<TvSnapshot> {
  await ensureConversationProtocolInfrastructure(prisma, schemaName);
  await ensureConversationCsatInfrastructure(prisma, schemaName);
  await ensureCloseConfigInfrastructure(schemaName);

  const monitor = await getMonitorSnapshot(schemaName);
  const agentCards: TvAgentCardsItem[] = monitor.agents.map((agent) => {
    const status = normalizeAgentStatus(agent.status);
    const pauseDuration = status === 'paused' && agent.pause_started_at
      ? formatDurationSince(agent.pause_started_at)
      : null;

    return {
      id: agent.id,
      name: agent.name,
      avatarInitials: getInitials(agent.name),
      status,
      pauseReason: agent.pause_reason,
      pauseStartedAt: agent.pause_started_at,
      pauseDuration,
      activeConversations: agent.active_conversations,
      isAvailable: Boolean(agent.is_available),
    };
  });

  const onlineCount = agentCards.filter((agent) => agent.status === 'online').length;
  const pausedCount = agentCards.filter((agent) => agent.status === 'paused').length;
  const offlineCount = agentCards.filter((agent) => agent.status === 'offline').length;
  const inServiceAgentsCount = agentCards.filter(
    (agent) => agent.status === 'online' && agent.activeConversations > 0,
  ).length;
  const availableAgentsCount = agentCards.filter(
    (agent) => agent.status === 'online' && agent.isAvailable,
  ).length;

  const row = await withTenantSchema(db, schemaName, async (tx) => {
    try {
      return await queryTvRow(tx, false);
    } catch (error) {
      if (!isLegacySchemaError(error)) throw error;
      return queryTvRow(tx, true);
    }
  });

  const conversationCards = (row?.conversation_cards ?? []).map((item: TvConversationCard) => ({
    ...item,
    assignedAt: item.assignedAt ? new Date(item.assignedAt).toISOString() : null,
    createdAt: new Date(item.createdAt).toISOString(),
  }));

  return {
    agents: {
      offline: offlineCount,
      online: onlineCount,
      available: availableAgentsCount,
      inService: inServiceAgentsCount,
      paused: pausedCount,
    },
    conversations: {
      queued: Number(row?.queued ?? 0),
      inService: Number(row?.in_service ?? 0),
      resolvedToday: Number(row?.resolved_today ?? 0),
      abandoned: Number(row?.abandoned ?? 0),
    },
    stats: {
      tme: Number(row?.tme ?? 0),
      tma: Number(row?.tma ?? 0),
      csat: Number(row?.csat ?? 0),
      sla: Number(row?.sla ?? 0),
    },
    agentCards,
    conversationCards,
  };
}
