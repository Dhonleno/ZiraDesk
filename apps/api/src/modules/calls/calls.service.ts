import twilio from 'twilio';
import { env } from '../../config/env.js';
import { quoteIdent } from '../omnichannel/conversations/protocols.js';

const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

type PrismaLike = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

interface SaveCallRecordInput {
  conversationId: string;
  agentId: string;
  callSid: string;
  toPhone: string;
  fromPhone: string;
  status: string;
  duration?: number | null;
  recordingUrl?: string | null;
}

interface CallStatusUpdate {
  status: string;
  duration?: number | null;
}

interface RecordingUpdate {
  recordingUrl: string;
  duration?: number | null;
}

export interface CallRecordRef {
  conversation_id: string;
  agent_id: string | null;
}

function apiBaseUrl(): string {
  return env.API_URL.replace(/\/+$/, '');
}

export function normalizePhoneToE164(phone: string): string {
  const sanitized = phone.replace(/\D/g, '');
  if (!sanitized) return '';
  if (phone.trim().startsWith('+')) return `+${sanitized}`;
  if (sanitized.startsWith('55')) return `+${sanitized}`;
  return `+55${sanitized}`;
}

export async function generateAccessToken(
  agentId: string,
): Promise<string> {
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: env.TWILIO_TWIML_APP_SID,
    incomingAllow: true,
  });

  const token = new AccessToken(
    env.TWILIO_ACCOUNT_SID,
    env.TWILIO_API_KEY,
    env.TWILIO_API_SECRET,
    { identity: agentId, ttl: 3600 },
  );

  token.addGrant(voiceGrant);
  return token.toJwt();
}

export async function makeCall(
  toPhone: string,
  agentId: string,
  conversationId: string,
): Promise<string> {
  const baseUrl = apiBaseUrl();
  const call = await twilioClient.calls.create({
    to: toPhone,
    from: env.TWILIO_PHONE_NUMBER,
    url: `${baseUrl}/api/calls/twiml/outbound?agent=${encodeURIComponent(agentId)}&conversation=${encodeURIComponent(conversationId)}`,
    method: 'POST',
    statusCallback: `${baseUrl}/api/calls/status`,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    record: true,
    recordingStatusCallback: `${baseUrl}/api/calls/recording`,
    recordingStatusCallbackMethod: 'POST',
  });

  return call.sid;
}

export async function getCallRecordings(callSid: string) {
  const recordings = await twilioClient.calls(callSid).recordings.list();

  return recordings.map((recording) => ({
    sid: recording.sid,
    duration: recording.duration,
    url: `https://api.twilio.com${recording.uri.replace('.json', '.mp3')}`,
  }));
}

export async function ensureCallRecordsInfrastructure(
  db: PrismaLike,
  schemaName: string,
): Promise<void> {
  const tableRef = `${quoteIdent(schemaName)}.call_records`;
  const conversationsRef = `${quoteIdent(schemaName)}.conversations`;
  const usersRef = `${quoteIdent(schemaName)}.users`;

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${tableRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES ${conversationsRef}(id) ON DELETE CASCADE,
      agent_id UUID REFERENCES ${usersRef}(id),
      call_sid VARCHAR(50) UNIQUE NOT NULL,
      to_phone VARCHAR(30),
      from_phone VARCHAR(30),
      status VARCHAR(30) DEFAULT 'initiated',
      duration INTEGER,
      recording_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS ${quoteIdent(`${schemaName}_idx_call_records_conversation`)}
    ON ${tableRef}(conversation_id)
  `);
}

export async function saveCallRecord(
  db: PrismaLike,
  schemaName: string,
  data: SaveCallRecordInput,
): Promise<void> {
  const tableRef = `${quoteIdent(schemaName)}.call_records`;

  await db.$queryRawUnsafe(
    `INSERT INTO ${tableRef} (
      id, conversation_id, agent_id, call_sid,
      to_phone, from_phone, status, duration,
      recording_url, created_at
    ) VALUES (
      gen_random_uuid(),
      $1::uuid,
      $2::uuid,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      NOW()
    )
    ON CONFLICT (call_sid) DO UPDATE
    SET status = EXCLUDED.status,
        duration = EXCLUDED.duration,
        recording_url = EXCLUDED.recording_url`,
    data.conversationId,
    data.agentId,
    data.callSid,
    data.toPhone,
    data.fromPhone,
    data.status,
    data.duration ?? null,
    data.recordingUrl ?? null,
  );
}

export async function updateCallStatusBySid(
  db: PrismaLike,
  schemaName: string,
  callSid: string,
  data: CallStatusUpdate,
): Promise<CallRecordRef | null> {
  const tableRef = `${quoteIdent(schemaName)}.call_records`;

  const rows = await db.$queryRawUnsafe<CallRecordRef[]>(
    `UPDATE ${tableRef}
     SET status = $1,
         duration = $2
     WHERE call_sid = $3
     RETURNING conversation_id, agent_id`,
    data.status,
    data.duration ?? null,
    callSid,
  );

  return rows[0] ?? null;
}

export async function updateCallRecordingBySid(
  db: PrismaLike,
  schemaName: string,
  callSid: string,
  data: RecordingUpdate,
): Promise<CallRecordRef | null> {
  const tableRef = `${quoteIdent(schemaName)}.call_records`;

  const rows = await db.$queryRawUnsafe<CallRecordRef[]>(
    `UPDATE ${tableRef}
     SET recording_url = $1,
         duration = COALESCE($2, duration)
     WHERE call_sid = $3
     RETURNING conversation_id, agent_id`,
    data.recordingUrl,
    data.duration ?? null,
    callSid,
  );

  return rows[0] ?? null;
}

export async function insertRecordingMessage(
  db: PrismaLike,
  schemaName: string,
  conversationId: string,
  callSid: string,
  recordingUrl: string,
  duration: number | null,
): Promise<void> {
  const messagesRef = `${quoteIdent(schemaName)}.messages`;
  const metadata = {
    call_sid: callSid,
    recording_url: recordingUrl,
    duration: duration ?? 0,
  };

  await db.$queryRawUnsafe(
    `INSERT INTO ${messagesRef} (
      id,
      conversation_id,
      sender_type,
      content,
      content_type,
      is_internal,
      metadata,
      created_at
    ) VALUES (
      gen_random_uuid(),
      $1::uuid,
      'system',
      'Gravação da chamada disponível',
      'call_recording',
      true,
      $2::jsonb,
      NOW()
    )`,
    conversationId,
    JSON.stringify(metadata),
  );
}
