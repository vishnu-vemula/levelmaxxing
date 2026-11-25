import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {test, type TestContext} from 'node:test';
import {
  ACCOUNT_EXPORT_WEIGHT_PAGE_GROUPS, operationId, parseAccountExportPage, parseDeviceRegistration,
  parseProblemDetails, parsePullResponse, parsePushResponse, type DeviceRegistration,
} from '@levelmaxing/contracts';
import {createLocalApp} from '../src/local.ts';
import {createNodeServer} from '../src/platform/node-http.ts';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const weightCount = ACCOUNT_EXPORT_WEIGHT_PAGE_GROUPS + 1;

async function setup(t: TestContext) {
  const participant = randomBytes(32).toString('hex');
  const other = randomBytes(32).toString('hex');
  const operator = randomBytes(32).toString('hex');
  const logs: unknown[] = [];
  const app = createLocalApp({
    participantToken: participant, secondParticipantToken: other,
    operatorToken: operator, log: record => logs.push(record),
  });
  const server = createNodeServer(app, 0);
  t.after(async () => {
    if (server.listening) await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, token?: string, payload?: unknown) => fetch(base + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? {authorization: 'Bearer ' + token} : {}),
      ...(payload === undefined ? {} : {'content-type': 'application/json'}),
    },
    ...(payload === undefined ? {} : {body: JSON.stringify(payload)}),
    signal: AbortSignal.timeout(3_000),
  });
  async function register(token: string, deviceId: string) {
    const response = await request('/v1/devices', token, {deviceId});
    assert.equal(response.status, 200);
    const device = parseDeviceRegistration(await response.json());
    assert.ok(device);
    return device;
  }
  async function logWeights(token: string, device: DeviceRegistration, numbers: number[], prefix: number) {
    const response = await request('/v1/sync/push', token, {...device, ops: numbers.map((seq) => ({
      seq, opId: operationId(device.deviceId, device.generation, seq), type: 'progress.weight.record',
      version: 1, entityId: uuid(prefix + seq), expectedVersion: 0,
      payload: {grams: 80_000 + seq, measuredOn: '2026-11-23'},
    }))});
    assert.equal(response.status, 200);
    const receipts = parsePushResponse(await response.json())?.results;
    assert.equal(receipts?.length, numbers.length);
    assert.ok(receipts?.every(result => result.status === 'applied'));
  }
  async function readExport(token: string, cursor?: string) {
    const path = '/v1/account/export' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
    const response = await request(path, token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = parseAccountExportPage(await response.json());
    assert.ok(data);
    return data;
  }
  return {participant, other, operator, request, register, logWeights, readExport, logs};
}

async function assertProblem(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = parseProblemDetails(await response.json());
  assert.equal(data?.code, code);
}

test('account export includes isolated, versioned workspace records and a fixed weight range across HTTP pages', async t => {
  const {participant, other, request, register, logWeights, readExport, logs} = await setup(t);
  const device = await register(participant, uuid(1));
  const otherDevice = await register(other, uuid(2));
  await logWeights(participant, device, Array.from({length: weightCount}, (_, index) => index + 1), 100);
  await logWeights(other, otherDevice, [1], 200);
  const firstJournal = {checkIns: [], activities: [], bookmarks: ['training-log']};
  const finalJournal = {...firstJournal, bookmarks: ['check-in']};
  const otherJournal = {...firstJournal, bookmarks: ['other-account-only']};
  for (const {token, value, expect, operationId} of [
    {token: participant, value: firstJournal, expect: 0, operationId: uuid(301)},
    {token: participant, value: finalJournal, expect: 1, operationId: uuid(302)},
    {token: other, value: otherJournal, expect: 0, operationId: uuid(303)},
  ]) {
    const response = await request('/v1/workspace/save', token, {section: 'journal', value, expect, operationId});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).outcome, 'applied');
  }

  const empty = {version: 0, value: null};
  const firstPage = await readExport(participant);
  assert.deepEqual(firstPage.workspace, {
    profile: empty, training: empty, nutrition: empty, journal: {version: 2, value: finalJournal},
  });
  assert.equal(firstPage.weight.groups.length, ACCOUNT_EXPORT_WEIGHT_PAGE_GROUPS);
  assert.equal(firstPage.weight.highWater, String(weightCount));
  assert.ok(firstPage.weight.nextCursor);
  assert.deepEqual(firstPage.weight.groups.map(group => group.items[0]?.id), Array.from(
    {length: ACCOUNT_EXPORT_WEIGHT_PAGE_GROUPS}, (_, index) => uuid(101 + index),
  ));

  await logWeights(participant, device, [weightCount + 1], 100);
  const lastPage = await readExport(participant, firstPage.weight.nextCursor);
  assert.deepEqual(lastPage, {
    schemaVersion: 1, workspace: null, weight: {
      highWater: String(weightCount), nextCursor: null, groups: [{
        revision: String(weightCount), items: [{
          id: uuid(100 + weightCount), type: 'progress.weight', version: 1,
          view: {grams: 80_000 + weightCount, measuredOn: '2026-11-23'},
        }],
      }],
    },
  });
  assert.equal((await readExport(participant)).weight.highWater, String(weightCount + 1));
  const isolated = await readExport(other);
  assert.deepEqual(isolated.workspace?.journal, {version: 1, value: otherJournal});
  assert.deepEqual(isolated.weight.groups.map(group => group.items[0]?.id), [uuid(201)]);
  const serializedLogs = JSON.stringify(logs);
  for (const value of [participant, firstPage.weight.nextCursor, 'other-account-only', uuid(101)]) {
    assert.ok(!serializedLogs.includes(value));
  }
});

test('export rejects unauthenticated, operator, malformed and cross-account or legacy sync cursors', async t => {
  const {participant, other, operator, request, register, logWeights, readExport} = await setup(t);
  const path = '/v1/account/export';
  await assertProblem(await request(path), 401, 'unauthenticated');
  await assertProblem(await request(path, operator), 403, 'participant_required');
  await assertProblem(await request(path + '?accountId=' + uuid(2), participant), 400, 'invalid_export_query');
  await assertProblem(await request(path + '?cursor=x&cursor=y', participant), 400, 'invalid_export_query');

  const empty = await readExport(participant);
  assert.deepEqual(empty.weight, {highWater: '0', groups: [], nextCursor: null});
  const device = await register(participant, uuid(1));
  await logWeights(participant, device, Array.from({length: weightCount}, (_, index) => index + 1), 100);
  const firstPage = await readExport(participant);
  const cursor = firstPage.weight.nextCursor;
  assert.ok(cursor);
  await assertProblem(await request(path + '?cursor=' + cursor, other), 410, 'cursor_expired');
  const first = cursor[0] === 'A' ? 'B' : 'A';
  await assertProblem(await request(path + '?cursor=' + first + cursor.slice(1), participant), 410, 'cursor_expired');
  const legacyResponse = await request('/v1/sync/pull?limit=1', participant);
  assert.equal(legacyResponse.status, 200);
  const legacy = parsePullResponse(await legacyResponse.json());
  assert.ok(legacy?.hasMore);
  await assertProblem(await request(path + '?cursor=' + legacy.nextCursor, participant), 410, 'cursor_expired');
  await assertProblem(await request('/v1/sync/pull?cursor=' + cursor, participant), 410, 'cursor_expired');
});
