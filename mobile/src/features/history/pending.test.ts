import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkspaceHistoryMove } from '@levelmaxing/contracts';
import { createPendingHistoryStore } from './pending.ts';

const known = 'a'.repeat(64);
const original: WorkspaceHistoryMove = {
  action: 'restore', kind: 'meals', ids: ['meal-1'], recordTags: ['b'.repeat(64)],
  expectVersion: 2, known, operationId: '88eabaef-b75c-4005-bd6a-0e79430d54f5',
};
const other: WorkspaceHistoryMove = { ...original, operationId: 'e3fe53e5-12db-4f58-9264-7448801b4a3f' };

function fixture() {
  const values = new Map<string, string>();
  let failWrite = false;
  let failDelete = false;
  function open(key: string) {
    return createPendingHistoryStore(async () => key, 'meals', {
      async read(id) { return values.get(id) ?? null; },
      async write(id, value) {
        if (failWrite) throw new Error('Storage unavailable');
        values.set(id, value);
      },
      async remove(id) {
        if (failDelete) throw new Error('Storage unavailable');
        values.delete(id);
      },
    });
  }
  return { values, open, setFailWrite: () => { failWrite = true; }, setFailDelete: () => { failDelete = true; } };
}

test('reopening after an interrupted move recovers exact bytes only for the original account and kind', async () => {
  const { open, values } = fixture();
  const first = await open('account.a.meals').stage(original);
  const encoded = values.get('account.a.meals');
  const reopened = open('account.a.meals');
  assert.equal(JSON.stringify(await reopened.load()), encoded);
  assert.deepEqual(await reopened.load(), first);
  assert.equal(await open('account.b.meals').load(), undefined);
  assert.equal(await open('account.a.workouts').load(), undefined);
  await reopened.complete(other.operationId);
  assert.equal(values.get('account.a.meals'), encoded);
  await reopened.complete(first.operationId);
  assert.equal(await reopened.load(), undefined);
});

test('concurrent screens keep the first confirmed operation and storage failure preserves the retry', async () => {
  const { open, setFailDelete } = fixture();
  const left = open('account.a.meals');
  const right = open('account.a.meals');
  const [first, raced] = await Promise.all([left.stage(original), right.stage(other)]);
  assert.equal(first.operationId, original.operationId);
  assert.deepEqual(raced, first);
  setFailDelete();
  await assert.rejects(left.complete(original.operationId), /Storage unavailable/);
  assert.deepEqual(await right.load(), first);
});

test('device limits fit the visible move sizes and a failed stage keeps the journal empty', async () => {
  const { open, values, setFailWrite } = fixture();
  const store = open('account.a.meals');
  const ids = Array.from({ length: 20 }, (_, index) => `meal${index}`.padEnd(80, 'x'));
  const archive: WorkspaceHistoryMove = {
    action: 'archive', kind: 'meals', ids, expectVersion: Number.MAX_SAFE_INTEGER - 1, known,
    operationId: original.operationId,
  };
  await store.stage(archive);
  assert.ok(values.get('account.a.meals')!.length < 2_048);
  await store.complete(archive.operationId);
  const restore: WorkspaceHistoryMove = { ...original, ids: ids.slice(0, 10), recordTags: Array.from({ length: 10 }, () => known) };
  await store.stage(restore);
  assert.ok(values.get('account.a.meals')!.length < 2_048);
  await store.complete(restore.operationId);
  setFailWrite();
  await assert.rejects(store.stage(archive), /Storage unavailable/);
  assert.equal(await store.load(), undefined);
});
