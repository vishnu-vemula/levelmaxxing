import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import type { JournalData, NutritionData, TrainingData } from '@levelmaxing/contracts';
import { calendarDates, calendarLogDays, moveCalendar } from './calendar.ts';

test('week and month navigation handle year changes and clamp the selected date to a leap month', () => {
  deepEqual(calendarDates('2026-01-01', 'week'), [
    '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04',
  ]);
  equal(moveCalendar('2028-01-31', 'month', 1), '2028-02-29');
  const february = calendarDates('2028-02-29', 'month');
  equal(february.length, 29);
  equal(february[0], '2028-02-01');
  equal(february.at(-1), '2028-02-29');
  equal(moveCalendar('2026-01-03', 'week', -1), '2025-12-27');
  equal(moveCalendar('9999-12-30', 'week', 1), '9999-12-30');
});

test('calendar coalesces local workout dates and date-keyed logs without including an active session', () => {
  const active = { id: 'active', programId: 'plan', dayId: 'day', name: 'Active', exercises: [],
    startedAt: new Date(2026, 10, 25, 6).toISOString(), finishedAt: null };
  const complete = { ...active, id: 'finished', startedAt: new Date(2026, 10, 23, 23, 50).toISOString(),
    finishedAt: new Date(2026, 10, 24, 0, 20).toISOString() };
  const result = calendarLogDays({
    training: { programs: [], activeProgramId: null, session: active, history: [complete] } satisfies TrainingData,
    nutrition: { meals: [{ id: 'food', date: '2026-11-24', meal: 'Breakfast', name: 'Oats', quantity: 1, unit: 'bowl',
      macros: { calories: 100, protein: 5, carbs: 16, fat: 2 }, source: 'Manual' }], recipes: [], groceries: [] } satisfies NutritionData,
    journal: { checkIns: [{ id: 'check', date: '2026-11-24', hunger: 3, energy: 4, sleep: 7, note: '' }],
      activities: [], bookmarks: [] } satisfies JournalData,
    weights: [{ measuredOn: '2026-11-24' }, { measuredOn: '2026-11-22' }],
  });
  deepEqual(result.get('2026-11-24'), { workouts: 1, food: 1, checkIns: 1, weights: 1 });
  deepEqual(result.get('2026-11-22'), { workouts: 0, food: 0, checkIns: 0, weights: 1 });
  equal(result.has('2026-11-23'), false);
  equal(result.has('2026-11-25'), false);
});
