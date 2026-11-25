import { parseWorkspaceHistoryMove, type WorkspaceHistoryKind, type WorkspaceHistoryMove } from '@levelmaxing/contracts';

type Storage = {
  read: (key: string) => Promise<string | null>;
  write: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

// A device keeps at most one command per account and record kind. Keep the
// serialized payload below the smallest secure-storage size used by the app.
const maximumBytes = 2_048;
const operations = new Map<string, Promise<void>>();

async function locked<T>(key: string, run: () => Promise<T>) {
  const result = (operations.get(key) ?? Promise.resolve()).then(run);
  const settled = result.then(() => undefined, () => undefined);
  operations.set(key, settled);
  try {
    return await result;
  } finally {
    if (operations.get(key) === settled) operations.delete(key);
  }
}

function freezeCommand(command: WorkspaceHistoryMove) {
  Object.freeze(command.ids);
  if (command.recordTags) Object.freeze(command.recordTags);
  return Object.freeze(command);
}

export function createPendingHistoryStore(keyForScope: () => Promise<string>, kind: WorkspaceHistoryKind, storage: Storage) {
  async function read(key: string) {
    const raw = await storage.read(key);
    if (raw === null) return undefined;
    const command = parseWorkspaceHistoryMove(JSON.parse(raw));
    if (!command || command.kind !== kind) throw new Error('The saved history move could not be read.');
    return freezeCommand(command);
  }

  return {
    async load() {
      const key = await keyForScope();
      return locked(key, () => read(key));
    },
    async stage(input: WorkspaceHistoryMove) {
      const key = await keyForScope();
      return locked(key, async () => {
        const previous = await read(key);
        if (previous) return previous;
        const command = parseWorkspaceHistoryMove(input);
        if (!command || command.kind !== kind) throw new Error('The history move is invalid.');
        const bytes = JSON.stringify(command);
        // This command's validated identifiers and tags are ASCII.
        if (bytes.length > maximumBytes) throw new Error('Select fewer records for this move.');
        await storage.write(key, bytes);
        return freezeCommand(command);
      });
    },
    async complete(operationId: string) {
      const key = await keyForScope();
      return locked(key, async () => {
        if ((await read(key))?.operationId === operationId) await storage.remove(key);
      });
    },
  };
}
