import type { PrismaClient } from '@prisma/client';
import { quoteIdent } from '../../modules/omnichannel/conversations/protocols.js';

type SeedDbClient = Pick<typeof PrismaClient.prototype, '$executeRawUnsafe'>;

type SupportedCountry = 'BR' | 'US' | 'PT' | 'AR';

interface HolidaySeedEntry {
  date: string;
  name: string;
}

const BR_2026_HOLIDAYS: HolidaySeedEntry[] = [
  { date: '2026-01-01', name: 'Confraternização Universal' },
  { date: '2026-03-02', name: 'Carnaval' },
  { date: '2026-03-03', name: 'Carnaval' },
  { date: '2026-04-03', name: 'Sexta-feira Santa' },
  { date: '2026-04-21', name: 'Tiradentes' },
  { date: '2026-05-01', name: 'Dia do Trabalho' },
  { date: '2026-06-04', name: 'Corpus Christi' },
  { date: '2026-09-07', name: 'Independência do Brasil' },
  { date: '2026-10-12', name: 'Nossa Senhora Aparecida' },
  { date: '2026-11-02', name: 'Finados' },
  { date: '2026-11-15', name: 'Proclamação da República' },
  { date: '2026-12-25', name: 'Natal' },
];

function tableRef(schemaName: string): string {
  return `${quoteIdent(schemaName)}.business_hours_holidays`;
}

function getNationalHolidaySeeds(country: SupportedCountry): HolidaySeedEntry[] {
  if (country === 'BR') return BR_2026_HOLIDAYS;
  return [];
}

export async function seedNationalHolidays(
  prisma: SeedDbClient,
  schemaName: string,
  country: SupportedCountry = 'BR',
): Promise<number> {
  const seeds = getNationalHolidaySeeds(country);
  if (!seeds.length) return 0;

  const holidaysRef = tableRef(schemaName);
  let inserted = 0;

  for (const holiday of seeds) {
    const rows = await prisma.$executeRawUnsafe(
      `INSERT INTO ${holidaysRef} (
         date,
         name,
         behavior,
         is_national,
         country
       )
       VALUES (
         $1::date,
         $2,
         'closed',
         true,
         $3
       )
       ON CONFLICT (date, country) DO NOTHING`,
      holiday.date,
      holiday.name,
      country,
    );

    if (rows > 0) inserted += 1;
  }

  return inserted;
}

