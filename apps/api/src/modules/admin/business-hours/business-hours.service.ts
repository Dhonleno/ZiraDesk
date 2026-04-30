import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { UpdateBusinessHourInput } from './business-hours.schema.js';

type BusinessHoursDbClient = Pick<typeof prisma, '$executeRawUnsafe' | '$queryRawUnsafe'>;

interface BusinessHourRow {
  id: string;
  day_of_week: number;
  is_active: boolean;
  open_time: string | Date;
  close_time: string | Date;
  created_at: Date;
  updated_at: Date;
}

export interface BusinessHour {
  id: string;
  day_of_week: number;
  is_active: boolean;
  open_time: string;
  close_time: string;
  created_at: Date;
  updated_at: Date;
}

export interface BusinessHoursStatus {
  is_open: boolean;
  next_open: string | null;
  next_open_day: number | null;
  next_open_time: string | null;
  closes_at: string | null;
}

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

function tableRef(schemaName?: string | null): string {
  return schemaName ? `${quoteIdent(schemaName)}.business_hours` : 'business_hours';
}

function normalizeTime(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  return value.slice(0, 5);
}

function mapBusinessHour(row: BusinessHourRow): BusinessHour {
  return {
    ...row,
    open_time: normalizeTime(row.open_time),
    close_time: normalizeTime(row.close_time),
  };
}

function getLocalTimeParts(timezone: string): { dayOfWeek: number; currentTime: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || DEFAULT_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(new Date());
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  let hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  if (hour === '24') hour = '00';

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    dayOfWeek: dayMap[weekday] ?? 0,
    currentTime: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
  };
}

function safeLocalTimeParts(timezone: string): { dayOfWeek: number; currentTime: string } {
  try {
    return getLocalTimeParts(timezone);
  } catch {
    return getLocalTimeParts(DEFAULT_TIMEZONE);
  }
}

export async function ensureBusinessHoursInfrastructure(
  db: BusinessHoursDbClient = prisma,
  schemaName?: string | null,
): Promise<void> {
  const businessHoursRef = tableRef(schemaName);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${businessHoursRef} (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      day_of_week INTEGER NOT NULL,
      is_active   BOOLEAN DEFAULT true,
      open_time   TIME NOT NULL DEFAULT '08:00',
      close_time  TIME NOT NULL DEFAULT '18:00',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(day_of_week)
    )
  `);

  await db.$executeRawUnsafe(`
    INSERT INTO ${businessHoursRef} (day_of_week, is_active, open_time, close_time)
    VALUES
      (0, false, '08:00', '18:00'),
      (1, true,  '08:00', '18:00'),
      (2, true,  '08:00', '18:00'),
      (3, true,  '08:00', '18:00'),
      (4, true,  '08:00', '18:00'),
      (5, true,  '08:00', '18:00'),
      (6, false, '08:00', '18:00')
    ON CONFLICT (day_of_week) DO NOTHING
  `);
}

export async function getBusinessHours(): Promise<BusinessHour[]> {
  await ensureBusinessHoursInfrastructure();
  const rows = await prisma.$queryRawUnsafe<BusinessHourRow[]>(
    'SELECT * FROM business_hours ORDER BY day_of_week ASC',
  );
  return rows.map(mapBusinessHour);
}

export async function updateBusinessHour(
  dayOfWeek: number,
  data: UpdateBusinessHourInput,
): Promise<BusinessHour> {
  await ensureBusinessHoursInfrastructure();
  const rows = await prisma.$queryRawUnsafe<BusinessHourRow[]>(
    `UPDATE business_hours
     SET is_active = COALESCE($1::boolean, is_active),
         open_time = COALESCE($2::time, open_time),
         close_time = COALESCE($3::time, close_time),
         updated_at = NOW()
     WHERE day_of_week = $4
     RETURNING *`,
    data.is_active ?? null,
    data.open_time ?? null,
    data.close_time ?? null,
    dayOfWeek,
  );

  if (!rows[0]) throw new Error('Horário não encontrado');
  return mapBusinessHour(rows[0]);
}

async function listBusinessHoursForStatus(
  db: BusinessHoursDbClient,
  schemaName?: string | null,
): Promise<BusinessHour[]> {
  await ensureBusinessHoursInfrastructure(db, schemaName);
  const rows = await db.$queryRawUnsafe<BusinessHourRow[]>(
    `SELECT * FROM ${tableRef(schemaName)} ORDER BY day_of_week ASC`,
  );
  return rows.map(mapBusinessHour);
}

export async function getBusinessHoursStatus(
  timezone = DEFAULT_TIMEZONE,
  db: BusinessHoursDbClient = prisma,
  schemaName?: string | null,
): Promise<BusinessHoursStatus> {
  const hours = await listBusinessHoursForStatus(db, schemaName);
  const { dayOfWeek, currentTime } = safeLocalTimeParts(timezone);
  const today = hours.find((hour) => hour.day_of_week === dayOfWeek);

  if (
    today?.is_active &&
    currentTime >= today.open_time &&
    currentTime < today.close_time
  ) {
    return {
      is_open: true,
      next_open: null,
      next_open_day: null,
      next_open_time: null,
      closes_at: today.close_time,
    };
  }

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidateDay = (dayOfWeek + offset) % 7;
    const candidate = hours.find((hour) => hour.day_of_week === candidateDay);
    if (!candidate?.is_active) continue;
    if (offset === 0 && currentTime >= candidate.open_time) continue;

    return {
      is_open: false,
      next_open: `${candidateDay}:${candidate.open_time}`,
      next_open_day: candidateDay,
      next_open_time: candidate.open_time,
      closes_at: null,
    };
  }

  return {
    is_open: false,
    next_open: null,
    next_open_day: null,
    next_open_time: null,
    closes_at: null,
  };
}

export async function isWithinBusinessHours(
  db: BusinessHoursDbClient = prisma,
  timezone = DEFAULT_TIMEZONE,
  schemaName?: string | null,
): Promise<boolean> {
  const status = await getBusinessHoursStatus(timezone, db, schemaName);
  return status.is_open;
}
