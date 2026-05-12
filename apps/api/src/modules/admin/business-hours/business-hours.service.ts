import { prisma } from '../../../config/database.js';
import { quoteIdent } from '../../omnichannel/conversations/protocols.js';
import type { UpdateBusinessHoursInput } from './business-hours.schema.js';

type BusinessHoursDbClient = Pick<typeof prisma, '$executeRawUnsafe' | '$queryRawUnsafe'>;

interface BusinessHourDayRow {
  id: string;
  day_of_week: number;
  is_active: boolean;
  created_at: Date;
}

interface BusinessHourShiftRow {
  id: string;
  business_hour_id: string;
  open_time: string | Date;
  close_time: string | Date;
  created_at: Date;
}

interface BusinessHourConfigRow {
  id: string;
  is_24x7: boolean;
  created_at: Date;
  updated_at: Date;
}

interface BusinessHourHolidayRow {
  id: string;
  date: string | Date;
  name: string;
  behavior: 'closed' | 'custom_hours';
  open_time: string | Date | null;
  close_time: string | Date | null;
  is_national: boolean;
  country: string | null;
  created_at: Date;
}

interface LegacyBusinessHourRow {
  id: string;
  open_time: string;
  close_time: string;
}

interface CurrentSchemaRow {
  schema_name: string;
}

export interface BusinessHoursDayShift {
  id: string;
  openTime: string;
  closeTime: string;
}

export interface BusinessHoursDay {
  id: string;
  dayOfWeek: number;
  isActive: boolean;
  shifts: BusinessHoursDayShift[];
}

export interface BusinessHoursConfig {
  is24x7: boolean;
}

export interface BusinessHoursHoliday {
  id: string;
  date: string;
  name: string;
  behavior: 'closed' | 'custom_hours';
  openTime: string | null;
  closeTime: string | null;
  isNational: boolean;
  country: string | null;
}

export interface BusinessHoursData {
  config: BusinessHoursConfig;
  days: BusinessHoursDay[];
  holidays: BusinessHoursHoliday[];
}

export interface BusinessHoursStatus {
  is_open: boolean;
  next_open: string | null;
  next_open_day: number | null;
  next_open_time: string | null;
  closes_at: string | null;
}

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

function daysRef(schemaName?: string | null): string {
  return schemaName ? `${quoteIdent(schemaName)}.business_hours` : 'business_hours';
}

function shiftsRef(schemaName?: string | null): string {
  return schemaName ? `${quoteIdent(schemaName)}.business_hours_shifts` : 'business_hours_shifts';
}

function configRef(schemaName?: string | null): string {
  return schemaName ? `${quoteIdent(schemaName)}.business_hours_config` : 'business_hours_config';
}

function holidaysRef(schemaName?: string | null): string {
  return schemaName ? `${quoteIdent(schemaName)}.business_hours_holidays` : 'business_hours_holidays';
}

function normalizeTime(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  return value.slice(0, 5);
}

function normalizeDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function getLocalTimeContext(timezone: string): { dayOfWeek: number; currentTime: string; currentDate: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || DEFAULT_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(new Date());
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
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
    currentDate: `${year}-${month}-${day}`,
  };
}

function safeLocalTimeContext(timezone: string): { dayOfWeek: number; currentTime: string; currentDate: string } {
  try {
    return getLocalTimeContext(timezone);
  } catch {
    return getLocalTimeContext(DEFAULT_TIMEZONE);
  }
}

function toDayOfWeek(dateIso: string): number {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  return date.getUTCDay();
}

function addDays(dateIso: string, amount: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function compareTime(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function mapHoliday(row: BusinessHourHolidayRow): BusinessHoursHoliday {
  return {
    id: row.id,
    date: normalizeDate(row.date),
    name: row.name,
    behavior: row.behavior,
    openTime: row.open_time ? normalizeTime(row.open_time) : null,
    closeTime: row.close_time ? normalizeTime(row.close_time) : null,
    isNational: row.is_national,
    country: row.country,
  };
}

async function resolveSchemaName(
  db: BusinessHoursDbClient,
  schemaName?: string | null,
): Promise<string> {
  if (schemaName) return schemaName;
  const rows = await db.$queryRawUnsafe<CurrentSchemaRow[]>(
    'SELECT current_schema() AS schema_name',
  );
  return rows[0]?.schema_name ?? 'public';
}

async function seedBusinessHoursDefaults(
  db: BusinessHoursDbClient,
  schemaName?: string | null,
): Promise<void> {
  const businessHoursRef = daysRef(schemaName);
  const businessHoursShiftsRef = shiftsRef(schemaName);
  const businessHoursConfigRef = configRef(schemaName);

  await db.$executeRawUnsafe(
    `INSERT INTO ${businessHoursRef} (day_of_week, is_active)
     VALUES
       (0, true),
       (1, true),
       (2, true),
       (3, true),
       (4, true),
       (5, true),
       (6, true)
     ON CONFLICT (day_of_week) DO NOTHING`,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO ${businessHoursShiftsRef} (business_hour_id, open_time, close_time)
     SELECT bh.id, '08:00'::time, '18:00'::time
     FROM ${businessHoursRef} bh
     WHERE NOT EXISTS (
       SELECT 1
       FROM ${businessHoursShiftsRef} s
       WHERE s.business_hour_id = bh.id
     )`,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO ${businessHoursConfigRef} (is_24x7)
     SELECT false
     WHERE NOT EXISTS (SELECT 1 FROM ${businessHoursConfigRef})`,
  );
}

export async function migrateLegacyBusinessHours(
  db: BusinessHoursDbClient = prisma,
  schemaName?: string | null,
): Promise<void> {
  const effectiveSchema = await resolveSchemaName(db, schemaName);
  const businessHoursRef = daysRef(schemaName);
  const businessHoursShiftsRef = shiftsRef(schemaName);

  const shiftsTableRows = await db.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_name = 'business_hours_shifts'
     ) AS exists`,
    effectiveSchema,
  );

  if (shiftsTableRows[0]?.exists) return;

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${businessHoursShiftsRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_hour_id UUID NOT NULL REFERENCES ${businessHoursRef}(id) ON DELETE CASCADE,
      open_time TIME NOT NULL,
      close_time TIME NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const hasLegacyOpenRows = await db.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = 'business_hours'
         AND column_name = 'open_time'
     ) AS exists`,
    effectiveSchema,
  );

  const hasLegacyCloseRows = await db.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = 'business_hours'
         AND column_name = 'close_time'
     ) AS exists`,
    effectiveSchema,
  );

  if (hasLegacyOpenRows[0]?.exists && hasLegacyCloseRows[0]?.exists) {
    const legacyRows = await db.$queryRawUnsafe<LegacyBusinessHourRow[]>(
      `SELECT id, open_time::text AS open_time, close_time::text AS close_time
       FROM ${businessHoursRef}`,
    );

    for (const row of legacyRows) {
      await db.$executeRawUnsafe(
        `INSERT INTO ${businessHoursShiftsRef} (business_hour_id, open_time, close_time)
         VALUES ($1::uuid, $2::time, $3::time)`,
        row.id,
        row.open_time.slice(0, 5),
        row.close_time.slice(0, 5),
      );
    }
  }

  await db.$executeRawUnsafe(
    `ALTER TABLE ${businessHoursRef}
     DROP COLUMN IF EXISTS open_time,
     DROP COLUMN IF EXISTS close_time,
     DROP COLUMN IF EXISTS updated_at`,
  );
}

export async function ensureBusinessHoursInfrastructure(
  db: BusinessHoursDbClient = prisma,
  schemaName?: string | null,
): Promise<void> {
  const businessHoursRef = daysRef(schemaName);
  const businessHoursShiftsRef = shiftsRef(schemaName);
  const businessHoursConfigRef = configRef(schemaName);
  const businessHoursHolidaysRef = holidaysRef(schemaName);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${businessHoursRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      day_of_week INTEGER NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_business_hours_day_of_week
    ON ${businessHoursRef}(day_of_week)
  `);

  await migrateLegacyBusinessHours(db, schemaName);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${businessHoursShiftsRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_hour_id UUID NOT NULL REFERENCES ${businessHoursRef}(id) ON DELETE CASCADE,
      open_time TIME NOT NULL,
      close_time TIME NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${businessHoursConfigRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      is_24x7 BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${businessHoursHolidaysRef} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      date DATE NOT NULL,
      name VARCHAR(120) NOT NULL,
      behavior VARCHAR(20) NOT NULL DEFAULT 'closed',
      open_time TIME,
      close_time TIME,
      is_national BOOLEAN DEFAULT false,
      country VARCHAR(5),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(date, country)
    )
  `);

  await seedBusinessHoursDefaults(db, schemaName);
}

export async function repairZeroedLegacyShifts(
  db: BusinessHoursDbClient = prisma,
  schemaName?: string | null,
): Promise<number> {
  await ensureBusinessHoursInfrastructure(db, schemaName);
  const businessHoursShiftsRef = shiftsRef(schemaName);

  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE ${businessHoursShiftsRef}
     SET close_time = '18:00'::time
     WHERE open_time = '08:00'::time
       AND close_time = '00:00'::time
     RETURNING id`,
  );

  return rows.length;
}

async function readBusinessHoursData(
  db: BusinessHoursDbClient,
  schemaName?: string | null,
): Promise<BusinessHoursData> {
  const businessHoursRef = daysRef(schemaName);
  const businessHoursShiftsRef = shiftsRef(schemaName);
  const businessHoursConfigRef = configRef(schemaName);
  const businessHoursHolidaysRef = holidaysRef(schemaName);

  const [configRows, dayRows, shiftRows, holidayRows] = await Promise.all([
    db.$queryRawUnsafe<BusinessHourConfigRow[]>(
      `SELECT id, is_24x7, created_at, updated_at
       FROM ${businessHoursConfigRef}
       ORDER BY created_at ASC
       LIMIT 1`,
    ),
    db.$queryRawUnsafe<BusinessHourDayRow[]>(
      `SELECT id, day_of_week, is_active, created_at
       FROM ${businessHoursRef}
       ORDER BY day_of_week ASC`,
    ),
    db.$queryRawUnsafe<BusinessHourShiftRow[]>(
      `SELECT id, business_hour_id, open_time, close_time, created_at
       FROM ${businessHoursShiftsRef}
       ORDER BY open_time ASC`,
    ),
    db.$queryRawUnsafe<BusinessHourHolidayRow[]>(
      `SELECT id, date, name, behavior, open_time, close_time, is_national, country, created_at
       FROM ${businessHoursHolidaysRef}
       ORDER BY date ASC, name ASC`,
    ),
  ]);

  const shiftsByDay = new Map<string, BusinessHoursDayShift[]>();
  for (const shift of shiftRows) {
    const bucket = shiftsByDay.get(shift.business_hour_id) ?? [];
    bucket.push({
      id: shift.id,
      openTime: normalizeTime(shift.open_time),
      closeTime: normalizeTime(shift.close_time),
    });
    shiftsByDay.set(shift.business_hour_id, bucket);
  }

  return {
    config: { is24x7: configRows[0]?.is_24x7 ?? false },
    days: dayRows.map((day) => ({
      id: day.id,
      dayOfWeek: day.day_of_week,
      isActive: day.is_active,
      shifts: shiftsByDay.get(day.id) ?? [],
    })),
    holidays: holidayRows.map(mapHoliday),
  };
}

export async function getBusinessHours(schemaName?: string | null): Promise<BusinessHoursData> {
  await ensureBusinessHoursInfrastructure(prisma, schemaName);
  return readBusinessHoursData(prisma, schemaName);
}

export async function updateBusinessHours(
  data: UpdateBusinessHoursInput,
  schemaName?: string | null,
): Promise<BusinessHoursData> {
  await ensureBusinessHoursInfrastructure(prisma, schemaName);

  const businessHoursRef = daysRef(schemaName);
  const businessHoursShiftsRef = shiftsRef(schemaName);
  const businessHoursConfigRef = configRef(schemaName);
  const businessHoursHolidaysRef = holidaysRef(schemaName);

  await prisma.$transaction(async (tx) => {
    if (typeof data.is24x7 === 'boolean') {
      const configRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id
         FROM ${businessHoursConfigRef}
         ORDER BY created_at ASC
         LIMIT 1`,
      );
      const configId = configRows[0]?.id ?? null;
      if (configId) {
        await tx.$executeRawUnsafe(
          `UPDATE ${businessHoursConfigRef}
           SET is_24x7 = $1::boolean,
               updated_at = NOW()
           WHERE id = $2::uuid`,
          data.is24x7,
          configId,
        );
      } else {
        await tx.$executeRawUnsafe(
          `INSERT INTO ${businessHoursConfigRef} (is_24x7, created_at, updated_at)
           VALUES ($1::boolean, NOW(), NOW())`,
          data.is24x7,
        );
      }
    }

    if (data.days?.length) {
      for (const day of data.days) {
        const dayRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id
           FROM ${businessHoursRef}
           WHERE day_of_week = $1::integer
           LIMIT 1`,
          day.dayOfWeek,
        );

        let dayId = dayRows[0]?.id ?? null;
        if (!dayId) {
          const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `INSERT INTO ${businessHoursRef} (day_of_week, is_active)
             VALUES ($1::integer, $2::boolean)
             RETURNING id`,
            day.dayOfWeek,
            day.isActive,
          );
          dayId = inserted[0]?.id ?? null;
        } else {
          await tx.$executeRawUnsafe(
            `UPDATE ${businessHoursRef}
             SET is_active = $1::boolean
             WHERE id = $2::uuid`,
            day.isActive,
            dayId,
          );
        }

        if (!dayId) continue;

        await tx.$executeRawUnsafe(
          `DELETE FROM ${businessHoursShiftsRef}
           WHERE business_hour_id = $1::uuid`,
          dayId,
        );

        for (const shift of day.shifts) {
          await tx.$executeRawUnsafe(
            `INSERT INTO ${businessHoursShiftsRef} (business_hour_id, open_time, close_time)
             VALUES ($1::uuid, $2::time, $3::time)`,
            dayId,
            shift.openTime,
            shift.closeTime,
          );
        }
      }
    }

    if (data.holidays?.add?.length) {
      for (const holiday of data.holidays.add) {
        await tx.$executeRawUnsafe(
          `INSERT INTO ${businessHoursHolidaysRef} (
             date,
             name,
             behavior,
             open_time,
             close_time,
             is_national,
             country
           )
           VALUES (
             $1::date,
             $2,
             $3,
             CASE WHEN $3 = 'custom_hours' THEN $4::time ELSE NULL END,
             CASE WHEN $3 = 'custom_hours' THEN $5::time ELSE NULL END,
             false,
             NULL
           )`,
          holiday.date,
          holiday.name,
          holiday.behavior,
          holiday.openTime ?? null,
          holiday.closeTime ?? null,
        );
      }
    }

    if (data.holidays?.remove?.length) {
      await tx.$executeRawUnsafe(
        `DELETE FROM ${businessHoursHolidaysRef}
         WHERE id = ANY($1::uuid[])
           AND is_national = false`,
        data.holidays.remove,
      );
    }
  });

  return readBusinessHoursData(prisma, schemaName);
}

function resolveShiftsForDate(
  dateIso: string,
  dayOfWeek: number,
  data: BusinessHoursData,
): Array<{ openTime: string; closeTime: string }> {
  const holidayRows = data.holidays.filter((holiday) => holiday.date === dateIso);
  if (holidayRows.length) {
    const customShifts = holidayRows
      .filter((holiday) => holiday.behavior === 'custom_hours' && holiday.openTime && holiday.closeTime)
      .map((holiday) => ({ openTime: holiday.openTime!, closeTime: holiday.closeTime! }));

    if (customShifts.length) return customShifts;
    return [];
  }

  if (data.config.is24x7) {
    return [{ openTime: '00:00', closeTime: '23:59' }];
  }

  const day = data.days.find((candidate) => candidate.dayOfWeek === dayOfWeek);
  if (!day?.isActive) return [];
  return day.shifts.map((shift) => ({ openTime: shift.openTime, closeTime: shift.closeTime }));
}

function findCurrentShift(
  shifts: Array<{ openTime: string; closeTime: string }>,
  currentTime: string,
): { openTime: string; closeTime: string } | null {
  for (const shift of shifts) {
    if (compareTime(currentTime, shift.openTime) >= 0 && compareTime(currentTime, shift.closeTime) < 0) {
      return shift;
    }
  }
  return null;
}

function findNextOpenTime(
  shifts: Array<{ openTime: string; closeTime: string }>,
  currentTime: string,
): string | null {
  for (const shift of shifts) {
    if (compareTime(shift.openTime, currentTime) > 0) return shift.openTime;
  }
  return null;
}

export async function getBusinessHoursStatus(
  timezone = DEFAULT_TIMEZONE,
  db: BusinessHoursDbClient = prisma,
  schemaName?: string | null,
): Promise<BusinessHoursStatus> {
  await ensureBusinessHoursInfrastructure(db, schemaName);
  const data = await readBusinessHoursData(db, schemaName);
  const { dayOfWeek, currentTime, currentDate } = safeLocalTimeContext(timezone);

  const todayShifts = resolveShiftsForDate(currentDate, dayOfWeek, data);
  const currentShift = findCurrentShift(todayShifts, currentTime);
  if (currentShift) {
    return {
      is_open: true,
      next_open: null,
      next_open_day: null,
      next_open_time: null,
      closes_at: currentShift.closeTime,
    };
  }

  for (let offset = 0; offset <= 30; offset += 1) {
    const candidateDate = addDays(currentDate, offset);
    const candidateDayOfWeek = toDayOfWeek(candidateDate);
    const candidateShifts = resolveShiftsForDate(candidateDate, candidateDayOfWeek, data);
    if (!candidateShifts.length) continue;

    const nextTime = offset === 0
      ? findNextOpenTime(candidateShifts, currentTime)
      : candidateShifts[0]?.openTime ?? null;
    if (!nextTime) continue;

    return {
      is_open: false,
      next_open: `${candidateDayOfWeek}:${nextTime}`,
      next_open_day: candidateDayOfWeek,
      next_open_time: nextTime,
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
