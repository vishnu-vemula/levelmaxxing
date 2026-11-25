import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import {
  parseWorkspaceBatchRequest, parseWorkspaceBatchResponse, workspaceSections,
  type ProfileData, type WorkspaceBatchRequest, type WorkspaceBatchResponse, type WorkspaceSave,
} from '../packages/contracts/src/index.ts';
import { createLocalApp } from '../backend/src/local.ts';
import { createNodeServer } from '../backend/src/platform/node-http.ts';
import { ApiFailure, createApiRequester, type ApiRequester } from '../mobile/src/platform/api.ts';
import { createWorkspaceTransport } from '../mobile/src/features/workspace/api.ts';
import { WorkspaceController, emptyReplica, type Replica } from '../mobile/src/features/workspace/model.ts';

const profile: ProfileData = {
  name: 'Training user', goal: 'Strength', experience: 'Beginner', equipment: ['Dumbbells'],
  weekdays: ['Monday'], minutes: 30, muscles: [], calories: null, units: 'kg', onboarded: true,
};

test('four native reads use one HTTP request, unchanged snapshots stay private to the token, and restores with reused versions are visible',
  { timeout: 6000 }, async (t) => {
    const participantToken = randomBytes(32).toString('hex');
    const secondParticipantToken = randomBytes(32).toString('hex');
    const config = { participantToken, secondParticipantToken };
    let app = createLocalApp(config);
    const batches: { query: WorkspaceBatchRequest; result: WorkspaceBatchResponse }[] = [];
    const server = createNodeServer(async (request) => {
      if (new URL(request.url).pathname !== '/v1/workspace/batch') return app(request);
      const query = parseWorkspaceBatchRequest(await request.clone().json());
      const response = await app(request);
      const result = query && parseWorkspaceBatchResponse(query, await response.clone().json());
      assert.ok(query && result);
      batches.push({ query, result });
      return response;
    }, 0);
    t.after(() => new Promise<void>((resolve, reject) => server.close((cause) => cause ? reject(cause) : resolve())));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}/`;
    const device = createWorkspaceTransport(createApiRequester(url, participantToken));
    const observer = createWorkspaceTransport(createApiRequester(url, secondParticipantToken));
    const signal = new AbortController().signal;
    const operation: WorkspaceSave = { section: 'profile', expect: 0, operationId: randomUUID(), value: profile };

    assert.equal((await device.save(operation, signal)).outcome, 'applied');
    const initialize = () => Promise.all(workspaceSections.map((section) => device.read(section, signal)));
    const initial = await initialize();
    assert.equal(batches.length, 1);
    assert.equal(batches[0]?.query.sections.length, 4);
    assert.deepEqual(initial[0], { version: 1, value: profile });

    assert.deepEqual(await initialize(), initial);
    assert.equal(batches.length, 2);
    assert.ok(batches[1]?.result.sections.every((entry) => entry.snapshot === null));
    assert.deepEqual(await observer.read('profile', signal), { version: 0, value: null });
    assert.equal(batches[2]?.query.sections[0]?.known, null);

    // Simulate a separate restored generation with the same version and
    // operation ID, but changed content. The installed client still holds v1.
    app = createLocalApp(config);
    const restored = { ...profile, minutes: 55 };
    assert.deepEqual((await device.save({ ...operation, value: restored }, signal)).snapshot, { version: 1, value: restored });
    const persisted = new Map([['profile', {
      base: { version: 1, value: profile }, local: profile, pending: null, conflict: null,
    } as Replica]]);
    const client = new WorkspaceController(randomUUID);
    t.after(() => client.close());
    await client.start(async () => ({
      async read(section) { return persisted.get(section) ?? emptyReplica; },
      async write(section, replica) { persisted.set(section, replica); },
      async close() { return; },
    }));
    const ready = Promise.withResolvers<void>();
    const unsubscribe = client.subscribe(() => {
      if (client.view('profile').status === 'conflict') ready.resolve();
    });
    t.after(unsubscribe);
    client.connect(device);
    await ready.promise;
    assert.notEqual(batches[3]?.result.sections[0]?.tag, batches[0]?.result.sections[0]?.tag);
    assert.deepEqual(persisted.get('profile')?.local, profile);
    assert.deepEqual(persisted.get('profile')?.conflict, { version: 1, value: restored });
  });

test('a confirmed legacy route falls back per section; broken authentication and service responses do not', async () => {
  const calls: string[] = [];
  const legacy: ApiRequester = async (route, decode) => {
    calls.push(route);
    if (route === 'v1/workspace/batch') throw new ApiFailure(404, 'route_not_found');
    return decode({ version: 0, value: null })!;
  };
  const old = createWorkspaceTransport(legacy);
  const signal = new AbortController().signal;
  await Promise.all([old.read('profile', signal), old.read('journal', signal)]);
  assert.deepEqual(await old.read('profile', signal), { version: 0, value: null });
  assert.deepEqual(calls, ['v1/workspace/batch', 'v1/workspace?section=profile', 'v1/workspace?section=journal', 'v1/workspace?section=profile']);

  for (const [status, code] of [[401, 'unauthorized'], [503, 'dependency_unavailable'], [404, 'other_error']] as const) {
    calls.length = 0;
    const respond: ApiRequester = async (route) => {
      calls.push(route);
      throw new ApiFailure(status, code);
    };
    await assert.rejects(createWorkspaceTransport(respond).read('profile', signal), { code });
    assert.deepEqual(calls, ['v1/workspace/batch']);
  }
});

test('cancelling one waiter does not cancel its siblings; cancelling all stops the batch', async () => {
  const emptyTag = '0'.repeat(64);
  let started = Promise.withResolvers<AbortSignal>();
  let release = Promise.withResolvers<void>();
  const requester: ApiRequester = async (_route, decode, signal, body) => {
    assert.ok(signal);
    started.resolve(signal);
    await release.promise;
    if (signal.aborted) throw new Error('Request aborted');
    const query = parseWorkspaceBatchRequest(body);
    assert.ok(query);
    return decode({ sections: query.sections.map(({section}) => ({
      section, tag: emptyTag, snapshot: {version: 0, value: null},
    })) })!;
  };
  const device = createWorkspaceTransport(requester);
  const first = new AbortController();
  const second = new AbortController();
  const aborted = device.read('profile', first.signal);
  const pending = device.read('journal', second.signal);
  const batch = await started.promise;
  first.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
  assert.equal(batch.aborted, false);
  release.resolve();
  assert.deepEqual(await pending, { version: 0, value: null });

  started = Promise.withResolvers<AbortSignal>();
  release = Promise.withResolvers<void>();
  const third = new AbortController();
  const canceled = device.read('profile', third.signal);
  const lastBatch = await started.promise;
  third.abort();
  await assert.rejects(canceled, { name: 'AbortError' });
  assert.equal(lastBatch.aborted, true);
  release.resolve();
});

test('the checked native save fences a restore between reading and writing, with a cold pending command as well', {timeout: 6000}, async (t) => {
  const participantToken = randomBytes(32).toString('hex');
  const config = {participantToken};
  const original = createLocalApp(config);
  const restored = createLocalApp(config);
  let app = original;
  const routes: string[] = [];
  const server = createNodeServer((request) => {
    routes.push(new URL(request.url).pathname);
    return app(request);
  }, 0);
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const requester = createApiRequester(`http://127.0.0.1:${address.port}/`, participantToken);
  const device = createWorkspaceTransport(requester);
  const signal = new AbortController().signal;
  const seed: WorkspaceSave = {section: 'profile', expect: 0, operationId: randomUUID(), value: profile};
  await device.save(seed, signal);
  const baseline = await device.read('profile', signal);
  const pending: WorkspaceSave = { ...seed, expect: 1, value: {...profile, name: 'Unsynced name'}, operationId: randomUUID() };

  app = restored;
  const switched = {...profile, minutes: 55};
  await device.save({...seed, value: switched}, signal);
  routes.length = 0;
  const refused = await device.save(pending, signal, baseline);
  assert.deepEqual(routes, ['/v1/workspace/save-checked']);
  assert.deepEqual(refused, {outcome: 'conflict', snapshot: {version: 1, value: switched}});

  const reopened = createWorkspaceTransport(requester);
  routes.length = 0;
  assert.deepEqual(await reopened.save(pending, signal, baseline), refused);
  assert.deepEqual(routes, ['/v1/workspace/batch', '/v1/workspace/save-checked']);
  assert.deepEqual(await reopened.read('profile', signal), {version: 1, value: switched});

  // After a compatible rollback the preflight detects already-observed divergence.
  let requests = 0;
  const downgraded = createWorkspaceTransport(async (route, decode, signal, payload) => {
    if (route === 'v1/workspace/save-checked') throw new ApiFailure(404, 'route_not_found');
    if (route === 'v1/workspace/save') requests++;
    return requester(route, decode, signal, payload);
  });
  assert.deepEqual(await downgraded.save(pending, signal, baseline), refused);
  assert.equal(requests, 0);

  const current = await reopened.read('profile', signal);
  routes.length = 0;
  const first = await reopened.save({...pending, operationId: randomUUID()}, signal, current);
  assert.equal(first.outcome, 'applied');
  const second = await reopened.save({
    ...pending, expect: 2, operationId: randomUUID(), value: {...profile, minutes: 35},
  }, signal, first.snapshot);
  assert.equal(second.outcome, 'applied');
  assert.deepEqual(routes, ['/v1/workspace/save-checked', '/v1/workspace/save-checked']);
});
