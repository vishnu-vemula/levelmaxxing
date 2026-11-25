import {parseAccountExportPage, parseWorkspaceHistoryPage, type WorkspaceHistoryCursor, type WorkspaceHistoryKind} from '@levelmaxing/contracts';
import type {ApiRequester} from '../../platform/api.ts';

export function getAccountExportPage(request: ApiRequester, cursor: string | null, signal: AbortSignal) {
  const route = cursor === null ? 'v1/account/export' : 'v1/account/export?cursor=' + encodeURIComponent(cursor);
  return request(route, parseAccountExportPage, signal);
}

export function getArchiveExportPage(
  request: ApiRequester, kind: WorkspaceHistoryKind, before: WorkspaceHistoryCursor | null, signal: AbortSignal,
) {
  const path = 'v1/account/export/history?kind=' + kind + '&limit=10';
  const position = before ? '&beforeDate=' + encodeURIComponent(before.date) + '&beforeId=' + encodeURIComponent(before.id) : '';
  return request(path + position, (body) => {
    const page = parseWorkspaceHistoryPage(kind, body);
    const first = page?.rows[0];
    if (!page || page.rows.length > 10 ||
        (before && first && (first.date > before.date || (first.date === before.date && first.id >= before.id)))) return;
    return page;
  }, signal);
}
