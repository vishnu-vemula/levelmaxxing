import {
  historyRecordDate, type NutritionData, type TrainingData, type WorkspaceHistoryKind, type WorkspaceHistoryRow, type WorkspaceSnapshot,
} from '@levelmaxing/contracts';

export function activeHistoryRows(kind: WorkspaceHistoryKind, workspace: NutritionData | TrainingData | null): WorkspaceHistoryRow[] {
  if (!workspace) return [];
  const records = kind === 'meals'
    ? ('meals' in workspace ? workspace.meals : [])
    : ('history' in workspace ? workspace.history : []);
  const rows: WorkspaceHistoryRow[] = [];
  for (const value of records) {
    const date = historyRecordDate(kind, value);
    if (date) rows.push({ id: value.id, date, value });
  }
  return rows.sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? 1 : -1;
    return left.id === right.id ? 0 : left.id < right.id ? 1 : -1;
  });
}

export function matchesHistorySelection(
  local: WorkspaceSnapshot,
  latest: WorkspaceSnapshot,
  selected: readonly WorkspaceHistoryRow[],
  available: readonly WorkspaceHistoryRow[],
  equal: (left: unknown, right: unknown) => boolean,
): boolean {
  if (latest.version !== local.version || !equal(latest.value, local.value)) return false;
  const currentRows = new Map(available.map((row) => [row.id, row]));
  return selected.every((row) => equal(row, currentRows.get(row.id)));
}
