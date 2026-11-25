import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {
  operationId, parseDeviceRegistration, parseProblemDetails, parsePullResponse, parsePushResponse,
  type DeviceRegistration, type SyncOperation,
} from '@levelmaxing/contracts';
import {createLocalApp} from '../src/local.ts';
import {createNodeServer} from '../src/platform/node-http.ts';

const participant = 'local-test-participant-11111111111111';
const otherAccount = 'local-test-other-account-222222222222';
const operator = 'local-test-operator-33333333333333333';
const allowedOrigin = 'http://localhost:5173';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function setup(t: TestContext) {
  const logs: unknown[] = [];
  const app = createLocalApp({participantToken: participant, secondParticipantToken: otherAccount,
    operatorToken: operator, allowedOrigin, log: record => logs.push(record)});
  const server = createNodeServer(app, 0);
  t.after(async () => {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  async function request(path: string, token?: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (token !== undefined) headers.set('authorization', `Bearer ${token}`);
    return fetch(base + path, {...init, headers, signal: AbortSignal.timeout(3_000)});
  }
  const post = (path: string, token: string, body: unknown) => request(path, token, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
  });
  async function register(n: number, token = participant) {
    const response = await post('/v1/devices', token, {deviceId: uuid(n)});
    assert.equal(response.status, 200);
    const registered = parseDeviceRegistration(await response.json());
    assert.ok(registered);
    return registered;
  }
  async function push(device: DeviceRegistration, ops: SyncOperation[], token = participant) {
    const response = await post('/v1/sync/push', token, {...device, ops});
    assert.equal(response.status, 200);
    const result = parsePushResponse(await response.json());
    assert.ok(result);
    return result.results;
  }
  async function pull(token = participant, cursor?: string, limit?: number) {
    const params = new URLSearchParams();
    if (cursor !== undefined) params.set('cursor', cursor);
    if (limit !== undefined) params.set('limit', String(limit));
    const response = await request('/v1/sync/pull?' + params, token);
    assert.equal(response.status, 200);
    const result = parsePullResponse(await response.json());
    assert.ok(result);
    return result;
  }
  return {request, post, register, push, pull, logs};
}

function measurement(device: DeviceRegistration, seq: number, id: number, grams = 81_125): SyncOperation {
  return {
    seq, opId: operationId(device.deviceId, device.generation, seq), type: 'progress.weight.record',
    version: 1, entityId: uuid(id), expectedVersion: 0, payload: {grams, measuredOn: '2026-11-23'},
  };
}

async function assertProblem(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json\b/);
  const problem = parseProblemDetails(await response.json());
  assert.ok(problem);
  assert.equal(problem.status, status);
  assert.equal(problem.code, code);
  assert.equal(problem.instance, 'urn:uuid:' + response.headers.get('x-request-id'));
}

test('two devices append once per sequence and read ordered changes through a pinned cursor', async t => {
  const {register, push, pull, logs} = await setup(t);
  const [phone, tablet] = await Promise.all([register(1), register(2)]);
  assert.equal(tablet.epoch, phone.epoch);
  const first = measurement(phone, 1, 101);
  const firstResult = await push(phone, [first]);
  assert.deepEqual(firstResult, [{seq: 1, opId: first.opId, status: 'applied', revision: '1', entityVersion: 1}]);
  assert.deepEqual(await push(phone, [first]), firstResult);
  const changed = {...first, payload: {...first.payload, grams: 91_000}};
  assert.deepEqual(await push(phone, [changed]), [{seq: 1, opId: first.opId, status: 'conflict', code: 'operation_body_changed'}]);

  const third = measurement(tablet, 3, 103);
  assert.deepEqual(await push(tablet, [third]), [{seq: 3, opId: third.opId, status: 'sequence_gap', code: 'sequence_gap', expectedSeq: 1}]);
  const duplicateId = measurement(tablet, 1, 101);
  assert.deepEqual(await push(tablet, [duplicateId]), [{seq: 1, opId: duplicateId.opId, status: 'conflict', code: 'entity_already_exists'}]);
  const second = measurement(tablet, 2, 102);
  assert.deepEqual(await push(tablet, [second]), [{seq: 2, opId: second.opId, status: 'applied', revision: '2', entityVersion: 1}]);
  const page1 = await pull(participant, undefined, 1);
  assert.equal(page1.hasMore, true);
  assert.deepEqual(page1.groups, [{revision: '1', items: [{type: 'progress.weight', id: first.entityId, version: 1, view: first.payload}]}]);
  assert.equal((await push(tablet, [third]))[0]?.status, 'applied');
  const page2 = await pull(participant, page1.nextCursor, 1);
  assert.equal(page2.hasMore, false);
  assert.deepEqual(page2.groups.map(group => group.revision), ['2']);
  const nextWindow = await pull(participant, page2.nextCursor);
  assert.deepEqual(nextWindow.groups.map(group => group.revision), ['3']);
  assert.deepEqual((await pull(participant, nextWindow.nextCursor)).groups, []);
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(`${participant}|${first.entityId}`));
  for (const log of logs) assert.deepEqual(Object.keys(log as object).sort(), ['durationMs', 'event', 'requestId', 'route', 'status']);
});

test('participant state, cursors, and operator access stay separated', async t => {
  const {request, post, register, push, pull} = await setup(t);
  assert.deepEqual(await (await request('/healthz')).json(), {status: 'ok'});
  await assertProblem(await request('/v1/session'), 401, 'unauthenticated');
  await assertProblem(await request('/v1/session', 'invalid'), 401, 'unauthenticated');
  await assertProblem(await request('/v1/admin/access', participant), 403, 'operator_step_up_required');
  const operatorAccess = await request('/v1/admin/access', operator);
  assert.equal(operatorAccess.status, 200);
  assert.deepEqual(await operatorAccess.json(), {role: 'operator'});
  await assertProblem(await request('/v1/sync/pull', operator), 403, 'participant_required');

  const [device, isolated] = await Promise.all([register(1), register(1, otherAccount)]);
  assert.notEqual(isolated.epoch, device.epoch);
  const op = measurement(device, 1, 101);
  await push(device, [op]);
  assert.deepEqual((await pull(otherAccount)).groups, []);
  await assertProblem(await post('/v1/sync/push', otherAccount, {...device, ops: [op]}), 409, 'sync_context_changed');
  const cursor = (await pull()).nextCursor;
  await assertProblem(await request('/v1/sync/pull?cursor=' + cursor, otherAccount), 410, 'cursor_expired');
  const tampered = (cursor.startsWith('A') ? 'B' : 'A') + cursor.slice(1);
  await assertProblem(await request('/v1/sync/pull?cursor=' + tampered, participant), 410, 'cursor_expired');
  const foreign = await request('/healthz', undefined, {headers: {origin: 'https://untrusted.example'}});
  await assertProblem(foreign, 403, 'origin_denied');
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  const preflight = await request('/v1/sync/push', undefined, {method: 'OPTIONS', headers: {
    origin: allowedOrigin, 'access-control-request-method': 'POST',
  }});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin);
});

test('invalid transport and invalid commands leave the account with no changes', async t => {
  const {request, post, register, pull} = await setup(t);
  const device = await register(1);
  const op = measurement(device, 1, 101);
  await assertProblem(await post('/v1/devices', participant, {deviceId: 'invalid'}), 400, 'invalid_device');
  await assertProblem(await request('/v1/devices', participant, {method: 'POST', body: '{}'}), 415, 'invalid_content_type');
  await assertProblem(await request('/v1/devices', participant, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: '{',
  }), 400, 'invalid_json');
  await assertProblem(await post('/v1/devices', participant, {deviceId: 'x'.repeat(1500)}), 413, 'body_too_large');
  await assertProblem(await request('/v1/sync/pull?limit=101', participant), 400, 'invalid_page_size');
  for (const invalid of [
    {...op, opId: 'wrong'}, {...op, payload: {...op.payload, grams: 0}},
    {...op, payload: {...op.payload, measuredOn: '2026-11-31'}},
  ]) await assertProblem(await post('/v1/sync/push', participant, {...device, ops: [invalid]}), 400, 'invalid_sync_command');
  assert.deepEqual((await pull()).groups, []);
});

test('workspace compares versions, replays exact receipts, and scopes sections to the signed-in account', async t => {
  const {request, post} = await setup(t);
  const empty = {version: 0, value: null};
  const read = async (section: string, token = participant) => {
    const response = await request('/v1/workspace?section=' + section, token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  const save = async (command: unknown, token = participant) => {
    const response = await post('/v1/workspace/save', token, command);
    assert.equal(response.status, 200);
    return response.json();
  };
  const value = {checkIns: [], activities: [], bookmarks: ['strength']};
  const command = {section: 'journal', expect: 0, operationId: uuid(200), value};
  for (const section of ['profile', 'training', 'nutrition', 'journal']) {
    assert.deepEqual(await read(section), empty);
  }
  const initial = {outcome: 'applied', snapshot: {version: 1, value}};
  assert.deepEqual(await save(command), initial);
  assert.deepEqual(await save({...command, value: {...value, bookmarks: ['strength']}}), initial);
  assert.deepEqual(await save({...command, value: {bookmarks: ['strength'], activities: [], checkIns: []}}), initial);
  await assertProblem(await post('/v1/workspace/save', participant, {
    ...command, value: {...value, bookmarks: ['hypertrophy']},
  }), 409, 'workspace_operation_changed');
  await assertProblem(await post('/v1/workspace/save', participant, {
    ...command, section: 'nutrition', value: {meals: [], recipes: [], groceries: []},
  }), 409, 'workspace_operation_changed');
  const stale = {...command, operationId: uuid(201), value: {...value, bookmarks: []}};
  const conflict = {outcome: 'conflict', snapshot: initial.snapshot};
  assert.deepEqual(await save(stale), conflict);
  const next = {...value, bookmarks: ['recovery']};
  assert.deepEqual(await save({...stale, operationId: uuid(202), expect: 1, value: next}), {
    outcome: 'applied', snapshot: {version: 2, value: next},
  });
  assert.deepEqual(await save(stale), conflict);
  assert.deepEqual(await save(command), initial);
  assert.deepEqual(await read('journal'), {version: 2, value: next});
  assert.deepEqual(await read('training'), empty);
  assert.deepEqual(await read('journal', otherAccount), empty);
  const isolated = {...value, bookmarks: ['balance']};
  assert.deepEqual(await save({...command, value: isolated}, otherAccount), {
    outcome: 'applied', snapshot: {version: 1, value: isolated},
  });
  assert.deepEqual(await read('journal'), {version: 2, value: next});
});

test('workspace rejects invalid transport and nested data and atomically resolves concurrent first saves', async t => {
  const {request, post} = await setup(t);
  const path = '/v1/workspace/save';
  const journal = '/v1/workspace?section=journal';
  const empty = {version: 0, value: null};
  const value = {checkIns: [], activities: [], bookmarks: []};
  const command = {section: 'journal', expect: 0, operationId: uuid(205), value};
  await assertProblem(await request(journal), 401, 'unauthenticated');
  await assertProblem(await post(path, operator, command), 403, 'participant_required');
  await assertProblem(await request('/v1/workspace?section=unknown', participant), 400, 'invalid_workspace_section');
  await assertProblem(await request(journal + '&section=profile', participant), 400, 'invalid_workspace_section');
  for (const invalid of [
    {...command, operationId: 'invalid'}, {...command, expect: -1}, {...command, value: {}},
    {...command, value: {...value, checkIns: [{id: 'bad-date', date: '2026-02-29', hunger: 3, energy: 2, sleep: 8, note: ''}]}},
    {...command, value: {...value, activities: [
      {id: 'duplicate-id', date: '2026-11-23', name: 'Walk', minutes: 30},
      {id: 'duplicate-id', date: '2026-11-24', name: 'Swim', minutes: 10},
    ]}},
  ]) await assertProblem(await post(path, participant, invalid), 400, 'invalid_workspace_command');
  await assertProblem(await post(path, participant, {...command, value: 'x'.repeat(256 * 1024)}), 413, 'body_too_large');
  assert.deepEqual(await (await request(journal, participant)).json(), empty);

  const replies = await Promise.all([
    post(path, participant, command),
    post(path, participant, {...command, operationId: uuid(206), value: {...value, bookmarks: ['training']}}),
  ]);
  assert.deepEqual(replies.map(response => response.status), [200, 200]);
  const [one, two] = await Promise.all(replies.map(response => response.json()));
  assert.deepEqual([one.outcome, two.outcome].sort(), ['applied', 'conflict']);
  assert.equal(one.snapshot.version, 1);
  assert.deepEqual(one.snapshot, two.snapshot);
  assert.deepEqual(await (await request(journal, participant)).json(), one.snapshot);
});
