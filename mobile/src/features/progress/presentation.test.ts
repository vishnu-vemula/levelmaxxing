import assert from 'node:assert/strict';
import test from 'node:test';
import { formatWeight, parseDisplayedWeight } from './presentation.ts';

test('weight unit preference converts pound input to the same stored grams contract', () => {
  const date = '2026-11-23';
  assert.deepEqual(parseDisplayedWeight('180', date, 'lb'), { grams: 81647, measuredOn: date });
  assert.deepEqual(parseDisplayedWeight('81,647', date, 'kg'), { grams: 81647, measuredOn: date });
  assert.match(formatWeight(81647, 'lb'), /^180 lb$/);
  assert.equal(parseDisplayedWeight('1e2', date, 'lb'), undefined);
  assert.equal(parseDisplayedWeight('40', date, 'lb'), undefined);
  assert.equal(parseDisplayedWeight('100', '2026-02-29', 'lb'), undefined);
});
