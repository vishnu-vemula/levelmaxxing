import { objectValue, parseWorkspaceValue, type JournalData, type NutritionData, type WorkspaceSection, type WorkspaceSnapshot } from '@levelmaxing/contracts';

function comparable(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item: unknown) => {
    const record = objectValue(item);
    return record ? Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]])) : item;
  });
}

export function sameWorkspaceValue(left: unknown, right: unknown): boolean {
  return left === right || comparable(left) === comparable(right);
}

function mergeRows<T>(
  original: readonly T[], device: readonly T[], server: readonly T[], identify: (item: T) => string,
): T[] | undefined {
  const before = new Map(original.map((item) => [identify(item), item]));
  const mine = new Map(device.map((item) => [identify(item), item]));
  const theirs = new Map(server.map((item) => [identify(item), item]));
  if (before.size !== original.length || mine.size !== device.length || theirs.size !== server.length) return;
  const merged: T[] = [];
  for (const key of new Set([...mine.keys(), ...theirs.keys()])) {
    const base = before.get(key);
    const local = mine.get(key);
    const remote = theirs.get(key);
    const editedHere = !sameWorkspaceValue(base, local);
    const editedThere = !sameWorkspaceValue(base, remote);
    if (editedHere && editedThere && !sameWorkspaceValue(local, remote)) return;
    const chosen = editedHere ? local : remote;
    if (chosen !== undefined) merged.push(chosen);
  }
  return merged;
}

export function combineWorkspaceChanges(
  section: WorkspaceSection, original: WorkspaceSnapshot, local: WorkspaceSnapshot['value'], remote: WorkspaceSnapshot | null,
): NutritionData | JournalData | undefined {
  // A restore or reset requires an explicit version choice even when current records appear disjoint.
  if (!remote || remote.version <= original.version || !local || !remote.value) return;
  if (section === 'nutrition') {
    const before = original.value === null ? { meals: [], recipes: [], groceries: [] } : parseWorkspaceValue(section, original.value);
    const device = parseWorkspaceValue(section, local);
    const server = parseWorkspaceValue(section, remote.value);
    if (!before || !device || !server) return;
    const meals = mergeRows(before.meals, device.meals, server.meals, ({ id }) => id);
    const recipes = mergeRows(before.recipes, device.recipes, server.recipes, ({ id }) => id);
    const groceries = mergeRows(before.groceries, device.groceries, server.groceries, ({ id }) => id);
    if (meals && recipes && groceries) return parseWorkspaceValue(section, { meals, recipes, groceries });
  }
  if (section === 'journal') {
    const before = original.value === null ? { checkIns: [], activities: [], bookmarks: [] } : parseWorkspaceValue(section, original.value);
    const device = parseWorkspaceValue(section, local);
    const server = parseWorkspaceValue(section, remote.value);
    if (!before || !device || !server) return;
    const checkIns = mergeRows(before.checkIns, device.checkIns, server.checkIns, ({ date }) => date);
    const activities = mergeRows(before.activities, device.activities, server.activities, ({ id }) => id);
    const bookmarks = mergeRows(before.bookmarks, device.bookmarks, server.bookmarks, (id) => id);
    if (checkIns && activities && bookmarks) return parseWorkspaceValue(section, { checkIns, activities, bookmarks });
  }
}
