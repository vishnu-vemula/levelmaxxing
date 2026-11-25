import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesPushResults, operationId, type PushRequest, type PushResult, type SyncOperation } from './index.ts';

const deviceId = 'd798254f-5be7-4a2c-a886-c6359506ac0e';
const generation = 3;

function operation(seq: number, entityId: string): SyncOperation {
  return {
    seq, opId: operationId(deviceId, generation, seq), entityId,
    type: 'progress.weight.record', version: 1, expectedVersion: 0,
    payload: { grams: 75_000, measuredOn: '2026-11-23' },
  };
}

test('correlates every ordered push receipt, including terminal conflicts', () => {
  const first = operation(4, '66495871-c7cb-4617-baf2-d54c1c961352');
  const second = operation(5, 'd470fa7b-c8b9-43a6-a0c7-5758b84ae939');
  const request: PushRequest = { deviceId, generation, epoch: 'epoch', ops: [first, second] };
  const applied: PushResult = { seq: first.seq, opId: first.opId, status: 'applied', revision: '9', entityVersion: 1 };
  const conflict: PushResult = { seq: second.seq, opId: second.opId, status: 'conflict', code: 'entity_already_exists' };

  assert.equal(matchesPushResults(request, { results: [applied, conflict] }), true);
  for (const results of [
    [applied],
    [conflict, applied],
    [applied, applied],
    [applied, { ...conflict, opId: first.opId }],
    [applied, { ...conflict, seq: first.seq }],
  ]) {
    assert.equal(matchesPushResults(request, { results }), false);
  }
});
