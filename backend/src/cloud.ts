import {
  matchesWorkspaceHistoryMove, parseWorkspaceHistoryMoveResult, parseWorkspaceHistoryPage, isEpoch, isRevision, isUuid, matchesPushResults, objectValue, parseDeviceRegistration, parsePushResponse, parseSyncGroups,
  parseWorkspaceBatchResponse, parseWorkspaceCheckedSaveResult, parseWorkspaceSaveResult, parseWorkspaceSnapshot,
} from '@levelmaxing/contracts';
import {decodeJwt} from 'jose';
import {createApp, type AppDependencies} from './app.ts';
import {createFirebaseTokenVerifier, participantRequired, type IdentityVerifier} from './features/access/index.ts';
import type {HistoryStore} from './features/history/index.ts';
import {createCursorCodec, type SyncStore} from './features/sync/index.ts';
import {readWorkspaceBatchIndividually, workspaceCheckedUnavailable, workspaceOperationChanged, type WorkspaceStore} from './features/workspace/index.ts';
import {contextChanged, cursorExpired, HttpProblem, unavailable, unauthorized} from './platform/http.ts';

export type CloudConfig = {
  firebaseProjectId: string;
  supabaseUrl: string;
  publishableKey: string;
  cursorSecret: string;
  allowedOrigin?: string;
  fetch?: typeof fetch;
  log?: AppDependencies['log'];
};

const missingWorkspaceBatch = Symbol('missing workspace batch RPC');

type ReadEnvironment = (name: string) => string | undefined;

export function readCloudConfig(read: ReadEnvironment, runtime: 'node' | 'edge'): Omit<CloudConfig, 'fetch' | 'log'> {
  function required(name: string): string {
    const value = read(name);
    if (!value) throw new Error('Missing ' + name + ' in the cloud environment');
    return value;
  }

  const publishableKeyName = runtime === 'node' ? 'SUPABASE_PUBLISHABLE_KEY' : 'LEVELMAXING_PUBLISHABLE_KEY';
  const allowedOrigin = read('LEVELMAXING_ALLOWED_ORIGIN');
  return {
    firebaseProjectId: required('FIREBASE_PROJECT_ID'),
    supabaseUrl: required('SUPABASE_URL'),
    publishableKey: read(publishableKeyName) ?? required('SUPABASE_ANON_KEY'),
    cursorSecret: required('LEVELMAXING_CURSOR_SECRET'),
    ...(allowedOrigin ? {allowedOrigin} : {}),
  };
}

export function createCloudApp(config: CloudConfig) {
  const upstream = config.fetch ?? fetch;
  const verifyFirebaseIdToken = createFirebaseTokenVerifier(config.firebaseProjectId, upstream);
  const url = URL.canParse(config.supabaseUrl) ? new URL(config.supabaseUrl) : undefined;
  if (!url || url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('SUPABASE_URL must be an HTTPS origin.');
  }
  if (!config.publishableKey || config.publishableKey.startsWith('sb_secret_')) throw new Error('Set the Supabase publishable key.');
  // Legacy anon JWTs are supported. Refuse malformed legacy keys and service keys.
  if (!config.publishableKey.startsWith('sb_publishable_') && readClaims(config.publishableKey)?.role !== 'anon') {
    throw new Error('A public Supabase API key is required.');
  }

  async function call(path: string, token: string, signal: AbortSignal, input: unknown): Promise<Response> {
    const headers = new Headers({
      apikey: config.publishableKey,
      authorization: 'Bearer ' + token,
      accept: 'application/json',
      'content-type': 'application/json',
    });
    try {
      return await upstream(new URL(path, url), {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
      });
    } catch {
      throw unavailable();
    }
  }

  async function body(response: Response): Promise<unknown> {
    try { return await response.json(); } catch { throw unavailable(); }
  }

  async function rpc(name: string, token: string, signal: AbortSignal, args: unknown): Promise<unknown> {
    const reply = await call('/rest/v1/rpc/' + name, token, signal, args);
    if (reply.ok) return await body(reply);
    if (reply.status === 401 && name !== 'levelmaxing_resolve_firebase_user_v1') throw unauthorized();
    const problem = objectValue(await body(reply));
    if (reply.status === 404 && problem?.code === 'PGRST202') {
      if (name === 'levelmaxing_workspace_batch_v1') return missingWorkspaceBatch;
      if (name === 'levelmaxing_workspace_save_checked_v1') throw workspaceCheckedUnavailable();
      if (name === 'levelmaxing_history_page_v1' || name === 'levelmaxing_history_move_v1') {
        throw new HttpProblem(501, 'history_unavailable', 'Archived history is unavailable on this server');
      }
    }
    if (reply.status === 403 && problem?.code === '42501' && problem.message === 'participant_required') throw participantRequired();
    const workspaceSave = name === 'levelmaxing_workspace_save_v1' || name === 'levelmaxing_workspace_save_checked_v1';
    if (workspaceSave && problem?.code === '22023' && problem.message === 'invalid_workspace_value') {
      throw new HttpProblem(400, 'invalid_workspace_command', 'The workspace change is invalid');
    }
    if (problem?.code === '22023' && problem.message === 'invalid_history_request' &&
        (name === 'levelmaxing_history_page_v1' || name === 'levelmaxing_history_move_v1')) {
      throw new HttpProblem(400, 'invalid_history_request', 'The history request is invalid');
    }
    if (problem?.code === 'P0001') {
      if (name === 'levelmaxing_push_v1' && problem.message === 'sync_context_changed') throw contextChanged();
      if (name === 'levelmaxing_pull_v1' && problem.message === 'cursor_expired') throw cursorExpired();
      if (name === 'levelmaxing_history_move_v1' && problem.message === 'history_operation_changed') {
        throw new HttpProblem(409, 'history_operation_changed', 'That move ID belongs to another change');
      }
      if (workspaceSave && problem.message === 'workspace_operation_changed') {
        throw workspaceOperationChanged();
      }
    }
    throw unavailable();
  }

  const verifyIdentity: IdentityVerifier = async (token, signal) => {
    const verified = await verifyFirebaseIdToken(token, signal);
    if (!verified) return;
    // PostgREST derives the Firebase UID from this verified token, with no account ID supplied by HTTP.
    const value = await rpc('levelmaxing_resolve_firebase_user_v1', token, signal, {});
    if (value === null) return;
    const account = objectValue(value);
    if (!account || !isUuid(account.accountId) || (account.role !== 'participant' && account.role !== 'operator')) {
      throw unavailable();
    }
    return {accountId: account.accountId, role: account.role, assurance: verified.assurance, authenticatedAt: verified.authenticatedAt};
  };

  const syncStore: SyncStore = {
    async registerDevice(actor, deviceId) {
      const result = parseDeviceRegistration(await rpc('levelmaxing_register_device_v1', actor.token, actor.signal, {p_device_id: deviceId}));
      if (!result || result.deviceId !== deviceId) throw unavailable();
      return result;
    },
    async push(actor, request) {
      const result = parsePushResponse(await rpc('levelmaxing_push_v1', actor.token, actor.signal, {p_request: request}));
      if (!result || !matchesPushResults(request, result)) throw unavailable();
      return result;
    },
    async pull(actor, query) {
      const value = objectValue(await rpc('levelmaxing_pull_v1', actor.token, actor.signal, {
        p_epoch: query.epoch ?? null, p_after: query.after, p_high_water: query.highWater ?? null, p_limit: query.limit,
      }));
      const groups = parseSyncGroups(value?.groups);
      if (!value || !isEpoch(value.epoch) || !isRevision(value.highWater) || !groups) throw unavailable();
      return {epoch: value.epoch, highWater: value.highWater, groups};
    },
  };
  const workspaceStore: WorkspaceStore = {
    async readBatch(actor, command) {
      const data = await rpc('levelmaxing_workspace_batch_v1', actor.token, actor.signal, {p_sections: command.sections});
      if (data === missingWorkspaceBatch) return readWorkspaceBatchIndividually(workspaceStore, actor, command);
      const result = parseWorkspaceBatchResponse(command, data);
      if (!result) throw unavailable();
      return result;
    },
    async read(actor, section) {
      const data = await rpc('levelmaxing_workspace_read_v1', actor.token, actor.signal, {p_section: section});
      const snapshot = parseWorkspaceSnapshot(section, data);
      if (!snapshot) throw unavailable();
      return snapshot;
    },
    async saveChecked(actor, { command, known }) {
      const {section, expect, operationId, value} = command;
      const data = await rpc('levelmaxing_workspace_save_checked_v1', actor.token, actor.signal, {
        p_section: section, p_expect: expect, p_operation_id: operationId, p_value: value, p_known: known,
      });
      const result = parseWorkspaceCheckedSaveResult(section, data);
      if (!result || (result.outcome === 'applied' && result.snapshot.version !== expect + 1)) throw unavailable();
      return result;
    },
    async save(actor, command) {
      const {section, expect, operationId, value} = command;
      const data = await rpc('levelmaxing_workspace_save_v1', actor.token, actor.signal, {
        p_section: section, p_expect: expect, p_operation_id: operationId, p_value: value,
      });
      const result = parseWorkspaceSaveResult(section, data);
      if (!result || (result.outcome === 'applied' && result.snapshot.version !== expect + 1)) {
        throw unavailable();
      }
      return result;
    },
  };
  const historyStore: HistoryStore = {
    async historyPage(actor, query) {
      const {kind, limit, before} = query;
      const data = await rpc('levelmaxing_history_page_v1', actor.token, actor.signal, {
        p_kind: kind, p_limit: limit, p_before_date: before?.date ?? null, p_before_id: before?.id ?? null,
      });
      const page = parseWorkspaceHistoryPage(kind, data);
      const first = page?.rows[0];
      if (!page || page.rows.length > limit ||
          (first && before && (first.date > before.date || (first.date === before.date && first.id >= before.id)))) throw unavailable();
      return page;
    },
    async moveHistory(actor, command) {
      const {action, kind, ids, operationId, expectVersion, known, recordTags} = command;
      const data = await rpc('levelmaxing_history_move_v1', actor.token, actor.signal, {
        p_action: action, p_kind: kind, p_ids: ids, p_operation_id: operationId,
        p_expect_version: expectVersion, p_known: known, p_record_tags: recordTags ?? null,
      });
      const result = parseWorkspaceHistoryMoveResult(data);
      if (!result || !matchesWorkspaceHistoryMove(command, result)) throw unavailable();
      return result;
    },
  };
  return createApp({
    verifyIdentity,
    syncStore,
    workspaceStore,
    historyStore,
    cursorCodec: createCursorCodec(config.cursorSecret),
    ...(config.allowedOrigin === undefined ? {} : {allowedOrigin: config.allowedOrigin}),
    ...(config.log === undefined ? {} : {log: config.log}),
  });
}

function readClaims(token: string): Record<string, unknown> | undefined {
  try {
    // This is a startup shape guard for an optional legacy API key. Supabase authenticates the key.
    return decodeJwt(token);
  } catch {
    return;
  }
}
