import type { WorkspaceHistoryKind } from '@levelmaxing/contracts';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createPendingHistoryStore } from './pending.ts';

const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export function createNativeHistoryStore(scope: string, kind: WorkspaceHistoryKind) {
  let id: Promise<string> | undefined;
  async function key() {
    id ??= digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([scope, kind]))
      .then((digest) => `lm.history-move.${digest}`)
      .catch((error: unknown) => {
        id = undefined;
        throw error;
      });
    return id;
  }
  return createPendingHistoryStore(key, kind, {
    read: (key) => SecureStore.getItemAsync(key, options),
    write: (key, value) => SecureStore.setItemAsync(key, value, options),
    remove: (key) => SecureStore.deleteItemAsync(key, options),
  });
}
