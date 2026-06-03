export interface TenantSettings {
  timezone?: unknown;
  outbound_validity_mode?: unknown;
  outbound_validity_hours?: unknown;
  active_outbound_validity_mode?: unknown;
  active_outbound_validity_hours?: unknown;
}

type ValidityMode = 'end_of_day' | 'hours';

function resolveMode(settings: TenantSettings): ValidityMode {
  const rawMode = settings.outbound_validity_mode ?? settings.active_outbound_validity_mode;
  return rawMode === 'end_of_day' ? 'end_of_day' : 'hours';
}

function resolveHours(settings: TenantSettings): number {
  const rawHours = settings.outbound_validity_hours ?? settings.active_outbound_validity_hours;
  const parsed = typeof rawHours === 'number' ? Math.trunc(rawHours) : Number(rawHours);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 168 ? parsed : 24;
}

function getTimeZone(settings: TenantSettings): string {
  return typeof settings.timezone === 'string' && settings.timezone.trim()
    ? settings.timezone.trim()
    : 'America/Sao_Paulo';
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour'),
    pick('minute'),
    pick('second'),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function zonedEndOfDayToUtc(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wallClockUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), 23, 59, 59, 999);
  let offset = getTimeZoneOffsetMs(new Date(wallClockUtc), timeZone);
  let utcDate = new Date(wallClockUtc - offset);
  offset = getTimeZoneOffsetMs(utcDate, timeZone);
  utcDate = new Date(wallClockUtc - offset);
  return utcDate;
}

export function calculateWaitingExpiresAt(settings: TenantSettings, now = new Date()): Date {
  const mode = resolveMode(settings);
  if (mode === 'end_of_day') {
    return zonedEndOfDayToUtc(now, getTimeZone(settings));
  }

  const expires = new Date(now);
  expires.setHours(expires.getHours() + resolveHours(settings));
  return expires;
}
