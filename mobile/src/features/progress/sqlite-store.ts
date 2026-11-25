import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { WeightMeasurement } from '@levelmaxing/contracts';
import { openCipher } from '../../platform/sqlcipher.ts';
import type { Entry, PendingMeasurement, ProgressStore } from './sync.ts';

type DeviceRow = {
  deviceId: string;
  epoch: string | null;
  generation: number | null;
  cursor: string | null;
  nextSequence: number;
};

async function readDevice(db: SQLiteDatabase): Promise<DeviceRow> {
  const row = await db.getFirstAsync<DeviceRow>(
    'SELECT device_id AS deviceId, epoch, generation, cursor, next_seq AS nextSequence FROM sync_state WHERE singleton = 1',
  );
  if (!row) throw new Error('Missing device state');
  return row;
}

async function saveConfirmed(db: SQLiteDatabase, id: string, weight: WeightMeasurement): Promise<void> {
  await db.runAsync(
    'INSERT INTO weight_confirmed (id, grams, day) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING',
    [id, weight.grams, weight.measuredOn],
  );
}

export async function openProgressStore(scope: string): Promise<ProgressStore> {
  const db = await openCipher('progress', scope);
  try {
    await db.execAsync('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      const schema = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if (schema?.user_version !== 1) {
        if (schema?.user_version !== 0) throw new Error('Unsupported progress database version.');
      await db.execAsync(`
        CREATE TABLE sync_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          device_id TEXT NOT NULL,
          generation INTEGER,
          epoch TEXT,
          cursor TEXT,
          next_seq INTEGER NOT NULL CHECK (next_seq >= 1)
        );
        CREATE TABLE weight_confirmed (
          id TEXT PRIMARY KEY NOT NULL,
          grams INTEGER NOT NULL CHECK (grams BETWEEN 20000 AND 450000),
          day TEXT NOT NULL
        );
        CREATE INDEX recent_confirmed_weights ON weight_confirmed (day DESC, id DESC);
        CREATE TABLE weight_outbox (
          id TEXT PRIMARY KEY NOT NULL,
          grams INTEGER NOT NULL CHECK (grams BETWEEN 20000 AND 450000),
          day TEXT NOT NULL,
          written_at INTEGER NOT NULL,
          seq INTEGER UNIQUE,
          state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'review'))
        );
        CREATE INDEX recent_outbox_weights ON weight_outbox (day DESC, id DESC);
        CREATE INDEX next_weight_write ON weight_outbox (state, seq, written_at, id);
      `);
        await db.runAsync('INSERT INTO sync_state (singleton, device_id, next_seq) VALUES (1, ?, 1)', [randomUUID()]);
        await db.execAsync('PRAGMA user_version = 1;');
      }
      await db.execAsync('COMMIT');
    } catch (error) {
      await db.execAsync('ROLLBACK');
      throw error;
    }
  } catch (error) {
    await db.closeAsync();
    throw error;
  }

  // Each operation uses this keyed connection. No stray query can enter another operation's transaction.
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work);
    tail = next.catch(() => undefined);
    return next;
  }

  return {
    context: () => serial(async () => {
      const row = await readDevice(db);
      const device = row.generation !== null && row.epoch !== null
        ? { deviceId: row.deviceId, generation: row.generation, epoch: row.epoch }
        : null;
      return { deviceId: row.deviceId, device, cursor: row.cursor };
    }),
    bind: (device) => serial(async () => {
      await db.runAsync('UPDATE sync_state SET generation = ?, epoch = ? WHERE singleton = 1 AND device_id = ? AND epoch IS NULL',
        [device.generation, device.epoch, device.deviceId]);
    }),
    enqueue: (id, weight) => serial(async () => {
      await db.runAsync('INSERT INTO weight_outbox (id, grams, day, written_at) VALUES (?, ?, ?, ?)',
        [id, weight.grams, weight.measuredOn, Date.now()]);
    }),
    next: () => serial(async () => {
      let pending: PendingMeasurement | null = null;
      await db.withTransactionAsync(async () => {
        const row = await db.getFirstAsync<Omit<PendingMeasurement, 'seq'> & { seq: number | null }>(`
          SELECT id, grams, day AS measuredOn, seq FROM weight_outbox
          WHERE state = 'pending' ORDER BY seq IS NULL, seq, written_at, id LIMIT 1
        `);
        if (!row) return;
        const seq = row.seq ?? (await readDevice(db)).nextSequence;
        if (row.seq === null) {
          await db.runAsync('UPDATE weight_outbox SET seq = ? WHERE id = ?', [seq, row.id]);
          await db.runAsync('UPDATE sync_state SET next_seq = next_seq + 1 WHERE singleton = 1');
        }
        pending = { ...row, seq };
      });
      return pending;
    }),
    acknowledge: (entry) => serial(async () => {
      await db.withTransactionAsync(async () => {
        await saveConfirmed(db, entry.id, entry);
        await db.runAsync('DELETE FROM weight_outbox WHERE id = ? AND seq = ?', [entry.id, entry.seq]);
      });
    }),
    needsReview: (entry) => serial(async () => {
      await db.runAsync("UPDATE weight_outbox SET state = 'review' WHERE id = ? AND seq = ?", [entry.id, entry.seq]);
    }),
    apply: (page) => serial(async () => {
      await db.withTransactionAsync(async () => {
        for (const group of page.groups) {
          for (const entry of group.items) await saveConfirmed(db, entry.id, entry.view);
        }
        await db.runAsync('UPDATE sync_state SET cursor = ? WHERE singleton = 1', [page.nextCursor]);
      });
    }),
    recent: () => serial(async () => db.getAllAsync<Entry>(`
      SELECT id, grams, measuredOn, state FROM (
        SELECT id, grams, day AS measuredOn, state FROM weight_outbox
        UNION ALL
        SELECT base.id, base.grams, base.day AS measuredOn, 'confirmed' AS state FROM weight_confirmed base
        WHERE NOT EXISTS (SELECT 1 FROM weight_outbox pending WHERE pending.id = base.id)
      ) ORDER BY measuredOn DESC, id DESC LIMIT 30
    `)),
    close: () => serial(() => db.closeAsync()),
  };
}
