/** Shared v1 transport types and runtime decoders. Keep this module portable. */
export const MAX_PUSH_OPERATIONS = 50;
export const MAX_PULL_GROUPS = 100;
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_CURSOR_CHARS = 1024;

export type WeightMeasurement = { grams: number; measuredOn: string };
export type DeviceRegistration = { deviceId: string; generation: number; epoch: string };
export type SyncOperation = {
  seq: number;
  opId: string;
  type: 'progress.weight.record';
  version: 1;
  entityId: string;
  expectedVersion: 0;
  payload: WeightMeasurement;
};
export type PushRequest = DeviceRegistration & { ops: SyncOperation[] };
type OperationIdentity = { seq: number; opId: string };
export type PushResult = OperationIdentity & (
  | { status: 'applied'; revision: string; entityVersion: 1 }
  | { status: 'conflict' | 'rejected' | 'sequence_gap' | 'processed_receipt_expired' | 'retry'; code: string; expectedSeq?: number }
);
export type PushResponse = { results: PushResult[] };
export type WeightChange = { type: 'progress.weight'; id: string; version: 1; view: WeightMeasurement };
export type SyncGroup = { revision: string; items: WeightChange[] };
export type PullResponse = { epoch: string; groups: SyncGroup[]; nextCursor: string; hasMore: boolean };
export type ProblemDetails = { type: string; title: string; status: number; code: string; instance: string; detail?: string };
export type AdminAccess = { role: 'operator' };
export type HealthResponse = { status: 'ok' };

export function operationId(deviceId: string, generation: number, seq: number): string {
  return `${deviceId}.${generation}.${seq}`;
}

export function objectValue(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

export function isEpoch(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isRevision(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value)
    && BigInt(value) <= 9_223_372_036_854_775_807n;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const utc = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(utc.valueOf()) && utc.toISOString().slice(0, 10) === value;
}

export function parseWeightMeasurement(input: unknown): WeightMeasurement | undefined {
  const value = objectValue(input);
  if (!value || !isPositiveInt(value.grams) || value.grams < 20_000 || value.grams > 450_000 || !isCalendarDate(value.measuredOn)) return;
  return { grams: value.grams, measuredOn: value.measuredOn };
}

export function parseDeviceRegistration(input: unknown): DeviceRegistration | undefined {
  const value = objectValue(input);
  if (!value || !isUuid(value.deviceId) || !isEpoch(value.epoch) || !isPositiveInt(value.generation)) return;
  return { deviceId: value.deviceId, epoch: value.epoch, generation: value.generation };
}

export function parsePushRequest(input: unknown): PushRequest | undefined {
  const value = objectValue(input);
  const device = parseDeviceRegistration(input);
  if (!value || !device || !Array.isArray(value.ops) || value.ops.length === 0 || value.ops.length > MAX_PUSH_OPERATIONS) return;
  const ops: SyncOperation[] = [];
  for (const raw of value.ops) {
    const op = objectValue(raw);
    if (!op || !isPositiveInt(op.seq) || op.opId !== operationId(device.deviceId, device.generation, op.seq) ||
        !isUuid(op.entityId) || op.type !== 'progress.weight.record' || op.version !== 1 || op.expectedVersion !== 0) return;
    const payload = parseWeightMeasurement(op.payload);
    if (!payload || (ops.length && ops[ops.length - 1]!.seq >= op.seq)) return;
    ops.push({seq: op.seq, opId: op.opId, entityId: op.entityId, type: op.type, version: op.version, expectedVersion: op.expectedVersion, payload});
  }
  return { ...device, ops };
}

export function parsePushResponse(input: unknown): PushResponse | undefined {
  const value = objectValue(input);
  if (!value || !Array.isArray(value.results) || value.results.length > MAX_PUSH_OPERATIONS) return;
  const results: PushResult[] = [];
  for (const raw of value.results) {
    const result = objectValue(raw);
    if (!result || !isPositiveInt(result.seq) || typeof result.opId !== 'string' || result.opId.length > 90) return;
    const identity = {seq: result.seq, opId: result.opId};
    const status = result.status;
    if (status === 'applied' && isRevision(result.revision) && result.revision !== '0' && result.entityVersion === 1) {
      results.push({...identity, status, revision: result.revision, entityVersion: 1});
    } else if (status === 'conflict' || status === 'rejected' || status === 'sequence_gap' || status === 'processed_receipt_expired' || status === 'retry') {
      if (typeof result.code !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(result.code)) return;
      if (result.expectedSeq !== undefined && !isPositiveInt(result.expectedSeq)) return;
      results.push({...identity, status, code: result.code, ...(result.expectedSeq === undefined ? {} : {expectedSeq: result.expectedSeq})});
    } else {
      return;
    }
  }
  return { results };
}

// Check a decoded response against the frozen request before acknowledging any operation.
export function matchesPushResults(request: PushRequest, response: PushResponse): boolean {
  return response.results.length === request.ops.length &&
    request.ops.every((operation, index) => {
      const receipt = response.results[index];
      return receipt?.seq === operation.seq && receipt.opId === operation.opId;
    });
}

export function parseSyncGroups(input: unknown): SyncGroup[] | undefined {
  if (!Array.isArray(input) || input.length > MAX_PULL_GROUPS) return;
  const groups: SyncGroup[] = [];
  let last = 0n;
  for (const raw of input) {
    const group = objectValue(raw);
    if (!group || !isRevision(group.revision) || BigInt(group.revision) <= last ||
        !Array.isArray(group.items) || group.items.length === 0 || group.items.length > MAX_PUSH_OPERATIONS) return;
    const items: WeightChange[] = [];
    for (const rawItem of group.items) {
      const item = objectValue(rawItem);
      const view = parseWeightMeasurement(item?.view);
      if (!item || item.type !== 'progress.weight' || !isUuid(item.id) || item.version !== 1 || !view) return;
      items.push({type: 'progress.weight', id: item.id, version: 1, view});
    }
    groups.push({revision: group.revision, items});
    last = BigInt(group.revision);
  }
  return groups;
}

export function parsePullResponse(input: unknown): PullResponse | undefined {
  const value = objectValue(input);
  if (!value || !isEpoch(value.epoch) || typeof value.nextCursor !== 'string' || !value.nextCursor || value.nextCursor.length > MAX_CURSOR_CHARS
      || typeof value.hasMore !== 'boolean') return;
  const groups = parseSyncGroups(value.groups);
  if (!groups) return;
  return { epoch: value.epoch, groups, nextCursor: value.nextCursor, hasMore: value.hasMore };
}

export function parseAdminAccess(input: unknown): AdminAccess | undefined {
  return objectValue(input)?.role === 'operator' ? {role: 'operator'} : undefined;
}

export function parseProblemDetails(input: unknown): ProblemDetails | undefined {
  const value = objectValue(input);
  if (!value || typeof value.type !== 'string' || typeof value.title !== 'string'
      || !isPositiveInt(value.status) || value.status < 400 || value.status > 599
      || typeof value.code !== 'string' || typeof value.instance !== 'string') return;
  return {type: value.type, title: value.title, status: value.status, code: value.code, instance: value.instance,
    ...(typeof value.detail === 'string' ? {detail: value.detail} : {})};
}

export type SessionResponse = { accountId: string };

export function parseSessionResponse(input: unknown): SessionResponse | undefined {
  const accountId = objectValue(input)?.accountId;
  return isUuid(accountId) ? {accountId} : undefined;
}

export * from './workspace.ts';
export * from './account-export.ts';
export * from './library.ts';
export * from './workspace-batch.ts';
export * from './workspace-history.ts';
