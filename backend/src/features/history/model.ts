import {
  historyRecordDate, parseWorkspaceValue, WORKSPACE_MAX_BYTES, type FoodLog, type Workout,
  type WorkspaceHistoryMove, type WorkspaceHistoryPage, type WorkspaceHistoryQuery, type WorkspaceHistoryRow,
  type WorkspaceSave, type WorkspaceSnapshot,
} from '@levelmaxing/contracts';

type ReadyPlan = {outcome: 'ready'; recordChanges: WorkspaceHistoryRow[]; workspace: WorkspaceSave};
type Plan = ReadyPlan | {outcome: 'missing' | 'capacity' | 'conflict'};
export type ArchivedHistoryRow = WorkspaceHistoryRow & {tag: string};

export function hasArchivedWorkspaceRecords(
  command: WorkspaceSave, meals: ReadonlyMap<string, WorkspaceHistoryRow>, workouts: ReadonlyMap<string, WorkspaceHistoryRow>,
): boolean {
  if (command.section === 'nutrition') return command.value.meals.some(({id}) => meals.has(id));
  if (command.section === 'training') {
    const current = command.value.session;
    return (current !== null && workouts.has(current.id)) || command.value.history.some(({id}) => workouts.has(id));
  }
  return false;
}

function stageRecords<T extends FoodLog | Workout>(
  command: WorkspaceHistoryMove,
  current: readonly T[],
  archive: ReadonlyMap<string, ArchivedHistoryRow>,
  validateKind: (value: FoodLog | Workout) => value is T,
): {rows: T[]; changes: WorkspaceHistoryRow[]} | undefined {
  const active = new Map(current.map((value) => [value.id, value]));
  if (command.action === 'archive') {
    const changes: WorkspaceHistoryRow[] = [];
    for (const id of command.ids) {
      const value = active.get(id);
      const date = value && historyRecordDate(command.kind, value);
      if (!value || !date || archive.has(id)) return;
      changes.push({id, date, value});
    }
    const selected = new Set(command.ids);
    return {rows: current.filter(({id}) => !selected.has(id)), changes};
  }
  const restorations: {id: string; date: string; value: T}[] = [];
  for (const id of command.ids) {
    const record = archive.get(id);
    if (!record || active.has(id) || !validateKind(record.value)) return;
    restorations.push({...record, value: record.value});
  }
  restorations.sort(compareDescending);
  return {rows: [...current, ...restorations.map(({value}) => value)], changes: restorations};
}

function fitsLegacyWorkspace(command: WorkspaceSave): boolean {
  // Reserve space for the longest expectedVersion when the restored section is edited later.
  return new TextEncoder().encode(JSON.stringify({...command, expect: Number.MAX_SAFE_INTEGER})).byteLength <= WORKSPACE_MAX_BYTES;
}

export function planHistoryMove(
  snapshot: WorkspaceSnapshot,
  command: WorkspaceHistoryMove,
  archive: ReadonlyMap<string, ArchivedHistoryRow>,
): Plan {
  const value = snapshot.value;
  if (!value) return {outcome: 'missing'};
  if (command.action === 'restore') {
    const rows = command.ids.map((id) => archive.get(id));
    if (rows.some((row) => row === undefined)) return {outcome: 'missing'};
    if (rows.some((row, index) => row?.tag !== command.recordTags?.[index])) return {outcome: 'conflict'};
  }
  const coordinates = {expect: command.expectVersion, operationId: command.operationId};
  let ready: ReadyPlan;
  if (command.kind === 'meals') {
    if (!('meals' in value)) return {outcome: 'missing'};
    const staged = stageRecords(command, value.meals, archive, (record): record is FoodLog => 'date' in record);
    if (!staged) return {outcome: 'missing'};
    const workspace = parseWorkspaceValue('nutrition', {...value, meals: staged.rows});
    if (!workspace) return {outcome: 'capacity'};
    ready = {outcome: 'ready', recordChanges: staged.changes, workspace: {section: 'nutrition', value: workspace, ...coordinates}};
  } else {
    if (!('history' in value)) return {outcome: 'missing'};
    if (value.session && command.ids.includes(value.session.id)) return {outcome: 'missing'};
    const staged = stageRecords(command, value.history, archive, (record): record is Workout => 'finishedAt' in record);
    if (!staged) return {outcome: 'missing'};
    const history = command.action === 'restore' ? staged.rows.sort(compareWorkoutsDescending) : staged.rows;
    const workspace = parseWorkspaceValue('training', {...value, history});
    if (!workspace) return {outcome: 'capacity'};
    ready = {outcome: 'ready', recordChanges: staged.changes, workspace: {section: 'training', value: workspace, ...coordinates}};
  }
  if (command.action === 'restore' && !fitsLegacyWorkspace(ready.workspace)) return {outcome: 'capacity'};
  return ready;
}

function compareDescending(left: {date: string; id: string}, right: {date: string; id: string}): number {
  if (left.date !== right.date) return left.date > right.date ? -1 : 1;
  if (left.id !== right.id) return left.id > right.id ? -1 : 1;
  return 0;
}

function compareWorkoutsDescending(left: Workout, right: Workout): number {
  const leftTime = left.finishedAt ?? left.startedAt;
  const rightTime = right.finishedAt ?? right.startedAt;
  if (leftTime !== rightTime) return leftTime > rightTime ? -1 : 1;
  if (left.id !== right.id) return left.id > right.id ? -1 : 1;
  return 0;
}

export function archivePage(archive: ReadonlyMap<string, ArchivedHistoryRow> | undefined, query: WorkspaceHistoryQuery): WorkspaceHistoryPage {
  const before = query.before;
  const afterCursor = Array.from(archive?.values() ?? [])
    .filter((record) => !before || compareDescending(record, before) > 0)
    .sort(compareDescending);
  const rows: ArchivedHistoryRow[] = [];
  const encoder = new TextEncoder();
  // Leave room for the envelope and the last row's cursor.
  let remainingBytes = 1024 * 1024 - 256;
  for (const record of afterCursor.slice(0, query.limit)) {
    const bytes = encoder.encode(JSON.stringify(record)).byteLength + 1;
    if (bytes > remainingBytes) break;
    rows.push(record);
    remainingBytes -= bytes;
  }
  const last = afterCursor.length > rows.length ? rows.at(-1) : undefined;
  return {rows: structuredClone(rows), next: last ? {date: last.date, id: last.id} : null};
}
