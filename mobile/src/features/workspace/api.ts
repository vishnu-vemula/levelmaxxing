import {
  WORKSPACE_EMPTY_TAG, parseWorkspaceBatchResponse, parseWorkspaceCheckedSaveResult, parseWorkspaceSaveResult, parseWorkspaceSnapshot,
  type WorkspaceBatchRequest, type WorkspaceSection, type WorkspaceSnapshot,
} from '@levelmaxing/contracts';
import { ApiFailure, type ApiRequester } from '../../platform/api.ts';
import { sameWorkspaceValue } from './merge.ts';
import type { WorkspaceTransport } from './model.ts';

// A lost receipt can leave a known local version without its old server tag.
const unobservedTag = 'f'.repeat(64);
type CachedSnapshot = { tag: string; snapshot: WorkspaceSnapshot };
type ReadWaiter = {
  section: WorkspaceSection;
  signal: AbortSignal;
  resolve: (snapshot: WorkspaceSnapshot) => void;
  reject: (cause: unknown) => void;
};

function interrupted() {
  const error = new Error('The workspace read was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function createWorkspaceTransport(request: ApiRequester): WorkspaceTransport {
  let supportsBatch = true;
  let supportsCheckedSave = true;
  const cached = new Map<WorkspaceSection, CachedSnapshot>();
  let queued: ReadWaiter[] = [];
  const legacyRead: WorkspaceTransport['read'] = (section, signal) =>
    request(`v1/workspace?section=${section}`, (body) => parseWorkspaceSnapshot(section, body), signal);

  async function flush() {
    const wave = queued;
    queued = [];
    const waiters = wave.filter((waiter) => {
      if (!waiter.signal.aborted) return true;
      waiter.reject(interrupted());
      return false;
    });
    if (waiters.length === 0) return;
    if (!supportsBatch) {
      for (const waiter of waiters) void legacyRead(waiter.section, waiter.signal).then(waiter.resolve, waiter.reject);
      return;
    }

    const sections = new Set(waiters.map(({section}) => section));
    const known = new Map([...sections].map((section) => [section, cached.get(section)]));
    const body: WorkspaceBatchRequest = {
      sections: [...known].map(([section, prior]) => ({ section, known: prior?.tag ?? null })),
    };
    const batch = new AbortController();
    const remaining = new Set(waiters);
    const cancellation = new Map(waiters.map((waiter) => [waiter, () => {
      remaining.delete(waiter);
      waiter.reject(interrupted());
      if (remaining.size === 0) batch.abort();
    }]));
    for (const [waiter, cancel] of cancellation) waiter.signal.addEventListener('abort', cancel, { once: true });

    try {
      const result = await request('v1/workspace/batch', (data) => parseWorkspaceBatchResponse(body, data), batch.signal, body);
      for (const response of result.sections) {
        const interested = [...remaining].filter(({section}) => response.section === section);
        if (!interested.length) continue;
        const snapshot = response.snapshot ?? known.get(response.section)?.snapshot;
        if (!snapshot) throw new ApiFailure(502, 'response_invalid');
        // Late overlapping reads can use their own response but cannot replace
        // the cache established since this request started.
        if (cached.get(response.section) === known.get(response.section) && response.snapshot) {
          cached.set(response.section, { tag: response.tag, snapshot });
        }
        for (const waiter of interested) waiter.resolve(snapshot);
      }
    } catch (error) {
      if (remaining.size > 0 && error instanceof ApiFailure && error.status === 404 && error.code === 'route_not_found') {
        supportsBatch = false;
        cached.clear();
        for (const waiter of remaining) void legacyRead(waiter.section, waiter.signal).then(waiter.resolve, waiter.reject);
      } else {
        for (const waiter of remaining) waiter.reject(error);
      }
    } finally {
      for (const [waiter, cancel] of cancellation) waiter.signal.removeEventListener('abort', cancel);
    }
  }

  function read(section: WorkspaceSection, signal: AbortSignal): Promise<WorkspaceSnapshot> {
    if (signal.aborted) return Promise.reject(interrupted());
    if (!supportsBatch) return legacyRead(section, signal);
    return new Promise<WorkspaceSnapshot>((resolve, reject) => {
      queued.push({ section, signal, resolve, reject });
      if (queued.length === 1) void Promise.resolve().then(flush);
    });
  }

  const save: WorkspaceTransport['save'] = async (command, signal, base, check) => {
    const decode = (body: unknown) => parseWorkspaceSaveResult(command.section, body);
    const legacySave = () => request('v1/workspace/save', decode, signal, command);
    if (!base) return legacySave();

    const matchesBase = (snapshot: WorkspaceSnapshot) => snapshot.version === base.version
      && sameWorkspaceValue(snapshot.value, base.value);
    let inspected: WorkspaceSnapshot | undefined;
    let prior = cached.get(command.section);
    if (supportsCheckedSave && supportsBatch) {
      if (check?.known === undefined && base.version > 0 && (!prior || !matchesBase(prior.snapshot))) {
        inspected = await read(command.section, signal);
        prior = cached.get(command.section);
      }
      if (supportsBatch) {
        const derived = check?.known ?? (base.version === 0 ? WORKSPACE_EMPTY_TAG
          : prior && matchesBase(prior.snapshot) ? prior.tag : unobservedTag);
        const known = check && check.known === undefined && base.version > 0 ? await check.persist(derived) : derived;
        if (signal.aborted) throw interrupted();
        try {
          const result = await request('v1/workspace/save-checked',
            (body) => parseWorkspaceCheckedSaveResult(command.section, body), signal, { command, known });
          if (result.outcome === 'applied' && result.tag && result.snapshot.version === command.expect + 1 &&
              sameWorkspaceValue(result.snapshot.value, command.value) &&
              !signal.aborted && cached.get(command.section) === prior &&
              (!prior || prior.snapshot.version < result.snapshot.version || sameWorkspaceValue(prior.snapshot, result.snapshot))) {
            cached.set(command.section, { tag: result.tag, snapshot: result.snapshot });
          }
          return result;
        } catch (failure) {
          if (!(failure instanceof ApiFailure) ||
              !((failure.status === 404 && failure.code === 'route_not_found') ||
              (failure.status === 501 && failure.code === 'checked_workspace_unavailable'))) throw failure;
          supportsCheckedSave = false;
          inspected = undefined;
        }
      }
    }

    // An older deployment cannot atomically check representation tags. Read
    // once before its version-only save so already-observed divergence is safe.
    if (base.version > 0) {
      const remote = inspected ?? await read(command.section, signal);
      if (remote.version === base.version && !matchesBase(remote)) return { outcome: 'conflict', snapshot: remote };
    }
    return legacySave();
  };

  return { read, save };
}
