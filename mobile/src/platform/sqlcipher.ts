import { requireOptionalNativeModule } from 'expo';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { digestStringAsync, CryptoDigestAlgorithm, getRandomBytesAsync } from 'expo-crypto';

const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const keyCreation = new Map<string, Promise<string>>();

async function getKey(id: string): Promise<string> {
  const existing = await SecureStore.getItemAsync(id, secureOptions);
  if (existing !== null) return existing;
  const random = await getRandomBytesAsync(32);
  const key = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(id, key, secureOptions);
  return key;
}

async function installationKey(id: string): Promise<string> {
  const pending = keyCreation.get(id);
  if (pending) return pending;
  const created = getKey(id);
  keyCreation.set(id, created);
  try {
    return await created;
  } finally {
    keyCreation.delete(id);
  }
}

export async function openCipher(store: 'session' | 'progress' | 'workspace', scope: string): Promise<SQLite.SQLiteDatabase> {
  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, scope);
  const namespace = `lm.${store}.${hash}`;
  const storage = requireOptionalNativeModule<{ directory(): Promise<string> }>('LevelmaxingPrivateStorage');
  if (!storage) throw new Error('This build requires backup-excluded native storage.');
  const directory = await storage.directory();
  const db = await SQLite.openDatabaseAsync(`${namespace}.sqlite`, { useNewConnection: true }, directory);
  try {
    const encryption = await db.getFirstAsync<Record<string, string>>('PRAGMA cipher_version');
    if (!encryption || !Object.values(encryption).some(Boolean)) {
      throw new Error('This build requires SQLCipher.');
    }
    const key = await installationKey(namespace);
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid device encryption key.');
    // SQLCipher requires a literal for PRAGMA key. The hex key is OS-generated and validated above.
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    await db.getFirstAsync('SELECT name FROM sqlite_master LIMIT 1');
    return db;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}
