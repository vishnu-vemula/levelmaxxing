import {
  matchesWorkspaceHistoryMove, parseWorkspaceBatchResponse, parseWorkspaceHistoryMove, parseWorkspaceHistoryMoveResult,
  parseWorkspaceHistoryPage, workspaceHistorySection, type WorkspaceBatchRequest, type WorkspaceHistoryCursor,
  type WorkspaceHistoryKind, type WorkspaceHistoryMove, type WorkspaceHistoryRow, type WorkspaceSnapshot,
} from '@levelmaxing/contracts';
import { ApiFailure, type ApiRequester } from '../../platform/api.ts';

const archivePageSize = 10;

export function createHistoryApi(request: ApiRequester) {
  return {
    archivePage(kind: WorkspaceHistoryKind, before: WorkspaceHistoryCursor | null, signal: AbortSignal) {
      const params = new URLSearchParams({ kind, limit: String(archivePageSize) });
      if (before) {
        params.set('beforeDate', before.date);
        params.set('beforeId', before.id);
      }
      return request(`v1/history?${params.toString()}`, (input) => {
        const page = parseWorkspaceHistoryPage(kind, input);
        if (!page || page.rows.length > archivePageSize) return;
        if (before && page.rows.some(({ date, id }) =>
          date > before.date || (date === before.date && id >= before.id))) return;
        return page;
      }, signal);
    },
    activeSnapshot(kind: WorkspaceHistoryKind, signal: AbortSignal) {
      const query: WorkspaceBatchRequest = { sections: [{ section: workspaceHistorySection(kind), known: null }] };
      return request('v1/workspace/batch', (input) => {
        const section = parseWorkspaceBatchResponse(query, input)?.sections[0];
        if (section?.snapshot) return { snapshot: section.snapshot, tag: section.tag };
      }, signal, query);
    },
    move(command: WorkspaceHistoryMove, signal: AbortSignal) {
      return request('v1/history/move', (input) => {
        const result = parseWorkspaceHistoryMoveResult(input);
        if (result && matchesWorkspaceHistoryMove(command, result)) return result;
      }, signal, command);
    },
  };
}

export function prepareHistoryCommand(
  action: WorkspaceHistoryMove['action'],
  kind: WorkspaceHistoryKind,
  rows: readonly WorkspaceHistoryRow[],
  operationId: string,
  workspace: { snapshot: WorkspaceSnapshot; tag: string },
) {
  const command = parseWorkspaceHistoryMove({
    action, kind, ids: rows.map(({ id }) => id), operationId,
    expectVersion: workspace.snapshot.version, known: workspace.tag,
    ...(action === 'restore' ? { recordTags: rows.map(({ tag }) => tag) } : {}),
  });
  if (command) {
    Object.freeze(command.ids);
    if (command.recordTags) Object.freeze(command.recordTags);
    Object.freeze(command);
  }
  return command;
}

export function unsupportedHistory(error: unknown) {
  return error instanceof ApiFailure &&
    ((error.status === 404 && error.code === 'route_not_found') || (error.status === 501 && error.code === 'history_unavailable'));
}
