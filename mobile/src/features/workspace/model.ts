import {
  isUuid, objectValue, parseWorkspaceSave, parseWorkspaceSnapshot, parseWorkspaceValue, WORKSPACE_MAX_BYTES,
  workspaceSections, type WorkspaceSave, type WorkspaceSaveResult, type WorkspaceSection,
  type WorkspaceSnapshot, type WorkspaceValues,
} from '@levelmaxing/contracts';
import { combineWorkspaceChanges, sameWorkspaceValue } from './merge.ts';

export type ResolutionChoice = 'local' | 'remote' | 'combine';

export type WorkspaceStatus = 'loading' | 'saved' | 'syncing' | 'offline' | 'conflict' | 'unavailable';
export type Replica = {
  base: WorkspaceSnapshot;
  local: WorkspaceValues[WorkspaceSection] | null;
  pending: WorkspaceSave | null;
  conflict: WorkspaceSnapshot | null;
};
export type WorkspaceView = { replica: Replica; status: WorkspaceStatus };
export interface WorkspaceStore {
  read(section: WorkspaceSection): Promise<Replica>;
  write(section: WorkspaceSection, replica: Replica): Promise<void>;
  close(): Promise<void>;
}
export interface WorkspaceTransport {
  read(section: WorkspaceSection, signal: AbortSignal): Promise<WorkspaceSnapshot>;
  save(command: WorkspaceSave, signal: AbortSignal, base?: WorkspaceSnapshot): Promise<WorkspaceSaveResult>;
}

const emptyBase: WorkspaceSnapshot = { version: 0, value: null };
export const emptyReplica: Replica = { base: emptyBase, local: null, pending: null, conflict: null };

export function decodeReplica(section: WorkspaceSection, input: unknown): Replica | undefined {
  const raw = objectValue(input);
  if (!raw) return;
  const base = parseWorkspaceSnapshot(section, raw.base);
  const local = raw.local === null ? null : parseWorkspaceValue(section, raw.local);
  const pending = raw.pending === null ? null : parseWorkspaceSave(raw.pending);
  const conflict = raw.conflict === null ? null : parseWorkspaceSnapshot(section, raw.conflict);
  if (!base || local === undefined || pending === undefined || conflict === undefined) return;
  if (pending && (pending.section !== section || pending.expect !== base.version || local === null || conflict)) return;
  if (conflict && local === null) return;
  if (!pending && !conflict && !sameWorkspaceValue(base.value, local)) return;
  return { base, local, pending, conflict };
}

function encodedBytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function newCommand(section: WorkspaceSection, expect: number, local: WorkspaceValues[WorkspaceSection], id: string): WorkspaceSave {
  const command = parseWorkspaceSave({ section, expect, operationId: id, value: local });
  if (!command || !isUuid(id)) throw new Error('This entry contains values outside the supported range.');
  // Reserve enough space for the expected version if the command waits behind another write.
  if (encodedBytes(JSON.stringify({ ...command, expect: Number.MAX_SAFE_INTEGER })) > WORKSPACE_MAX_BYTES) {
    throw new Error('This section is full. Remove older entries before adding more.');
  }
  return command;
}

export class WorkspaceController {
  private store: WorkspaceStore | undefined;
  private transport: WorkspaceTransport | null = null;
  private closed = false;
  private initializing = false;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly inflight = new Map<WorkspaceSection, AbortController>();
  private readonly listeners = new Set<() => void>();
  private readonly views = new Map<WorkspaceSection, WorkspaceView>(workspaceSections.map((section) =>
    [section, { replica: emptyReplica, status: 'loading' }]));
  private readonly createId: () => string;
  constructor(createId: () => string) {
    this.createId = createId;
  }

  view = (section: WorkspaceSection) => this.views.get(section)!;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(section: WorkspaceSection, replica: Replica, status: WorkspaceStatus) {
    if (this.closed) return;
    const prior = this.view(section);
    if (prior.replica === replica && prior.status === status) return;
    this.views.set(section, { replica, status });
    for (const listener of this.listeners) listener();
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.writes.then(action);
    this.writes = next.then(() => undefined, () => undefined);
    return next;
  }

  async start(open: () => Promise<WorkspaceStore>) {
    if (this.closed || this.initializing || this.store) return;
    this.initializing = true;
    try {
      const store = await open();
      if (this.closed) {
        await store.close();
        return;
      }
      this.store = store;
      for (const section of workspaceSections) {
        try {
          const replica = await this.serialize(() => this.closed ? Promise.resolve(emptyReplica) : store.read(section));
          this.publish(section, replica, replica.conflict ? 'conflict' : this.transport ? 'syncing' : 'offline');
        } catch {
          this.publish(section, emptyReplica, 'unavailable');
        }
      }
      this.syncAll();
    } catch {
      for (const section of workspaceSections) this.publish(section, emptyReplica, 'unavailable');
    } finally {
      this.initializing = false;
    }
  }

  connect(transport: WorkspaceTransport | null) {
    if (this.transport === transport || this.closed) return;
    this.transport = transport;
    for (const request of this.inflight.values()) request.abort();
    this.inflight.clear();
    this.syncAll();
  }

  async save<K extends WorkspaceSection>(section: K, input: WorkspaceValues[K], expectedLocal?: WorkspaceValues[K] | null) {
    const normalized = parseWorkspaceValue(section, input);
    if (!normalized) throw new Error('This entry contains values outside the supported range.');
    // Take a snapshot before the async write so UI edits cannot change an outbox entry.
    const local = JSON.parse(JSON.stringify(normalized)) as WorkspaceValues[K];
    await this.serialize(async () => {
      const { replica, status } = this.view(section);
      if (!this.store || this.closed || status === 'loading' || status === 'unavailable') {
        throw new Error('Device storage is unavailable. Open the app again to retry.');
      }
      if (sameWorkspaceValue(replica.local, local)) return;
      if (expectedLocal !== undefined && !sameWorkspaceValue(replica.local, expectedLocal)) {
        throw new Error('This section changed while you were editing. Review the latest values before saving again.');
      }
      const command = newCommand(section, replica.base.version, local, this.createId());
      const next = { ...replica, local, pending: replica.conflict ? null : replica.pending ?? command };
      await this.store.write(section, next);
      this.publish(section, next, next.conflict ? 'conflict' : this.transport ? 'syncing' : 'offline');
    });
    void this.sync(section);
  }

  async resolve(section: WorkspaceSection, choice: ResolutionChoice) {
    await this.serialize(async () => {
      const { replica } = this.view(section);
      if (!this.store || this.closed || !replica.conflict) return;
      const base = replica.conflict;
      const local = choice === 'combine'
        ? combineWorkspaceChanges(section, replica.base, replica.local, base)
        : choice === 'local' ? replica.local : base.value;
      if (local === undefined) throw new Error('These edits now overlap. Choose the version you want to keep.');
      const pending = choice !== 'remote' && local !== null && !sameWorkspaceValue(local, base.value)
        ? newCommand(section, base.version, local, this.createId()) : null;
      const next: Replica = { base, local, pending, conflict: null };
      await this.store.write(section, next);
      this.publish(section, next, this.transport ? 'syncing' : 'offline');
    });
    void this.sync(section);
  }

  syncAll = () => { for (const section of workspaceSections) void this.sync(section); };

  private async sync(section: WorkspaceSection) {
    const initial = this.view(section);
    if (!this.store || this.closed || this.inflight.has(section) || initial.status === 'loading' || initial.status === 'unavailable') return;
    const transport = this.transport;
    if (!transport) {
      this.publish(section, initial.replica, initial.replica.conflict ? 'conflict' : 'offline');
      return;
    }
    if (initial.replica.conflict) return;
    const request = new AbortController();
    this.inflight.set(section, request);
    const isActive = () => !this.closed && !request.signal.aborted;
    const pending = initial.replica.pending;
    let more = false;
    this.publish(section, initial.replica, 'syncing');
    try {
      const response = pending ? await transport.save(pending, request.signal, initial.replica.base) : null;
      const snapshot = response?.snapshot ?? await transport.read(section, request.signal);
      if (pending && response?.outcome === 'applied' &&
        (snapshot.version !== pending.expect + 1 || !sameWorkspaceValue(snapshot.value, pending.value))) {
        throw new Error('The server returned an invalid workspace receipt.');
      }
      await this.serialize(async () => {
        if (!isActive() || !this.store) return;
        const { replica } = this.view(section);
        let next: Replica;
        if (pending) {
          if (replica.pending?.operationId !== pending.operationId) return;
          if (response?.outcome === 'conflict') {
            next = { ...replica, pending: null, conflict: snapshot };
          } else {
            const queued = replica.local && !sameWorkspaceValue(replica.local, pending.value)
              ? newCommand(section, snapshot.version, replica.local, this.createId()) : null;
            next = { base: snapshot, local: queued ? replica.local : snapshot.value, pending: queued, conflict: null };
          }
        } else if (replica.pending) {
          more = true;
          return;
        } else if (snapshot.version <= replica.base.version && !sameWorkspaceValue(snapshot, replica.base)) {
          next = { ...replica, conflict: snapshot };
        } else if (sameWorkspaceValue(snapshot, replica.base)) {
          next = replica;
        } else {
          next = { base: snapshot, local: snapshot.value, pending: null, conflict: null };
        }
        if (next !== replica) await this.store.write(section, next);
        // Once persisted, publish this transition even if a token changed during the write.
        more = next.pending !== null;
        this.publish(section, next, next.conflict ? 'conflict' : more ? 'syncing' : this.transport ? 'saved' : 'offline');
      });
    } catch {
      if (isActive()) this.publish(section, this.view(section).replica, 'offline');
    } finally {
      if (this.inflight.get(section) === request) this.inflight.delete(section);
      if (more && !this.closed) void this.sync(section);
    }
  }

  async close() {
    this.closed = true;
    for (const request of this.inflight.values()) request.abort();
    this.listeners.clear();
    await this.serialize(async () => { await this.store?.close(); });
  }
}
