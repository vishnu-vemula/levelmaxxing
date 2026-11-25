import {
  parseWorkspaceHistoryCursor, parseWorkspaceHistoryKind, parseWorkspaceHistoryMove,
  WORKSPACE_HISTORY_BODY_MAX, WORKSPACE_HISTORY_PAGE_MAX, type WorkspaceHistoryQuery,
} from '@levelmaxing/contracts';
import {HttpProblem, json, readJson} from '../../platform/http.ts';
import type {Actor} from '../access/index.ts';
import {historyUnavailable, type HistoryStore} from './store.ts';

const queryKeys = new Set(['kind', 'limit', 'beforeDate', 'beforeId']);

function parseQuery(request: Request): WorkspaceHistoryQuery | undefined {
  const query = new URL(request.url).searchParams;
  const seen = new Set<string>();
  for (const key of query.keys()) {
    if (seen.has(key) || !queryKeys.has(key)) return;
    seen.add(key);
  }
  const kind = parseWorkspaceHistoryKind(query.get('kind'));
  const rawLimit = query.get('limit');
  const limit = rawLimit === null ? 10 : /^[1-9][0-9]?$/.test(rawLimit) ? Number(rawLimit) : 0;
  if (!kind || limit < 1 || limit > WORKSPACE_HISTORY_PAGE_MAX) return;
  if (!seen.has('beforeDate') && !seen.has('beforeId')) return {kind, limit};
  const before = parseWorkspaceHistoryCursor({date: query.get('beforeDate'), id: query.get('beforeId')});
  if (before) return {kind, limit, before};
}

export function createHistoryHandlers(store: HistoryStore | undefined) {
  return {
    async page(request: Request, actor: Actor): Promise<Response> {
      const query = parseQuery(request);
      if (!query) throw new HttpProblem(400, 'invalid_history_query', 'Use a valid archive kind, page limit and cursor');
      if (!store) throw historyUnavailable();
      return json(await store.historyPage(actor, query));
    },
    async move(request: Request, actor: Actor): Promise<Response> {
      const command = parseWorkspaceHistoryMove(await readJson(request, WORKSPACE_HISTORY_BODY_MAX));
      if (!command) throw new HttpProblem(400, 'invalid_history_move', 'Send a valid archive move');
      if (!store) throw historyUnavailable();
      return json(await store.moveHistory(actor, command));
    },
  };
}
