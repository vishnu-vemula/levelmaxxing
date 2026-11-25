import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FoodLog, JournalData, NutritionData } from '@levelmaxing/contracts';
import { combineWorkspaceChanges } from './merge.ts';

const apple: FoodLog = {
  id: 'fruit', name: 'Apple', date: '2026-11-23', meal: 'Breakfast', quantity: 1, unit: 'serving',
  macros: { calories: 100, protein: 0, carbs: 25, fat: 0 }, source: 'Manual',
};
const base: NutritionData = { meals: [apple], recipes: [], groceries: [] };

test('combines a remote deletion with an independent local addition without resurrecting the removed row', () => {
  const local = { ...base, meals: [apple, { ...apple, id: 'supper', meal: 'Dinner' as const }] };
  const remote = { ...base, meals: [] };
  assert.deepEqual(combineWorkspaceChanges('nutrition', { version: 1, value: base }, local, { version: 2, value: remote }),
    { ...base, meals: [local.meals[1]] });
});

test('blocks a delete-versus-edit and a same-version restored section', () => {
  const changed = { ...base, meals: [{ ...apple, name: 'Pear' }] };
  assert.equal(combineWorkspaceChanges('nutrition', { version: 1, value: base }, changed,
    { version: 2, value: { ...base, meals: [] } }), undefined);
  assert.equal(combineWorkspaceChanges('nutrition', { version: 2, value: base }, base,
    { version: 2, value: changed }), undefined);
});

test('treats two fresh check-ins on the same local calendar day as overlapping records', () => {
  const checkIn = { date: '2026-11-23', hunger: 2, energy: 3, sleep: 7, note: '' };
  const local: JournalData = { checkIns: [{ ...checkIn, id: 'local' }], activities: [], bookmarks: [] };
  const remote: JournalData = { checkIns: [{ ...checkIn, id: 'remote' }], activities: [], bookmarks: [] };
  assert.equal(combineWorkspaceChanges('journal', { version: 0, value: null }, local, { version: 1, value: remote }), undefined);
});
