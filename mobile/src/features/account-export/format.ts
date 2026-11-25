import {ACCOUNT_EXPORT_FORMAT, type AccountExportPage, type WorkspaceHistoryKind, type WorkspaceHistoryPage} from '@levelmaxing/contracts';

const MAX_SINGLE_TEXT = 80_000;
// Encapsulated JSON doubles certain characters when escaping. Limit fragments conservatively.
const FRAGMENT_LENGTH = 30_000;

const ARCHIVE_EXPORT_FORMAT = 'levelmaxing-archived-records-v1';

type ExportPageInfo = {exportId: string; startedAt: string; index: number};

export function accountExportTexts(page: AccountExportPage, info: ExportPageInfo): string[] {
  const {highWater, groups, nextCursor} = page.weight;
  return exportTexts(ACCOUNT_EXPORT_FORMAT, info, {workspace: page.workspace,
    weight: {throughRevision: highWater, groups}, hasMoreWeight: nextCursor !== null,
  });
}

export function archiveExportTexts(kind: WorkspaceHistoryKind, page: WorkspaceHistoryPage, info: ExportPageInfo): string[] {
  return exportTexts(ARCHIVE_EXPORT_FORMAT, info, {kind, records: page.rows.map(({id, date, value}) => ({id, date, value})), hasMore: page.next !== null});
}

function exportTexts(format: string, info: ExportPageInfo, content: Record<string, unknown>): string[] {
  const payload = JSON.stringify({format, ...info, ...content});
  if (payload.length <= MAX_SINGLE_TEXT) return [payload];
  const count = Math.ceil(payload.length / FRAGMENT_LENGTH);
  return Array.from({length: count}, (_, index) => JSON.stringify({
    format, exportId: info.exportId, page: info.index, index: index + 1, count,
    // Concatenate decoded payload fields in index order to reconstruct this page.
    payload: payload.slice(index * FRAGMENT_LENGTH, (index + 1) * FRAGMENT_LENGTH),
  }));
}
