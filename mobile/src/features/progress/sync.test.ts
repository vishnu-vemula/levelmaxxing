import { deepEqual, equal, rejects } from 'node:assert/strict';
import { test } from 'node:test';
import type { DeviceRegistration, PullResponse, PushRequest } from '@levelmaxing/contracts';
import {
  parseWeightInput, syncProgress, todayLocal, SyncContextChanged, SyncCursorExpired, SyncRetryRequired,
  type PendingMeasurement, type ProgressStore, type SyncContext, type SyncTransport,
} from './sync.ts';

const device: DeviceRegistration = {
  deviceId: '50000000-0000-4000-8000-000000000001',
  epoch: 'epoch-1',
  generation: 1,
};
const weighIn: PendingMeasurement = { id: '50000000-0000-4000-8000-000000000002', seq: 1, grams: 71_125, measuredOn: '2024-02-29' };

function page(nextCursor = 'new-cursor', hasMore = false, epoch = device.epoch): PullResponse {
  return { epoch, groups: [], nextCursor, hasMore };
}

function fixture(entries: PendingMeasurement[] = [], start: SyncContext = { deviceId: device.deviceId, device, cursor: null }) {
  const pending = [...entries];
  const applied: PullResponse[] = [];
  const ack: PendingMeasurement[] = [];
  const review: PendingMeasurement[] = [];
  const bindings: DeviceRegistration[] = [];
  let context = { ...start };
  const store: ProgressStore = {
    context: async () => context,
    bind: async (binding) => {
      bindings.push(binding);
      context = { ...context, device: binding };
    },
    enqueue: async () => { throw new Error('Append outside the synchronization fixture'); },
    next: async () => pending[0] ?? null,
    acknowledge: async (entry) => { ack.push(entry); pending.shift(); },
    needsReview: async (entry) => { review.push(entry); pending.shift(); },
    apply: async (change) => {
      applied.push(change);
      context = { ...context, cursor: change.nextCursor };
    },
    recent: async () => [],
    close: async () => undefined,
  };
  const transport: SyncTransport = {
    register: async () => device,
    push: async (request) => ({
      results: request.ops.map(({ seq, opId }) => ({ seq, opId, status: 'applied', revision: String(seq), entityVersion: 1 })),
    }),
    pull: async () => page(),
  };
  return { store, transport, pending, applied, ack, review, bindings };
}

test('parses exact grams from a decimal and validates real calendar dates', () => {
  deepEqual(parseWeightInput('71,125', '2024-02-29'), { grams: 71_125, measuredOn: '2024-02-29' });
  equal(parseWeightInput('19.999', '2024-02-29'), undefined);
  equal(parseWeightInput('450.001', '2024-02-29'), undefined);
  equal(parseWeightInput('71 kg', '2024-02-29'), undefined);
  equal(parseWeightInput('71', '2024-02-30'), undefined);
  equal(todayLocal(new Date(2026, 0, 3, 9, 0, 0)), '2026-01-03');
});

test('retrying a lost response sends the same operation from the durable queue', async () => {
  const data = fixture([weighIn], { deviceId: device.deviceId, device: null, cursor: null });
  const requests: PushRequest[] = [];
  let stored: string | undefined;
  const send = data.transport.push;
  data.transport.push = async (request) => {
    requests.push(request);
    const opId = request.ops[0]?.opId;
    if (!stored) {
      stored = opId;
      throw new Error('Connection lost after acceptance');
    }
    equal(stored, opId);
    return send(request);
  };
  await rejects(syncProgress(data.store, data.transport), /Connection lost/);
  deepEqual(data.pending, [weighIn]);
  equal(await syncProgress(data.store, data.transport), 'drained');
  deepEqual(requests[0], requests[1]);
  deepEqual(data.bindings, [device]);
  deepEqual(data.ack, [weighIn]);
  deepEqual(data.pending, []);
});

test('an expired cursor restarts once and accepts pages in the same epoch', async () => {
  const data = fixture([], { deviceId: device.deviceId, device, cursor: 'expired' });
  const cursors: Array<string | null> = [];
  data.transport.pull = async (cursor) => {
    cursors.push(cursor);
    if (cursor === 'expired') throw new SyncCursorExpired();
    return cursor === null ? page('first', true) : page('second');
  };
  equal(await syncProgress(data.store, data.transport), 'drained');
  deepEqual(cursors, ['expired', null, 'first']);
  deepEqual(data.applied.map(result => result.nextCursor), ['first', 'second']);
});

test('epoch change keeps local data and requires explicit review', async () => {
  const data = fixture([], { deviceId: device.deviceId, device, cursor: 'expired' });
  data.transport.pull = async (cursor) => {
    if (cursor) throw new SyncCursorExpired();
    return page('reset', false, 'new-epoch');
  };
  await rejects(syncProgress(data.store, data.transport), SyncContextChanged);
  deepEqual(data.applied, []);
  equal((await data.store.context()).cursor, 'expired');
});

test('bounded push and pull require continuation when more work may remain', async () => {
  const backlog = Array.from({ length: 11 }, (_, index) => ({ ...weighIn, seq: index + 1, id: String(index) }));
  const data = fixture(backlog);
  equal(await syncProgress(data.store, data.transport), 'continue');
  equal(data.pending.length, 1);
  equal(await syncProgress(data.store, data.transport), 'drained');
  equal(data.ack.length, 11);
  let pullCount = 0;
  data.transport.pull = async () => page(String(++pullCount), true);
  equal(await syncProgress(data.store, data.transport), 'continue');
  equal(data.applied.length, 6);
});

test('ignores an acknowledgement after cancellation', async () => {
  const data = fixture([weighIn]);
  const abort = new AbortController();
  const send = data.transport.push;
  data.transport.push = async (request) => {
    abort.abort();
    return send(request);
  };
  await rejects(syncProgress(data.store, data.transport, abort.signal), /Sync cancelled/);
  deepEqual(data.ack, []);
  deepEqual(data.pending, [weighIn]);
});

test('a receipt for a different operation cannot consume a pending weigh-in', async () => {
  const data = fixture([weighIn]);
  const send = data.transport.push;
  data.transport.push = async (request) => {
    const response = await send(request);
    return { results: response.results.map(result => ({ ...result, opId: 'different-operation' })) };
  };

  await rejects(syncProgress(data.store, data.transport), SyncRetryRequired);
  deepEqual(data.pending, [weighIn]);
  deepEqual(data.ack, []);
  deepEqual(data.review, []);
  deepEqual(data.applied, []);

  data.transport.push = send;
  equal(await syncProgress(data.store, data.transport), 'drained');
  deepEqual(data.ack, [weighIn]);
});
