import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import type { DeviceRegistration, PullResponse, WeightMeasurement } from '../packages/contracts/src/index.ts';
import { createLocalApp } from '../backend/src/local.ts';
import { createNodeServer } from '../backend/src/platform/node-http.ts';
import { createApiRequester } from '../mobile/src/platform/api.ts';
import { createProgressTransport } from '../mobile/src/features/progress/api.ts';
import { resolveAccountSession } from '../mobile/src/features/session/api.ts';
import {
  syncProgress,
  type Entry,
  type PendingMeasurement,
  type ProgressStore,
  type SyncContext,
} from '../mobile/src/features/progress/sync.ts';

function clientStore(): ProgressStore {
  const entries = new Map<string, Entry>();
  const pending = new Map<string, PendingMeasurement>();
  let sequence = 0;
  let state: SyncContext = { deviceId: randomUUID(), device: null, cursor: null };
  return {
    async context() { return state; },
    async bind(device: DeviceRegistration) { state = { ...state, device }; },
    async enqueue(id: string, weight: WeightMeasurement) {
      sequence++;
      pending.set(id, { ...weight, id, seq: sequence });
      entries.set(id, { ...weight, id, state: 'pending' });
    },
    async next() { return pending.values().next().value ?? null; },
    async acknowledge({ id }) { pending.delete(id); },
    async needsReview({ id, grams, measuredOn }) {
      pending.delete(id);
      entries.set(id, { id, grams, measuredOn, state: 'review' });
    },
    async apply(page: PullResponse) {
      for (const group of page.groups) {
        for (const item of group.items) entries.set(item.id, { ...item.view, id: item.id, state: 'confirmed' });
      }
      state = { ...state, cursor: page.nextCursor };
    },
    async recent() { return [...entries.values()]; },
    async close() { pending.clear(); entries.clear(); },
  };
}

test('mobile sync coordinator and Fetch client send one offline entry through the actual HTTP API to a second installation', async (t) => {
  const participantToken = randomBytes(32).toString('hex');
  const secondParticipantToken = randomBytes(32).toString('hex');
  const server = createNodeServer(createLocalApp({ participantToken, secondParticipantToken }), 0);
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const bound = server.address();
  assert.ok(bound && typeof bound !== 'string');

  const base = 'http://127.0.0.1:' + bound.port + '/';
  const requester = createApiRequester(base, participantToken);
  const otherRequester = createApiRequester(base, secondParticipantToken);
  assert.notEqual((await resolveAccountSession(requester)).accountId, (await resolveAccountSession(otherRequester)).accountId);
  const sameAccount = createProgressTransport(requester);
  const otherAccount = createProgressTransport(otherRequester);

  const one = clientStore();
  const two = clientStore();
  const separate = clientStore();
  const measurement = { id: randomUUID(), grams: 74_850, measuredOn: '2026-11-23' };
  await one.enqueue(measurement.id, measurement);
  assert.deepEqual(await one.recent(), [{ ...measurement, state: 'pending' }]);
  assert.equal(await syncProgress(two, sameAccount), 'drained');
  assert.deepEqual(await two.recent(), []);

  // Drop the first receipt after the real server has committed the write.
  let transmitted: string | undefined;
  await assert.rejects(syncProgress(one, {
    ...sameAccount,
    async push(request, signal) {
      transmitted = JSON.stringify(request);
      const receipt = await sameAccount.push(request, signal);
      assert.equal(receipt.results[0]?.status, 'applied');
      throw new Error('Receipt was lost in transport');
    },
  }), /Receipt was lost/);
  assert.equal((await one.next())?.id, measurement.id);

  assert.equal(await syncProgress(one, {
    ...sameAccount,
    async push(request, signal) {
      assert.equal(JSON.stringify(request), transmitted);
      return sameAccount.push(request, signal);
    },
  }), 'drained');
  assert.equal(await one.next(), null);
  await syncProgress(two, sameAccount);
  assert.deepEqual(await two.recent(), [{ ...measurement, state: 'confirmed' }]);
  const history = await sameAccount.pull(null);
  assert.equal(history.groups.length, 1);
  assert.deepEqual(history.groups[0]?.items.map((item) => item.id), [measurement.id]);

  await syncProgress(separate, otherAccount);
  assert.deepEqual(await separate.recent(), []);
});
