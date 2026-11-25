import type { SyncOperation, WeightChange } from '@levelmaxing/contracts';

export function projectWeightChange(op: SyncOperation): WeightChange {
  return { type: 'progress.weight', id: op.entityId, version: 1, view: op.payload };
}
