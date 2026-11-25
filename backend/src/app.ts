import {authenticate, requireOperator, requireParticipant, requireRecentAuthentication, type Actor, type IdentityVerifier} from './features/access/index.ts';
import {createAccountExportHandlers} from './features/account-export/index.ts';
import {createHistoryHandlers, type HistoryStore} from './features/history/index.ts';
import {createBundledLibraryCatalog, createLibraryHandlers, type LibraryCatalog} from './features/library/index.ts';
import {createSyncHandlers, type CursorCodec, type SyncStore} from './features/sync/index.ts';
import {createWorkspaceHandlers, type WorkspaceStore} from './features/workspace/index.ts';
import {HttpProblem, json, problemResponse} from './platform/http.ts';

type RequestLog = { event: 'api.request'; requestId: string; route: string; status: number; durationMs: number };
export type AppDependencies = {
  verifyIdentity: IdentityVerifier;
  syncStore: SyncStore;
  cursorCodec: CursorCodec;
  workspaceStore?: WorkspaceStore;
  historyStore?: HistoryStore;
  libraryCatalog?: LibraryCatalog;
  allowedOrigin?: string;
  log?: (record: RequestLog) => void;
};
type Route =
  | {method: 'GET'; grant: 'public'; handler: () => Response}
  | {method: 'GET' | 'POST'; grant: 'participant' | 'operator'; handler: (request: Request, actor: Actor) => Promise<Response> | Response};

function withCors(response: Response, origin: string | null, allowed: string | undefined): Response {
  response.headers.append('vary', 'Origin');
  if (origin && origin === allowed) {
    response.headers.set('access-control-allow-origin', origin);
    response.headers.set('access-control-expose-headers', 'X-Request-Id, Retry-After');
  }
  return response;
}

export function createApp({verifyIdentity, syncStore, cursorCodec, workspaceStore, historyStore, libraryCatalog = createBundledLibraryCatalog(), allowedOrigin, log}: AppDependencies) {
  if (allowedOrigin && (!URL.canParse(allowedOrigin) || new URL(allowedOrigin).origin !== allowedOrigin)) {
    throw new Error('Set the allowed origin without a path or trailing slash.');
  }
  const sync = createSyncHandlers(syncStore, cursorCodec);
  const workspace = createWorkspaceHandlers(workspaceStore);
  const history = createHistoryHandlers(historyStore);
  const accountExport = createAccountExportHandlers(syncStore, workspaceStore, cursorCodec, requireRecentAuthentication);
  const library = createLibraryHandlers(libraryCatalog);
  const routes = new Map<string, Route>([
    ['/healthz', {method: 'GET', grant: 'public', handler: () => json({status: 'ok'})}],
    ['/v1/session', {method: 'GET', grant: 'participant', handler: (_request, actor) => json({accountId: actor.accountId})}],
    ['/v1/devices', {method: 'POST', grant: 'participant', handler: sync.register}],
    ['/v1/sync/push', {method: 'POST', grant: 'participant', handler: sync.push}],
    ['/v1/sync/pull', {method: 'GET', grant: 'participant', handler: sync.pull}],
    ['/v1/workspace', {method: 'GET', grant: 'participant', handler: workspace.read}],
    ['/v1/workspace/batch', {method: 'POST', grant: 'participant', handler: workspace.batch}],
    ['/v1/workspace/save-checked', {method: 'POST', grant: 'participant', handler: workspace.saveChecked}],
    ['/v1/workspace/save', {method: 'POST', grant: 'participant', handler: workspace.save}],
    ['/v1/history', {method: 'GET', grant: 'participant', handler: history.page}],
    ['/v1/history/move', {method: 'POST', grant: 'participant', handler: history.move}],
    ['/v1/account/export/history', {method: 'GET', grant: 'participant', handler: (request, actor) => {
      requireRecentAuthentication(actor);
      return history.page(request, actor);
    }}],
    ['/v1/account/export', {method: 'GET', grant: 'participant', handler: accountExport.read}],
    ['/v1/library', {method: 'GET', grant: 'participant', handler: library.list}],
    ['/v1/library/guide', {method: 'GET', grant: 'participant', handler: library.read}],
    ['/v1/admin/access', {method: 'GET', grant: 'operator', handler: () => json({role: 'operator'})}],
  ]);
  return async function handle(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const start = performance.now();
    const path = new URL(request.url).pathname;
    const route = routes.get(path);
    const origin = request.headers.get('origin');
    let response: Response;
    try {
      if (!route) throw new HttpProblem(404, 'route_not_found', 'The route does not exist');
      if (origin && allowedOrigin !== origin) throw new HttpProblem(403, 'origin_denied', 'The browser origin is not allowed');
      if (request.method === 'OPTIONS') {
        if (!origin || request.headers.get('access-control-request-method')?.toUpperCase() !== route.method) {
          throw new HttpProblem(405, 'method_not_allowed', 'The request method is not supported');
        }
        response = new Response(null, {status: 204, headers: {
          'cache-control': 'no-store',
          'access-control-allow-headers': 'Authorization, Content-Type, Apikey',
          'access-control-allow-methods': route.method,
        }});
      } else if (request.method !== route.method) {
        throw new HttpProblem(405, 'method_not_allowed', 'The request method is not supported');
      } else if (route.grant === 'public') {
        response = route.handler();
      } else {
        const actor = await authenticate(request, verifyIdentity);
        if (route.grant === 'operator') requireOperator(actor);
        else requireParticipant(actor);
        response = await route.handler(request, actor);
      }
    } catch (error) {
      const problem = error instanceof HttpProblem ? error : new HttpProblem(500, 'internal_error', 'The request could not be completed');
      response = problemResponse(problem, requestId);
      if (route && problem.status === 405) response.headers.set('allow', route.method);
    }
    response.headers.set('x-request-id', requestId);
    log?.({event: 'api.request', requestId, route: route ? path : 'unmatched', status: response.status, durationMs: Math.round(performance.now() - start)});
    return withCors(response, origin, allowedOrigin);
  };
}
