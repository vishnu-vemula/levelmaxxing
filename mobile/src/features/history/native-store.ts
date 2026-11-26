import type { WorkspaceHistoryKind } from '@levelmaxing/contracts';
import { nativeStorage, sha256 } from '../../platform/native-storage.ts';
import { createPendingHistoryStore } from './pending.ts';

export function createNativeHistoryStore(scope: string, kind: WorkspaceHistoryKind) {
  let id: Promise<string> | undefined;
  async function key() {
    id ??= sha256(JSON.stringify([scope, kind]))
      .then((digest) => `lm.history-move.${digest}`)
      .catch((error: unknown) => {
        id = undefined;
        throw error;
      });
    return id;
  }
  return createPendingHistoryStore(key, kind, {
    read: (key) => nativeStorage().readSecret(key),
    write: (key, value) => nativeStorage().writeSecret(key, value),
    remove: (key) => nativeStorage().deleteSecret(key),
  });
}
