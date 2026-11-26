import { nativeStorage, sha256, type SqlValue } from './native-storage.ts';

type Arguments = SqlValue[] | [SqlValue[]];
const leases = new Map<string, Promise<void>>();

function values(args: Arguments): SqlValue[] {
  return Array.isArray(args[0]) ? args[0] : args as SqlValue[];
}

export interface CipherDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...args: Arguments): Promise<void>;
  getAllAsync<T>(sql: string, ...args: Arguments): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...args: Arguments): Promise<T | null>;
  withTransactionAsync(body: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export async function openCipher(store: 'session' | 'progress' | 'workspace', scope: string): Promise<CipherDatabase> {
  const storage = nativeStorage();
  const namespace = `lm.${store}.${await sha256(scope)}`;
  // A fast account switch may start opening before the old store finishes its last transaction.
  const previous = leases.get(namespace) ?? Promise.resolve();
  let unlock!: () => void;
  const done = new Promise<void>(resolve => { unlock = resolve; });
  const lease = previous.then(() => done);
  leases.set(namespace, lease);
  function release() {
    unlock();
    if (leases.get(namespace) === lease) leases.delete(namespace);
  }
  await previous;
  let connection: string;
  try {
    connection = await storage.open(namespace);
  } catch (error) {
    release();
    throw error;
  }
  let closing: Promise<void> | undefined;
  const execute = async (sql: string) => {
    // This method receives static schema and transaction statements. Bound values use runAsync.
    for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) {
      await storage.execute(connection, statement);
    }
  };
  return {
    execAsync: execute,
    runAsync: (sql, ...args) => storage.run(connection, sql, values(args)),
    getAllAsync: async <T>(sql: string, ...args: Arguments) => (await storage.query(connection, sql, values(args))) as T[],
    getFirstAsync: async <T>(sql: string, ...args: Arguments) =>
      ((await storage.query(connection, sql, values(args)))[0] as T | undefined) ?? null,
    async withTransactionAsync(body) {
      await execute('BEGIN IMMEDIATE');
      try {
        await body();
        await execute('COMMIT');
      } catch (error) {
        await execute('ROLLBACK');
        throw error;
      }
    },
    closeAsync: () => closing ??= storage.close(connection).finally(release),
  };
}
