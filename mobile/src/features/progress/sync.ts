import {
  matchesPushResults,
  operationId,
  parseWeightMeasurement,
  type DeviceRegistration,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type WeightMeasurement,
} from '@levelmaxing/contracts';

export type PendingMeasurement = WeightMeasurement & { id: string; seq: number };
export type Entry = WeightMeasurement & { id: string; state: 'confirmed' | 'pending' | 'review' };
export type SyncContext = { deviceId: string; device: DeviceRegistration | null; cursor: string | null };

export interface ProgressStore {
  context(): Promise<SyncContext>;
  bind(device: DeviceRegistration): Promise<void>;
  enqueue(id: string, weight: WeightMeasurement): Promise<void>;
  next(): Promise<PendingMeasurement | null>;
  acknowledge(entry: PendingMeasurement): Promise<void>;
  needsReview(entry: PendingMeasurement): Promise<void>;
  apply(page: PullResponse): Promise<void>;
  recent(): Promise<Entry[]>;
  close(): Promise<void>;
}

export interface SyncTransport {
  register(deviceId: string, signal?: AbortSignal): Promise<DeviceRegistration>;
  push(request: PushRequest, signal?: AbortSignal): Promise<PushResponse>;
  pull(cursor: string | null, signal?: AbortSignal): Promise<PullResponse>;
}

export class SyncContextChanged extends Error {}
export class SyncCursorExpired extends Error {}
export class SyncRetryRequired extends Error {}
export class SyncSignInRequired extends Error {}

function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Sync cancelled');
}

export async function syncProgress(store: ProgressStore, transport: SyncTransport, signal?: AbortSignal): Promise<'drained' | 'continue'> {
  const context = await store.context();
  check(signal);
  const device = context.device ?? await transport.register(context.deviceId, signal);
  check(signal);
  if (device.deviceId !== context.deviceId) throw new SyncContextChanged();
  if (!context.device) await store.bind(device);

  let count = 0;
  for (; count < 10; count += 1) {
    check(signal);
    const entry = await store.next();
    if (!entry) break;
    const opId = operationId(device.deviceId, device.generation, entry.seq);
    const request: PushRequest = {
      ...device,
      ops: [{
        seq: entry.seq,
        opId,
        type: 'progress.weight.record',
        version: 1,
        entityId: entry.id,
        expectedVersion: 0,
        payload: { grams: entry.grams, measuredOn: entry.measuredOn },
      }],
    };
    const response = await transport.push(request, signal);
    check(signal);
    const [result] = response.results;
    if (!result || !matchesPushResults(request, response)) {
      throw new SyncRetryRequired();
    }
    switch (result.status) {
      case 'applied':
        await store.acknowledge(entry);
        break;
      case 'rejected':
      case 'conflict':
      case 'processed_receipt_expired':
        await store.needsReview(entry);
        break;
      case 'sequence_gap':
        throw new SyncContextChanged();
      case 'retry':
        throw new SyncRetryRequired();
    }
  }

  let cursor = context.cursor;
  let retriedCursor = false;
  for (let pageCount = 0; pageCount < 4; pageCount += 1) {
    check(signal);
    let page: PullResponse;
    try {
      page = await transport.pull(cursor, signal);
    } catch (error) {
      if (!(error instanceof SyncCursorExpired) || cursor === null || retriedCursor) throw error;
      // This create-only stream retains every change. Restarting its cursor is idempotent.
      retriedCursor = true;
      cursor = null;
      page = await transport.pull(cursor, signal);
    }
    check(signal);
    if (device.epoch !== page.epoch) throw new SyncContextChanged();
    if (page.hasMore && page.nextCursor === cursor) throw new SyncRetryRequired();
    await store.apply(page);
    if (!page.hasMore) return count === 10 ? 'continue' : 'drained';
    cursor = page.nextCursor;
  }
  return 'continue';
}

export function parseWeightInput(kg: string, date: string): WeightMeasurement | undefined {
  const normalized = kg.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(normalized)) return;
  return parseWeightMeasurement({ grams: Math.round(Number(normalized) * 1_000), measuredOn: date.trim() });
}

export function todayLocal(time = new Date()): string {
  const month = String(time.getMonth() + 1).padStart(2, '0');
  const day = String(time.getDate()).padStart(2, '0');
  return `${time.getFullYear()}-${month}-${day}`;
}
