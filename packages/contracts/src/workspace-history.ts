import { isEpoch, isPositiveInt, isUuid, objectValue } from './index.ts';
import { parseWorkspaceValue, type FoodLog, type Workout } from './workspace.ts';
import { WORKSPACE_EMPTY_TAG } from './workspace-batch.ts';

export const WORKSPACE_HISTORY_PAGE_MAX = 20;
export const WORKSPACE_HISTORY_MOVE_MAX = 20;
export const WORKSPACE_HISTORY_BODY_MAX = 4096;
export type WorkspaceHistoryKind = 'meals' | 'workouts';
export type WorkspaceHistoryCursor = { date: string; id: string };
export type WorkspaceHistoryQuery = { kind: WorkspaceHistoryKind; limit: number; before?: WorkspaceHistoryCursor };
export type WorkspaceHistoryValue<K extends WorkspaceHistoryKind = WorkspaceHistoryKind> =
  { meals: FoodLog; workouts: Workout }[K];
export type WorkspaceHistoryRow<K extends WorkspaceHistoryKind = WorkspaceHistoryKind> =
  WorkspaceHistoryCursor & { value: WorkspaceHistoryValue<K>; tag?: string };
export type WorkspaceHistoryPage<K extends WorkspaceHistoryKind = WorkspaceHistoryKind> = {
  rows: WorkspaceHistoryRow<K>[];
  next: WorkspaceHistoryCursor | null;
};
export type WorkspaceHistoryMove = {
  action: 'archive' | 'restore';
  kind: WorkspaceHistoryKind;
  ids: string[];
  operationId: string;
  expectVersion: number;
  known: string;
  recordTags?: string[];
};
export type WorkspaceHistoryMoveResult = {
  outcome: 'applied' | 'conflict' | 'missing' | 'capacity';
  moved: number;
  version: number;
  tag: string;
};

export function parseWorkspaceHistoryKind(input: unknown): WorkspaceHistoryKind | undefined {
  if (input === 'meals' || input === 'workouts') return input;
}

export function workspaceHistorySection(kind: WorkspaceHistoryKind): 'nutrition' | 'training' {
  return kind === 'meals' ? 'nutrition' : 'training';
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function parseWorkspaceHistoryCursor(input: unknown): WorkspaceHistoryCursor | undefined {
  const cursor = objectValue(input);
  if (cursor && calendarDate(cursor.date) && isEpoch(cursor.id)) return { date: cursor.date, id: cursor.id };
}

export function historyRecordDate(kind: WorkspaceHistoryKind, value: WorkspaceHistoryValue): string | undefined {
  if (kind === 'meals') return 'date' in value && calendarDate(value.date) ? value.date : undefined;
  const date = 'finishedAt' in value ? value.finishedAt?.slice(0, 10) : undefined;
  return calendarDate(date) ? date : undefined;
}

function parseHistoryValue(kind: WorkspaceHistoryKind, input: unknown): WorkspaceHistoryValue | undefined {
  return kind === 'meals'
    ? parseWorkspaceValue('nutrition', { meals: [input], recipes: [], groceries: [] })?.meals[0]
    : parseWorkspaceValue('training', { programs: [], activeProgramId: null, session: null, history: [input] })?.history[0];
}

export function parseWorkspaceHistoryPage<K extends WorkspaceHistoryKind>(kind: K, input: unknown): WorkspaceHistoryPage<K> | undefined {
  const page = objectValue(input);
  if (!page || !Array.isArray(page.rows) || page.rows.length > WORKSPACE_HISTORY_PAGE_MAX) return;
  const rows: WorkspaceHistoryRow<K>[] = [];
  const seen = new Set<string>();
  let last: WorkspaceHistoryCursor | undefined;
  for (const item of page.rows) {
    const raw = objectValue(item);
    const cursor = parseWorkspaceHistoryCursor(raw);
    const value = parseHistoryValue(kind, raw?.value);
    if (!cursor || !value || !validTag(raw?.tag) || value.id !== cursor.id || historyRecordDate(kind, value) !== cursor.date ||
        seen.has(cursor.id) ||
        (last && (cursor.date > last.date || (cursor.date === last.date && cursor.id >= last.id)))) return;
    seen.add(cursor.id);
    rows.push({ ...cursor, tag: raw.tag, value: value as WorkspaceHistoryValue<K> });
    last = cursor;
  }
  const next = page.next === null ? null : parseWorkspaceHistoryCursor(page.next);
  if (next === undefined || (next && (!last || next.date !== last.date || next.id !== last.id))) return;
  return { rows, next };
}

function validTag(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function parseWorkspaceHistoryMove(input: unknown): WorkspaceHistoryMove | undefined {
  const raw = objectValue(input);
  const kind = parseWorkspaceHistoryKind(raw?.kind);
  if (!raw || !kind || (raw.action !== 'archive' && raw.action !== 'restore') ||
      !Array.isArray(raw.ids) || raw.ids.length === 0 || raw.ids.length > WORKSPACE_HISTORY_MOVE_MAX ||
      !raw.ids.every(isEpoch) || new Set(raw.ids).size !== raw.ids.length ||
      !isUuid(raw.operationId) || !isPositiveInt(raw.expectVersion) ||
      !validTag(raw.known) || raw.known === WORKSPACE_EMPTY_TAG) return;
  const recordTags = raw.recordTags;
  if (raw.action === 'archive') {
    if (Object.keys(raw).length !== 6 || recordTags !== undefined) return;
  } else if (Object.keys(raw).length !== 7 ||
      !Array.isArray(recordTags) || recordTags.length !== raw.ids.length || !recordTags.every(validTag)) return;
  return { action: raw.action, kind, ids: raw.ids, operationId: raw.operationId, expectVersion: raw.expectVersion,
    known: raw.known, ...(recordTags === undefined ? {} : {recordTags: recordTags as string[]}) };
}

export function parseWorkspaceHistoryMoveResult(input: unknown): WorkspaceHistoryMoveResult | undefined {
  const raw = objectValue(input);
  if (!raw || !validTag(raw.tag) ||
      !(raw.version === 0 || isPositiveInt(raw.version)) || (raw.version === 0) !== (raw.tag === WORKSPACE_EMPTY_TAG) ||
      (raw.outcome !== 'applied' && raw.outcome !== 'conflict' && raw.outcome !== 'missing' && raw.outcome !== 'capacity')) return;
  if (raw.outcome === 'applied' ? (!isPositiveInt(raw.moved) || raw.moved > WORKSPACE_HISTORY_MOVE_MAX || raw.version === 0) : raw.moved !== 0) return;
  return { outcome: raw.outcome, moved: raw.moved as number, version: raw.version, tag: raw.tag };
}

export function matchesWorkspaceHistoryMove(command: WorkspaceHistoryMove, result: WorkspaceHistoryMoveResult): boolean {
  return result.outcome !== 'applied' || (result.moved === command.ids.length && result.version === command.expectVersion + 1);
}
