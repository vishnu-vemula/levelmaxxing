import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {test} from 'node:test';
import {parseWorkspaceCheckedSaveResult, type ProfileData} from '@levelmaxing/contracts';
import {createLocalApp} from '../src/local.ts';
import {createNodeServer} from '../src/platform/node-http.ts';

const profile: ProfileData = {
  name: 'Example', goal: 'Strength', experience: 'Beginner', equipment: ['Dumbbells'],
  weekdays: ['Monday'], minutes: 45, muscles: [], calories: null, units: 'kg', onboarded: true,
};

test('conditionals are participant-scoped, validate each known tag, and preserve the legacy workspace contract', async () => {
  const token = () => randomBytes(32).toString('hex');
  const participantToken = token();
  const secondParticipantToken = token();
  const operatorToken = token();
  const app = createLocalApp({participantToken, secondParticipantToken, operatorToken});
  const request = (path: string, bearer?: string, data?: unknown) => app(new Request('http://localhost/v1/workspace' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {...(bearer ? {authorization: 'Bearer ' + bearer} : {}),
      ...(data === undefined ? {} : {'content-type': 'application/json'})},
    ...(data === undefined ? {} : {body: JSON.stringify(data)}),
  }));
  const batch = (bearer?: string, known: string | null = null) => request('/batch', bearer, {
    sections: [{section: 'profile', known}, {section: 'journal', known: null}],
  });

  assert.equal((await batch()).status, 401);
  assert.equal((await batch(operatorToken)).status, 403);
  for (const sections of [
    [], [{section: 'profile', known: 'partial'}], [{section: 'profile'}],
    [{section: 'profile', known: null}, {section: 'profile', known: null}],
    [{section: 'profile', known: null, accountId: randomUUID()}], [{section: {scope: 'profile'}, known: null}],
  ]) {
    const response = await request('/batch', participantToken, {sections});
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid_workspace_batch');
  }
  const operation = {section: 'profile', expect: 0, operationId: randomUUID(), value: profile};
  const expected = {version: 1, value: profile};
  assert.deepEqual(await (await request('/save', participantToken, operation)).json(), {outcome: 'applied', snapshot: expected});
  assert.deepEqual(await (await request('?section=profile', participantToken)).json(), expected);

  const initial = await batch(participantToken);
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  const output = await initial.json();
  const tag = output.sections[0].tag;
  assert.match(tag, /^[0-9a-f]{64}$/);
  assert.deepEqual(output.sections[0], {section: 'profile', tag, snapshot: expected});

  const unchanged = await (await batch(participantToken, tag)).json();
  assert.deepEqual(unchanged.sections[0], {section: 'profile', tag, snapshot: null});
  assert.equal(unchanged.sections[1].snapshot.version, 0);
  const other = await (await batch(secondParticipantToken, tag)).json();
  assert.equal(other.sections[0].snapshot.version, 0);
  await request('/save', secondParticipantToken, operation);
  const second = await (await batch(secondParticipantToken, tag)).json();
  assert.notEqual(second.sections[0].tag, tag);
  assert.deepEqual(second.sections[0].snapshot, expected);
  assert.deepEqual(await (await request('/save', participantToken, operation)).json(), {outcome: 'applied', snapshot: expected});
});

test('checked saves fence a restore with a reused version and replay original receipts through either write route', async () => {
  const token = () => randomBytes(32).toString('hex');
  const config = {participantToken: token(), secondParticipantToken: token(), operatorToken: token()};
  let app = createLocalApp(config);
  const send = (path: string, input?: unknown, accessToken = config.participantToken) =>
    app(new Request('http://localhost/v1/workspace' + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {authorization: 'Bearer ' + accessToken, ...(input === undefined ? {} : {'content-type': 'application/json'})},
      ...(input === undefined ? {} : {body: JSON.stringify(input)}),
    }));
  const tag = async () => {
    const response = await send('/batch', {sections: [{section: 'profile', known: null}]});
    assert.equal(response.status, 200);
    return (await response.json()).sections[0].tag as string;
  };
  const command = {section: 'profile', expect: 0, operationId: randomUUID(), value: profile};
  assert.equal((await send('/save', command)).status, 200);
  const oldTag = await tag();
  const oldDocument = {version: 1, value: profile};

  // Rebuild the server with a restored account generation that legitimately
  // reused its version and operation ID but has a different document.
  app = createLocalApp(config);
  const restored = {...profile, minutes: 55};
  assert.equal((await send('/save', {...command, value: restored})).status, 200);
  const restoredTag = await tag();
  assert.notEqual(restoredTag, oldTag);
  const restoredDocument = {version: 1, value: restored};
  const change = {section: 'profile', expect: oldDocument.version, operationId: randomUUID(), value: {...profile, name: 'My draft'}};

  assert.equal((await send('/save-checked', {command: change, known: 'invalid'})).status, 400);
  assert.equal((await send('/save-checked', {command: change, known: oldTag + '\n'})).status, 400);
  assert.equal((await send('/save-checked', {command: change, known: '0'.repeat(64)})).status, 400);
  assert.equal((await send('/save-checked', {command: change, known: oldTag}, config.operatorToken)).status, 403);
  const guarded = await send('/save-checked', {command: change, known: oldTag});
  assert.equal(guarded.status, 200);
  const conflict = {outcome: 'conflict', snapshot: restoredDocument};
  assert.deepEqual(await guarded.json(), conflict);
  assert.deepEqual(await (await send('?section=profile')).json(), restoredDocument);
  const legacyReplay = await send('/save', change);
  assert.deepEqual(await legacyReplay.json(), conflict);
  assert.equal((await send('/save-checked', {command: {...change, value: profile}, known: restoredTag})).status, 409);

  const next = {...change, operationId: randomUUID(), value: {...restored, name: 'Accept restored base'}};
  const applied = {outcome: 'applied', snapshot: {version: 2, value: next.value}};
  const checked = await (await send('/save-checked', {command: next, known: restoredTag})).json();
  assert.deepEqual(checked, {...applied, tag: await tag()});
  assert.match(checked.tag, /^[0-9a-f]{64}$/);
  assert.deepEqual(parseWorkspaceCheckedSaveResult('profile', checked), checked);
  assert.deepEqual(parseWorkspaceCheckedSaveResult('profile', applied), applied);
  assert.equal(parseWorkspaceCheckedSaveResult('profile', {...conflict, tag: checked.tag}), undefined);
  assert.deepEqual(await (await send('/save', next)).json(), applied);

  const later = {...next, expect: 2, operationId: randomUUID(), value: {...next.value, minutes: 70}};
  const advanced = await (await send('/save-checked', {command: later, known: checked.tag})).json();
  assert.deepEqual(advanced.snapshot, {version: 3, value: later.value});
  assert.notEqual(checked.tag, advanced.tag);
  assert.deepEqual(await (await send('/save-checked', {command: next, known: oldTag})).json(), checked);
  assert.deepEqual(await (await send('/save-checked', {command: change, known: oldTag})).json(), conflict);
  assert.deepEqual(await (await send('?section=profile')).json(), advanced.snapshot);
  assert.deepEqual(await (await send('?section=profile', undefined, config.secondParticipantToken)).json(), {
    version: 0, value: null,
  });
});

test('two distinct guarded commands against one representation advance it only once over HTTP', async (t) => {
  const bearer = randomBytes(32).toString('hex');
  const app = createLocalApp({participantToken: bearer});
  const server = createNodeServer(app, 0);
  t.after(() => new Promise<void>((resolve, reject) => server.close((cause) => cause ? reject(cause) : resolve())));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const apply = async (name: string) => {
    const command = {section: 'profile', expect: 0, operationId: randomUUID(), value: {...profile, name}};
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/workspace/save-checked`, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: 'Bearer ' + bearer},
      body: JSON.stringify({command, known: '0'.repeat(64)}),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const [left, right] = await Promise.all([apply('Left'), apply('Right')]);
  assert.deepEqual([left.outcome, right.outcome].sort(), ['applied', 'conflict']);
  assert.equal(left.snapshot.version, 1);
  assert.deepEqual(left.snapshot, right.snapshot);
  const [applied, conflict] = left.outcome === 'applied' ? [left, right] : [right, left];
  assert.match(applied.tag, /^[0-9a-f]{64}$/);
  assert.equal(conflict.tag, undefined);
});
