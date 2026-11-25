import {isRevision, MAX_CURSOR_CHARS, objectValue, parseSyncGroups, type SyncGroup} from './index.ts';
import {parseWorkspaceSnapshot, type WorkspaceSection, type WorkspaceSnapshot} from './workspace.ts';

export const ACCOUNT_EXPORT_WEIGHT_PAGE_GROUPS = 20;
export const ACCOUNT_EXPORT_FORMAT = 'levelmaxing-confirmed-records-v1';

export type ExportWorkspace = {[S in WorkspaceSection]: WorkspaceSnapshot<S>};
export type AccountExportPage = {
  schemaVersion: 1;
  workspace: ExportWorkspace | null;
  weight: {highWater: string; groups: SyncGroup[]; nextCursor: string | null};
};

function parseWorkspaceExport(input: unknown): ExportWorkspace | undefined {
  const data = objectValue(input);
  if (!data) return;
  const profile = parseWorkspaceSnapshot('profile', data.profile);
  const training = parseWorkspaceSnapshot('training', data.training);
  const nutrition = parseWorkspaceSnapshot('nutrition', data.nutrition);
  const journal = parseWorkspaceSnapshot('journal', data.journal);
  if (profile && training && nutrition && journal) return {profile, training, nutrition, journal};
}

export function parseAccountExportPage(input: unknown): AccountExportPage | undefined {
  const data = objectValue(input);
  const weight = objectValue(data?.weight);
  if (!data || data.schemaVersion !== 1 || !weight || !isRevision(weight.highWater)) return;
  const workspace = data.workspace === null ? null : parseWorkspaceExport(data.workspace);
  const groups = parseSyncGroups(weight.groups);
  if (workspace === undefined || !groups || groups.length > ACCOUNT_EXPORT_WEIGHT_PAGE_GROUPS) return;
  const nextCursor = weight.nextCursor;
  if (nextCursor !== null && (typeof nextCursor !== 'string' || nextCursor.length > MAX_CURSOR_CHARS ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(nextCursor))) return;
  const previous = groups[0] ? BigInt(groups[0].revision) - 1n : 0n;
  if (workspace !== null && previous !== 0n) return;
  if (workspace === null && (previous === 0n || previous > BigInt(weight.highWater))) return;
  if (groups.some((group, index) => BigInt(group.revision) !== previous + BigInt(index) + 1n)) return;
  const last = previous + BigInt(groups.length);
  const highWater = BigInt(weight.highWater);
  if (last > highWater || (nextCursor === null ? last !== highWater : groups.length === 0 || last >= highWater)) return;
  return {schemaVersion: 1, workspace, weight: {highWater: weight.highWater, groups, nextCursor}};
}
