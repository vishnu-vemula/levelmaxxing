import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coachSummary, emptyJournal, updateCheckIn } from './model.ts';
import type { Workout } from '@levelmaxing/contracts';

test('editing the daily check-in preserves history and replaces only the matching date', () => {
  const first = { id: 'yesterday', date: '2026-11-22', hunger: 3, energy: 2, sleep: 7, note: '' };
  const second = { ...first, id: 'today', date: '2026-11-23' };
  const initial = updateCheckIn(updateCheckIn(emptyJournal, first), second);
  const edited = { ...second, energy: 4 };
  assert.deepEqual(updateCheckIn(initial, edited).checkIns, [edited, first]);
  assert.deepEqual(initial.checkIns, [second, first]);
});

test('daily coach summary distinguishes an active workout, diary date and existing check-in', () => {
  const active: Workout = { id: 'active', name: 'Legs', programId: 'p', dayId: 'day', startedAt: '2026-11-23T09:00:00.000Z',
    finishedAt: null, exercises: [] };
  const date = '2026-11-23';
  const actual = coachSummary({
    date,
    meals: [
      { id: 'today', date, name: 'Test meal', meal: 'Lunch', unit: 'serving', quantity: 1,
        macros: { calories: 100, protein: 0, carbs: 0, fat: 0 }, source: 'Manual' },
      { id: 'yesterday', date: '2026-11-22', name: 'Yesterday', meal: 'Lunch', unit: 'serving', quantity: 1,
        macros: { calories: 250, protein: 0, carbs: 0, fat: 0 }, source: 'Manual' },
    ],
    training: { activeProgramId: null, session: active, history: [], programs: [] },
    journal: updateCheckIn(emptyJournal, { id: 'checkin', date, hunger: 3, energy: 2, sleep: 6, note: '' }),
  });
  assert.deepEqual(actual, {
    food: '1 food entry today.',
    training: 'Legs is in progress.',
    recovery: 'Energy 2/5, hunger 3/5, sleep 6 h.',
  });
});
