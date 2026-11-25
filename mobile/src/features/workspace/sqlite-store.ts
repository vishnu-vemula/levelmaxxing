import type { WorkspaceSection } from '@levelmaxing/contracts';
import { openCipher } from '../../platform/sqlcipher.ts';
import { decodeReplica, emptyReplica, type WorkspaceStore } from './model.ts';

export async function openWorkspaceStore(scope: string): Promise<WorkspaceStore> {
  const db = await openCipher('workspace', scope);
  try {
    await db.execAsync('CREATE TABLE IF NOT EXISTS workspace_replica (section TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
  return {
    async read(section: WorkspaceSection) {
      const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM workspace_replica WHERE section = ?', section);
      if (!row) return emptyReplica;
      const replica = decodeReplica(section, JSON.parse(row.payload));
      if (!replica) throw new Error('The saved workspace could not be read.');
      return replica;
    },
    async write(section, replica) {
      await db.runAsync(
        'INSERT INTO workspace_replica (section, payload) VALUES (?, ?) ON CONFLICT(section) DO UPDATE SET payload = excluded.payload',
        section, JSON.stringify(replica),
      );
    },
    close: () => db.closeAsync(),
  };
}
