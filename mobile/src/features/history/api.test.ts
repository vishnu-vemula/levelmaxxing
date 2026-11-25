import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import type { FoodLog, WorkspaceHistoryMove, WorkspaceHistoryRow, WorkspaceSnapshot, Workout } from '@levelmaxing/contracts';
import { ApiFailure, type ApiRequester } from '../../platform/api.ts';
import { createHistoryApi, prepareHistoryCommand, unsupportedHistory } from './api.ts';
import { activeHistoryRows, matchesHistorySelection } from './selection.ts';

const id = '88eabaef-b75c-4005-bd6a-0e79430d54f5';
const tag = 'c'.repeat(64);
const food: FoodLog = {
  id: 'meal-b', name: 'Breakfast oats', date: '2026-09-14', meal: 'Breakfast', quantity: 80, unit: 'g',
  macros: { calories: 160, protein: 12, carbs: 20, fat: 4 }, source: 'Manual',
};
const row: WorkspaceHistoryRow<'meals'> = { id: food.id, date: food.date, value: food, tag: 'e'.repeat(64) };
const snapshot: WorkspaceSnapshot<'nutrition'> = { version: 6, value: { meals: [food], groceries: [], recipes: [] } };

test('archive pages preserve the authenticated requester, use a bounded keyset and reject a repeated row', async () => {
  const before = { date: '2026-09-14', id: 'meal-c' };
  const signal = new AbortController().signal;
  const calls: URL[] = [];
  let response = { rows: [row], next: { id: row.id, date: row.date } };
  const requester: ApiRequester = async (route, decode, actual, body) => {
    assert.equal(actual, signal);
    assert.equal(body, undefined);
    calls.push(new URL(route, 'https://example.test/functions/v1/api/'));
    const parsed = decode(response);
    if (!parsed) throw new ApiFailure(502, 'response_invalid');
    return parsed;
  };
  const transport = createHistoryApi(requester);
  assert.deepEqual(await transport.archivePage('meals', before, signal), response);
  const request = calls[0]!;
  assert.equal(request.pathname, '/functions/v1/api/v1/history');
  assert.deepEqual(Object.fromEntries(request.searchParams), {
    kind: 'meals', limit: '10', beforeDate: before.date, beforeId: before.id,
  });

  response = { rows: [{ ...row, id: before.id, value: { ...food, id: before.id } }], next: before };
  await assert.rejects(transport.archivePage('meals', before, signal), /response_invalid/);
});

test('preparing and retrying a move preserves the serialized IDs, operation ID and workspace precondition', async () => {
  const signal = new AbortController().signal;
  const displayed = [row];
  const sent: string[] = [];
  const requester: ApiRequester = async (route, decode, actual, body) => {
    assert.equal(actual, signal);
    if (route === 'v1/workspace/batch') {
      assert.deepEqual(body, { sections: [{ section: 'nutrition', known: null }] });
      return decode({ sections: [{ section: 'nutrition', tag, snapshot }] })!;
    }
    assert.equal(route, 'v1/history/move');
    sent.push(JSON.stringify(body));
    if (sent.length === 1) throw new Error('Synthetic lost response');
    const result = decode({ outcome: 'applied', moved: 1, version: 7, tag: 'd'.repeat(64) });
    if (!result) throw new ApiFailure(502, 'response_invalid');
    return result;
  };
  const transport = createHistoryApi(requester);
  const head = await transport.activeSnapshot('meals', signal);
  const command = prepareHistoryCommand('archive', 'meals', displayed, id, head);
  assert.ok(command);
  displayed.length = 0;
  assert.ok(Object.isFrozen(command.ids));
  assert.ok(Object.isFrozen(command));
  await assert.rejects(transport.move(command, signal), /lost response/);
  assert.equal((await transport.move(command, signal)).outcome, 'applied');
  assert.equal(sent[0], sent[1]);
  assert.deepEqual(JSON.parse(sent[0]!), {
    action: 'archive', kind: 'meals', ids: ['meal-b'], operationId: id, expectVersion: 6, known: tag,
  });
});

test('move responses must match the requested record count and next workspace version', async () => {
  const signal = new AbortController().signal;
  const command: WorkspaceHistoryMove = {
    action: 'restore', kind: 'meals', ids: [row.id], operationId: id, expectVersion: 6, known: tag, recordTags: [row.tag!],
  };
  for (const receipt of [
    { outcome: 'applied', moved: 2, version: 7, tag },
    { outcome: 'applied', moved: 1, version: 8, tag },
  ]) {
    const transport = createHistoryApi(async (_route, decode) => {
      const result = decode(receipt);
      if (!result) throw new ApiFailure(502, 'response_invalid');
      return result;
    });
    await assert.rejects(transport.move(command, signal), /response_invalid/);
  }
  assert.equal(unsupportedHistory(new ApiFailure(404, 'route_not_found')), true);
  assert.equal(unsupportedHistory(new ApiFailure(501, 'history_unavailable')), true);
  assert.equal(unsupportedHistory(new ApiFailure(403, 'participant_required')), false);
});

test('active rows use stable date and ID order and exclude incomplete workouts', () => {
  const workout: Workout = {
    id: 'complete', name: 'Squats', programId: 'p', dayId: 'day', exercises: [],
    startedAt: '2026-08-04T21:30:00.000Z', finishedAt: '2026-08-05T00:10:00.000Z',
  };
  const training = { programs: [], activeProgramId: null, session: null, history: [workout, { ...workout, id: 'incomplete', finishedAt: null }] };
  assert.deepEqual(activeHistoryRows('workouts', training), [{ date: '2026-08-05', id: 'complete', value: workout }]);
  assert.deepEqual(activeHistoryRows('meals', {
    groceries: [], recipes: [], meals: [food, { ...food, id: 'meal-a' }, { ...food, id: 'yesterday', date: '2026-09-13' }],
  }).map(({ id }) => id), ['meal-b', 'meal-a', 'yesterday']);
});

test('preflight rejects changed active revisions and changed archived records even when their IDs match', () => {
  const same = (active: WorkspaceSnapshot, available: WorkspaceHistoryRow[]) =>
    matchesHistorySelection(snapshot, active, [row], available, isDeepStrictEqual);
  assert.equal(same({ ...snapshot }, [row]), true);
  assert.equal(same({ ...snapshot, version: 7 }, [row]), false);
  assert.equal(same({ version: 6, value: { ...snapshot.value!, meals: [] } }, [row]), false);
  assert.equal(same(snapshot, []), false);
  assert.equal(same(snapshot, [{ ...row, value: { ...food, quantity: 42 } }]), false);
});

test('restore intent uses ordered displayed archive tags and rejects a record without its tag', () => {
  const another = { ...row, id: 'meal-c', value: { ...food, id: 'meal-c' }, tag: 'f'.repeat(64) };
  const prepared = prepareHistoryCommand('restore', 'meals', [another, row], id, { snapshot, tag });
  assert.ok(prepared);
  assert.deepEqual(prepared.ids, ['meal-c', 'meal-b']);
  assert.deepEqual(prepared.recordTags, [another.tag, row.tag]);
  assert.ok(Object.isFrozen(prepared.recordTags));
  const { tag: _omitted, ...unverified } = row;
  assert.equal(prepareHistoryCommand('restore', 'meals', [unverified], id, { snapshot, tag }), undefined);
});
