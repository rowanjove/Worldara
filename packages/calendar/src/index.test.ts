import { describe, expect, it } from 'vitest';
import { dateToTick, tickToDate, type CalendarDefinition } from './index';

const calendar: CalendarDefinition = {
  id: 'imperial', name: '帝国历', yearZero: 0, daysPerWeek: 8, weekdays: [],
  months: [{ id: 'spring', name: '春月', days: 40 }, { id: 'summer', name: '夏月', days: 40 }, { id: 'autumn', name: '秋月', days: 40 }, { id: 'winter', name: '冬月', days: 40 }],
  eras: [{ id: 'empire', name: '帝国', abbreviation: 'E', startTick: 0n }],
  leapRule: { everyYears: 4, extraDays: 1, monthId: 'winter' },
};

describe('calendar', () => {
  it('round-trips ordinary and leap dates', () => {
    for (const date of [{ year: 0, month: 1, day: 1 }, { year: 3, month: 4, day: 40 }, { year: 4, month: 4, day: 41 }, { year: -2, month: 2, day: 3 }]) {
      const tick = dateToTick(calendar, { calendarId: calendar.id, ...date });
      const result = tickToDate(calendar, tick);
      expect({ year: result.year, month: result.month, day: result.day }).toEqual(date);
    }
  });

  it('keeps ticks monotonic across month boundaries', () => {
    expect(dateToTick(calendar, { calendarId: calendar.id, year: 1, month: 1, day: 1 }) + 40n).toBe(dateToTick(calendar, { calendarId: calendar.id, year: 1, month: 2, day: 1 }));
  });

  it('uses yearZero as the epoch year instead of silently ignoring it', () => {
    const shifted = { ...calendar, yearZero: 1 };
    expect(dateToTick(shifted, { calendarId: shifted.id, year: 1, month: 1, day: 1 })).toBe(0n);
    expect(tickToDate(shifted, -1n).year).toBe(0);
  });

  it('places leap days in the final month when no month is configured', () => {
    const appended = { ...calendar, leapRule: { everyYears: 4, extraDays: 1 } };
    const date = { calendarId: appended.id, year: 4, month: 4, day: 41 };
    expect(tickToDate(appended, dateToTick(appended, date))).toMatchObject({ year: 4, month: 4, day: 41 });
  });

  it('round-trips a dense sample of negative, ordinary, and leap dates', () => {
    for (let year = -8; year <= 12; year += 1) {
      for (let month = 1; month <= 4; month += 1) {
        const monthDays = calendar.months[month - 1]!.days + (year !== 0 && year % 4 === 0 && month === 4 ? 1 : 0);
        for (const day of [1, 20, monthDays]) {
          const date = { calendarId: calendar.id, year, month, day };
          const tick = dateToTick(calendar, date);
          const back = tickToDate(calendar, tick);
          expect({ year: back.year, month: back.month, day: back.day }).toEqual({ year, month, day });
        }
      }
    }
  });
});
