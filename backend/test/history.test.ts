import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {test, type TestContext} from 'node:test';
import {
  parseWorkspaceBatchResponse, parseWorkspaceHistoryMoveResult, parseWorkspaceHistoryPage, WORKSPACE_EMPTY_TAG, WORKSPACE_MAX_BYTES,
  type FoodLog, type NutritionData, type TrainingData, type Workout, type WorkspaceHistoryKind, type WorkspaceHistoryMove,
  type WorkspaceHistoryQuery, type WorkspaceHistoryRow, type WorkspaceSave, type WorkspaceSection,
} from '@levelmaxing/contracts';
import {createLocalApp} from '../src/local.ts';
import {createNodeServer} from '../src/platform/node-http.ts';

const token = () => randomBytes(32).toString('hex');

async function fixture(testContext: TestContext) {
  const participantToken = token();
  const secondParticipantToken = token();
  const operatorToken = token();
  const config = {participantToken, secondParticipantToken, operatorToken};
  let app = createLocalApp(config);
  const server = createNodeServer((request) => app(request), 0);
  testContext.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = 'http://127.0.0.1:' + address.port;

  function request(path: string, input?: unknown, bearer: string | null = participantToken) {
    return fetch(url + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {...(bearer ? {authorization: 'Bearer ' + bearer} : {}),
        ...(input === undefined ? {} : {'content-type': 'application/json'})},
      ...(input === undefined ? {} : {body: JSON.stringify(input)}),
    });
  }

  async function post(path: string, input: unknown, bearer = participantToken) {
    const response = await request(path, input, bearer);
    assert.equal(response.status, 200, path);
    return response.json();
  }

  async function head(section: WorkspaceSection, bearer = participantToken) {
    const input = {sections: [{section, known: null}]};
    const page = parseWorkspaceBatchResponse(input, await post('/v1/workspace/batch', input, bearer));
    const entry = page?.sections[0];
    assert.ok(entry?.snapshot);
    return {expectVersion: entry.snapshot.version, known: entry.tag, value: entry.snapshot.value};
  }

  async function move(command: WorkspaceHistoryMove, bearer = participantToken) {
    const result = parseWorkspaceHistoryMoveResult(await post('/v1/history/move', command, bearer));
    assert.ok(result);
    return result;
  }

  async function page(query: WorkspaceHistoryQuery, bearer = participantToken) {
    const params = new URLSearchParams({kind: query.kind, limit: String(query.limit)});
    if (query.before) {
      params.set('beforeDate', query.before.date);
      params.set('beforeId', query.before.id);
    }
    const response = await request('/v1/history?' + params.toString(), undefined, bearer);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = parseWorkspaceHistoryPage(query.kind, await response.json());
    assert.ok(data);
    return data;
  }

  return {
    request, post, head, move, page, secondParticipantToken, operatorToken,
    rebuild: () => { app = createLocalApp(config); },
    save: (command: WorkspaceSave) => post('/v1/workspace/save', command),
  };
}

function meal(id: string, date = '2026-10-06'): FoodLog {
  return {
    id, date, name: 'Sample lentil bowl', meal: 'Lunch', quantity: 1,
    unit: 'serving', source: 'Manual', macros: {calories: 310, protein: 21, carbs: 30, fat: 10},
  };
}

function nutrition(meals: FoodLog[]): NutritionData {
  return {meals, recipes: [], groceries: []};
}

function training(history: Workout[], session: Workout | null = null): TrainingData {
  return {history, session, programs: [], activeProgramId: null};
}

function workout(id: string, finishedAt: string | null): Workout {
  return {id, name: 'Sample workout', programId: 'program', dayId: 'day', startedAt: '2026-10-05T03:25:00.000Z', finishedAt,
    exercises: [{id: 'exercise', name: 'Sample squat', sets: 2, reps: 8, restSeconds: 90, logged: [{id: 'set-a', reps: 8, grams: 28000}]}]};
}

function archiveOperation(kind: WorkspaceHistoryKind, ids: string[], head: {expectVersion: number; known: string}) {
  return {action: 'archive' as const, kind, ids, expectVersion: head.expectVersion, known: head.known, operationId: randomUUID()};
}

function rowTag(row: WorkspaceHistoryRow): string {
  const tag = row.tag;
  assert.ok(tag);
  assert.match(tag, /^[0-9a-f]{64}$/);
  return tag;
}

function restoreOperation(kind: WorkspaceHistoryKind, rows: WorkspaceHistoryRow[], head: {expectVersion: number; known: string}) {
  return {action: 'restore' as const, kind, ids: rows.map(({id}) => id), recordTags: rows.map(rowTag),
    expectVersion: head.expectVersion, known: head.known, operationId: randomUUID()};
}

test('archived meals paginate by date and ID, remain account-scoped, and restore their original data and identities over HTTP', async (t) => {
  const api = await fixture(t);
  const records = [meal('today', '2026-10-23'), meal('same-a'), meal('same-z'), meal('earlier', '2026-10-05')];
  const seeded: WorkspaceSave = {section: 'nutrition', expect: 0, operationId: randomUUID(), value: nutrition(records)};
  const initial = await api.save(seeded);
  assert.deepEqual(initial, {outcome: 'applied', snapshot: {version: 1, value: seeded.value}});

  const archive = archiveOperation('meals', ['same-a', 'earlier', 'same-z'], await api.head('nutrition'));
  const moved = await api.move(archive);
  assert.equal(moved.outcome, 'applied');
  assert.equal(moved.moved, 3);
  assert.equal(moved.version, 2);
  const active = await api.head('nutrition');
  assert.equal(moved.tag, active.known);
  assert.deepEqual(active.value, nutrition([records[0]!]));

  const first = await api.page({kind: 'meals', limit: 1});
  assert.equal(first.rows.length, 1);
  const {tag: firstTag, ...firstRecord} = first.rows[0]!;
  assert.equal(firstTag, rowTag(first.rows[0]!));
  assert.deepEqual(firstRecord, {id: 'same-z', date: records[2]!.date, value: records[2]});
  assert.deepEqual(first.next, {id: 'same-z', date: records[2]!.date});
  assert.ok(first.next);
  const second = await api.page({kind: 'meals', limit: 2, before: first.next});
  assert.deepEqual(second.rows.map(({id}) => id), ['same-a', 'earlier']);
  assert.equal(second.next, null);
  assert.deepEqual(await api.page({kind: 'meals', limit: 20}, api.secondParticipantToken), {rows: [], next: null});
  assert.deepEqual(await api.move(archive, api.secondParticipantToken), {outcome: 'conflict', moved: 0, version: 0, tag: WORKSPACE_EMPTY_TAG});

  const stale = {...seeded, expect: active.expectVersion, operationId: randomUUID()};
  assert.deepEqual(await api.save(stale), {outcome: 'conflict', snapshot: {version: 2, value: active.value}});
  assert.deepEqual(await api.post('/v1/workspace/save-checked', {command: {...stale, operationId: randomUUID()}, known: active.known}),
    {outcome: 'conflict', snapshot: {version: 2, value: active.value}});
  assert.deepEqual(await api.save(seeded), initial);
  const restore = restoreOperation('meals', [second.rows[0]!, first.rows[0]!], active);
  const mismatched = {...restore, operationId: randomUUID(), recordTags: restore.recordTags.slice().reverse()};
  assert.deepEqual(await api.move(mismatched), {outcome: 'conflict', moved: 0, version: 2, tag: active.known});
  assert.equal((await api.request('/v1/history/move', {...restore, recordTags: []})).status, 400);
  assert.equal((await api.request('/v1/history/move', {...archive, recordTags: restore.recordTags})).status, 400);
  assert.equal((await api.move(restore)).outcome, 'applied');
  assert.deepEqual((await api.head('nutrition')).value, nutrition([records[0]!, records[2]!, records[1]!]));
  assert.deepEqual((await api.page({kind: 'meals', limit: 20})).rows.map(({id}) => id), ['earlier']);
  assert.deepEqual(await api.move(archive), moved);
  assert.deepEqual(await api.save(stale), {outcome: 'conflict', snapshot: {version: 2, value: active.value}});
  const reused = await api.request('/v1/history/move', {...archive, ids: ['earlier']});
  assert.equal(reused.status, 409);
  assert.equal((await reused.json()).code, 'history_operation_changed');
});

test('archive rejects ineligible workouts, preserves exact prior receipts, and denies untrusted HTTP input', async (t) => {
  const api = await fixture(t);
  const pending = workout('pending', null);
  const completed = workout('completed', '2026-10-06T00:07:00.000Z');
  const activeSession = workout('session', null);
  await api.save({section: 'training', expect: 0, operationId: randomUUID(), value: training([completed, pending], activeSession)});

  const original = await api.head('training');
  const mixed = archiveOperation('workouts', ['completed', 'pending'], original);
  assert.deepEqual(await api.move(mixed), {outcome: 'missing', moved: 0, version: 1, tag: original.known});
  assert.equal((await api.move(archiveOperation('workouts', ['session'], original))).outcome, 'missing');
  assert.deepEqual(await api.page({kind: 'workouts', limit: 20}), {rows: [], next: null});
  assert.equal((await api.move(archiveOperation('workouts', ['completed'], original))).outcome, 'applied');
  const head = await api.head('training');
  assert.deepEqual(head.value, training([pending], activeSession));
  assert.deepEqual(await api.move(mixed), {outcome: 'missing', moved: 0, version: 1, tag: original.known});
  const page = await api.page({kind: 'workouts', limit: 1});
  const {tag, ...row} = page.rows[0]!;
  assert.equal(tag, rowTag(page.rows[0]!));
  assert.deepEqual(row, {id: completed.id, date: '2026-10-06', value: completed});

  assert.deepEqual(await api.save({section: 'training', expect: head.expectVersion, operationId: randomUUID(),
    value: training([pending], {...completed, finishedAt: null})}), {outcome: 'conflict', snapshot: {version: 2, value: head.value}});

  assert.equal((await api.request('/v1/history?kind=workouts', undefined, null)).status, 401);
  assert.equal((await api.request('/v1/history?kind=workouts', undefined, api.operatorToken)).status, 403);
  assert.equal((await api.request('/v1/history/move', mixed, api.operatorToken)).status, 403);
  for (const query of [
    'kind=other', 'kind=workouts&kind=meals', 'kind=workouts&limit=21', 'kind=workouts&beforeId=completed',
    'kind=workouts&beforeId=completed&beforeDate=2026-02-31', 'kind=workouts&accountId=foreign',
  ]) {
    assert.equal((await api.request('/v1/history?' + query)).status, 400);
  }
  for (const input of [{...mixed, ids: ['completed', 'completed']}, {...mixed, known: WORKSPACE_EMPTY_TAG}, {...mixed, accountId: randomUUID()}]) {
    assert.equal((await api.request('/v1/history/move', input)).status, 400);
  }
  const oversized = await api.request('/v1/history/move', {...mixed, tail: 'x'.repeat(4096)});
  assert.equal(oversized.status, 413);
});

test('concurrent archive and workspace writes serialize, and a lost response replays the original move', async (t) => {
  const api = await fixture(t);
  const original = nutrition([meal('one'), meal('two')]);
  assert.equal((await api.save({section: 'nutrition', expect: 0, operationId: randomUUID(), value: original})).outcome, 'applied');

  const before = await api.head('nutrition');
  const archiveCommand = archiveOperation('meals', ['one'], before);
  const write: WorkspaceSave = {section: 'nutrition', expect: 1, operationId: randomUUID(), value: nutrition([meal('one'), meal('two'), meal('three')])};
  const [archived, updated] = await Promise.all([api.move(archiveCommand), api.save(write)]);
  assert.deepEqual([archived.outcome, updated.outcome].sort(), ['applied', 'conflict']);
  assert.equal((await api.head('nutrition')).expectVersion, 2);
  assert.deepEqual((await api.page({kind: 'meals', limit: 20})).rows.map(({id}) => id), archived.outcome === 'applied' ? ['one'] : []);
  assert.deepEqual(await api.move(archiveCommand), archived);
  assert.deepEqual(await api.save(write), updated);

  const next = await api.head('nutrition');
  const adopt = archiveOperation('meals', ['two'], next);
  const [first, duplicate] = await Promise.all([api.move(adopt), api.move(adopt)]);
  assert.equal(first.outcome, 'applied');
  assert.deepEqual(duplicate, first);
  assert.equal((await api.head('nutrition')).expectVersion, 3);
});

test('restore that would exceed the legacy workspace write cap keeps the active document and archived record intact', async (t) => {
  const api = await fixture(t);
  const detail = '🍲'.repeat(60);
  const large = {...meal('large'), name: detail, source: detail, unit: '🍽'.repeat(25)};
  assert.equal((await api.save({section: 'nutrition', expect: 0, operationId: randomUUID(), value: nutrition([large])})).outcome, 'applied');
  assert.equal((await api.move(archiveOperation('meals', [large.id], await api.head('nutrition')))).outcome, 'applied');

  const draft: WorkspaceSave = {section: 'nutrition', expect: 2, operationId: randomUUID(), value: nutrition([])};
  let size = Buffer.byteLength(JSON.stringify({...draft, expect: Number.MAX_SAFE_INTEGER}));
  for (let n = 0; ; n++) {
    const item = meal('active-' + n);
    const sizeAfter = size + Buffer.byteLength(JSON.stringify(item)) + Number(n > 0);
    if (sizeAfter > WORKSPACE_MAX_BYTES) break;
    draft.value.meals.push(item);
    size = sizeAfter;
  }
  assert.equal((await api.save(draft)).outcome, 'applied');
  const current = await api.head('nutrition');
  const archiveBeforeRestore = await api.page({kind: 'meals', limit: 20});
  const refused = await api.move(restoreOperation('meals', archiveBeforeRestore.rows, current));
  assert.equal(refused.outcome, 'capacity');
  assert.equal(refused.moved, 0);
  assert.deepEqual(await api.head('nutrition'), current);
  const archived = await api.page({kind: 'meals', limit: 20});
  assert.deepEqual(archived, archiveBeforeRestore);
  assert.deepEqual(archived.rows[0]?.value, large);
});

test('archive page remains byte-bounded and walks all large workouts without losing a row', async (t) => {
  const api = await fixture(t);
  // Only one of these fits within an ordinary training workspace at a time.
  const large: Workout = {...workout('large', '2026-10-06T00:07:00.000Z'), exercises: Array.from({length: 52}, (_, i) => ({
    id: 'exercise-' + i, name: 'Synthetic movement', sets: 90, reps: 8, restSeconds: 60,
    logged: Array.from({length: 90}, (_, j) => ({id: 'example-set-' + j, reps: 8, grams: 28000})),
  }))};
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > 200 * 1024);
  for (let i = 0; i < 6; i++) {
    const record = {...large, id: 'archive-' + i};
    assert.equal((await api.save({section: 'training', expect: i * 2, operationId: randomUUID(), value: training([record])})).outcome, 'applied');
    assert.equal((await api.move(archiveOperation('workouts', [record.id], await api.head('training')))).outcome, 'applied');
  }
  const first = await api.page({kind: 'workouts', limit: 20});
  assert.ok(first.rows.length > 0 && first.rows.length < 6 && first.next);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 1024 * 1024);
  const rest = await api.page({kind: 'workouts', limit: 20, before: first.next});
  assert.deepEqual([...first.rows, ...rest.rows].map(({id}) => id),
    ['archive-5', 'archive-4', 'archive-3', 'archive-2', 'archive-1', 'archive-0']);
  assert.equal(rest.next, null);
});

test('a restore fences changed archive contents even when the active workspace reuses the same version and tag', async (t) => {
  const api = await fixture(t);
  const active = meal('unchanged');
  const old = meal('archived');
  async function seedAndArchive(record: FoodLog) {
    const seeded = {section: 'nutrition' as const, expect: 0, operationId: randomUUID(), value: nutrition([active, record])};
    assert.equal((await api.save(seeded)).outcome, 'applied');
    const command = archiveOperation('meals', [record.id], await api.head('nutrition'));
    assert.equal((await api.move(command)).outcome, 'applied');
    return api.page({kind: 'meals', limit: 2});
  }

  const originalArchive = await seedAndArchive(old);
  const originalHead = await api.head('nutrition');
  const staleRestore = restoreOperation('meals', originalArchive.rows, originalHead);

  api.rebuild();
  const currentRecord = {...old, name: 'Different sample meal after restore'};
  const currentArchive = await seedAndArchive(currentRecord);
  assert.deepEqual(await api.head('nutrition'), originalHead);
  assert.notEqual(rowTag(originalArchive.rows[0]!), rowTag(currentArchive.rows[0]!));

  const conflict = {outcome: 'conflict', moved: 0, version: originalHead.expectVersion, tag: originalHead.known};
  assert.deepEqual(await api.move(staleRestore), conflict);
  assert.deepEqual(await api.head('nutrition'), originalHead);
  assert.deepEqual(await api.page({kind: 'meals', limit: 2}), currentArchive);
  const fresh = restoreOperation('meals', currentArchive.rows, originalHead);
  const changedReceipt = await api.request('/v1/history/move', {...fresh, operationId: staleRestore.operationId});
  assert.equal(changedReceipt.status, 409);
  assert.equal((await changedReceipt.json()).code, 'history_operation_changed');
  assert.equal((await api.move(fresh)).outcome, 'applied');
  assert.deepEqual((await api.head('nutrition')).value, nutrition([active, currentRecord]));
  assert.deepEqual(await api.move(staleRestore), conflict);
});

test('restored workouts sort with active history by full finished time or started time, then descending ID', async (t) => {
  const api = await fixture(t);
  const oldest = workout('old', '2026-10-05T04:07:00.000Z');
  const tiedA = workout('tied-a', '2026-10-06T12:07:00.000Z');
  const tiedZ = workout('tied-z', '2026-10-06T12:07:00.000Z');
  const fallback = {...workout('pending', null), startedAt: '2026-10-06T15:07:00.000Z'};
  const laterSameDay = workout('later', '2026-10-06T13:07:00.000Z');
  const seeded = {section: 'training' as const, expect: 0, operationId: randomUUID(),
    value: training([oldest, tiedA, fallback, tiedZ, laterSameDay])};
  assert.equal((await api.save(seeded)).outcome, 'applied');
  const archive = archiveOperation('workouts', [tiedZ.id, laterSameDay.id], await api.head('training'));
  assert.equal((await api.move(archive)).outcome, 'applied');
  const archiveRows = (await api.page({kind: 'workouts', limit: 4})).rows;
  const restore = restoreOperation('workouts', archiveRows, await api.head('training'));
  assert.equal((await api.move(restore)).outcome, 'applied');
  assert.deepEqual((await api.head('training')).value, training([fallback, laterSameDay, tiedZ, tiedA, oldest]));
});
