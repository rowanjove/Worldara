export type CalendarPrecision = 'year' | 'month' | 'day';

export interface CalendarMonth { id: string; name: string; days: number; }
export interface CalendarEra { id: string; name: string; abbreviation: string; startTick: bigint; endTick?: bigint; }
export interface CalendarDefinition {
  id: string;
  name: string;
  yearZero: number;
  daysPerWeek: number;
  weekdays: string[];
  months: CalendarMonth[];
  eras: CalendarEra[];
  leapRule?: { everyYears: number; extraDays: number; monthId?: string };
}
export interface WorldDate { calendarId: string; year: number; month: number; day: number; precision?: CalendarPrecision; }
export interface FormattedWorldDate extends WorldDate { tick: bigint; display: string; eraId?: string; }

export class CalendarError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown> = {}) { super(message); this.name = 'CalendarError'; }
}

function assertDefinition(calendar: CalendarDefinition): void {
  if (!calendar.months.length) throw new CalendarError('Calendar must have at least one month');
  if (calendar.months.some((month) => !Number.isSafeInteger(month.days) || month.days <= 0)) throw new CalendarError('Month day counts must be positive safe integers');
  const baseDays = calendar.months.reduce((total, month) => total + month.days, 0);
  if (!Number.isSafeInteger(baseDays)) throw new CalendarError('Calendar year length is too large');
  if (!Number.isSafeInteger(calendar.daysPerWeek) || calendar.daysPerWeek <= 0) throw new CalendarError('daysPerWeek must be a positive safe integer');
  if (calendar.leapRule && (!Number.isSafeInteger(calendar.leapRule.everyYears) || calendar.leapRule.everyYears <= 0 || !Number.isSafeInteger(calendar.leapRule.extraDays) || calendar.leapRule.extraDays <= 0 || (calendar.leapRule.monthId !== undefined && !calendar.months.some((month) => month.id === calendar.leapRule?.monthId)))) throw new CalendarError('Invalid leap rule');
}

function leapExtraForMonth(calendar: CalendarDefinition, year: number, monthIndex: number): number {
  const rule = calendar.leapRule;
  if (!rule || !Number.isSafeInteger(year) || !isLeapYear(calendar, BigInt(year))) return 0;
  const targetIndex = rule.monthId === undefined ? calendar.months.length - 1 : calendar.months.findIndex((month) => month.id === rule.monthId);
  return monthIndex === targetIndex ? rule.extraDays : 0;
}

function isLeapYear(calendar: CalendarDefinition, year: bigint): boolean {
  const rule = calendar.leapRule;
  return rule !== undefined && year !== 0n && year % BigInt(rule.everyYears) === 0n;
}

function yearStart(calendar: CalendarDefinition, year: bigint): bigint {
  const base = BigInt(calendar.months.reduce((total, month) => total + month.days, 0));
  const rule = calendar.leapRule;
  if (!rule) return year * base;
  const period = BigInt(rule.everyYears);
  const extra = BigInt(rule.extraDays);
  if (year > 0n) return year * base + ((year - 1n) / period) * extra;
  if (year < 0n) return year * base - ((-year) / period) * extra;
  return 0n;
}

function epochOffset(calendar: CalendarDefinition): bigint {
  if (!Number.isSafeInteger(calendar.yearZero)) throw new CalendarError('yearZero must be a safe integer');
  return yearStart(calendar, BigInt(calendar.yearZero));
}

export function dateToTick(calendar: CalendarDefinition, date: WorldDate): bigint {
  assertDefinition(calendar);
  if (date.calendarId !== calendar.id) throw new CalendarError('Date belongs to another calendar', { calendarId: date.calendarId });
  if (!Number.isSafeInteger(date.year) || date.month < 1 || date.month > calendar.months.length || !Number.isSafeInteger(date.month) || !Number.isSafeInteger(date.day)) throw new CalendarError('Invalid world date', { date });
  const month = calendar.months[date.month - 1];
  const extra = month ? leapExtraForMonth(calendar, date.year, date.month - 1) : 0;
  if (!month || date.day < 1 || date.day > month.days + extra) throw new CalendarError('Day is outside month', { date });
  let offset = 0;
  for (let index = 0; index < date.month - 1; index += 1) offset += calendar.months[index]?.days ?? 0;
  return yearStart(calendar, BigInt(date.year)) - epochOffset(calendar) + BigInt(offset + date.day - 1);
}

export function tickToDate(calendar: CalendarDefinition, tick: bigint): FormattedWorldDate {
  assertDefinition(calendar);
  const epoch = epochOffset(calendar);
  const startTick = (year: bigint): bigint => yearStart(calendar, year) - epoch;
  const epochYear = BigInt(calendar.yearZero);
  let low: bigint;
  let high: bigint;
  if (tick >= 0n) {
    low = epochYear;
    high = epochYear + 1n;
    let step = 1n;
    while (startTick(high) <= tick) { low = high; high += step; step *= 2n; }
  } else {
    high = epochYear;
    low = epochYear - 1n;
    let step = 1n;
    while (startTick(low) > tick) { high = low; low -= step; step *= 2n; }
  }
  while (low + 1n < high) {
    const middle = low + (high - low) / 2n;
    if (startTick(middle) <= tick) low = middle;
    else high = middle;
  }
  if (low < BigInt(Number.MIN_SAFE_INTEGER) || low > BigInt(Number.MAX_SAFE_INTEGER)) throw new CalendarError('Tick is outside the safely representable calendar year range', { tick: tick.toString() });
  const year = Number(low);
  const yearStartTick = startTick(low);
  let remaining = Number(tick - yearStartTick);
  let month = 1;
  for (const candidate of calendar.months) {
    const extra = leapExtraForMonth(calendar, year, month - 1);
    const length = candidate.days + extra;
    if (remaining < length) break;
    remaining -= length;
    month += 1;
  }
  const day = remaining + 1;
  const era = calendar.eras.find((candidate) => tick >= candidate.startTick && (candidate.endTick === undefined || tick < candidate.endTick));
  const monthName = calendar.months[month - 1]?.name ?? String(month);
  return { calendarId: calendar.id, year, month, day, precision: 'day', tick, display: `${era ? `${era.name} ` : ''}${year}年 ${monthName} ${day}日`, ...(era ? { eraId: era.id } : {}) };
}

export function formatTick(calendar: CalendarDefinition, tick: bigint): string { return tickToDate(calendar, tick).display; }
