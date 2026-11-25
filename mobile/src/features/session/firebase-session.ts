import { isUuid, objectValue } from '@levelmaxing/contracts';
import { ApiFailure } from '../../platform/api.ts';

export type Session = { accountId: string; accessToken: string | null };
export type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type FirebaseUser = { uid: string; getIdToken(): Promise<string> };
type Inputs = {
  user: FirebaseUser;
  storage: AuthStorage;
  verifiedAccount: (token: string, signal: AbortSignal) => Promise<string>;
  currentUser: () => FirebaseUser | null;
  signal: AbortSignal;
};

function firebaseErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

const disabledFirebaseUser = new Set(['auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-not-found']);

export function interruption(): Error {
  return Object.assign(new Error('Account changed.'), { name: 'AbortError' });
}

export function firebaseVaultScope(projectId: string, appId: string, api: string): string {
  return JSON.stringify(['firebase', projectId, appId, api]);
}

export async function resolveFirebaseSession({ user, storage, verifiedAccount, currentUser, signal }: Inputs): Promise<Session | null> {
  if (!user.uid || [...user.uid].length > 128) return null;
  const key = `firebase-account.v1.${JSON.stringify(user.uid)}`;
  const checkCurrent = () => {
    if (signal.aborted || currentUser() !== user) throw interruption();
  };
  checkCurrent();
  const cached = await storage.getItem(key);
  checkCurrent();
  const binding = cached && objectValue(JSON.parse(cached));
  if (cached !== null && (!binding || !isUuid(binding.accountId) || typeof binding.offlineAllowed !== 'boolean')) {
    throw new Error('The saved account binding could not be read.');
  }
  const account = binding && typeof binding.accountId === 'string' ? binding.accountId : undefined;
  const offline = (): Session | null => account && binding && binding.offlineAllowed
    ? { accountId: account, accessToken: null }
    : null;
  const deny = async () => {
    checkCurrent();
    if (account && binding && binding.offlineAllowed) {
      await storage.setItem(key, JSON.stringify({ accountId: account, offlineAllowed: false }));
      checkCurrent();
    }
    return null;
  };

  let accessToken: string;
  try {
    accessToken = await user.getIdToken();
  } catch (error) {
    checkCurrent();
    const code = firebaseErrorCode(error);
    if (code === 'auth/network-request-failed') return offline();
    if (typeof code === 'string' && disabledFirebaseUser.has(code)) return deny();
    throw error;
  }
  checkCurrent();

  let accountId: string;
  try {
    accountId = await verifiedAccount(accessToken, signal);
  } catch (error) {
    checkCurrent();
    if (error instanceof ApiFailure) {
      if (error.status === 401 || error.status === 403) return deny();
      if (error.status >= 500 && error.status <= 599 && error.code !== 'response_invalid') return offline();
    }
    if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')) return offline();
    throw error;
  }
  checkCurrent();

  if (!isUuid(accountId)) throw new Error('The verified account binding did not match.');
  // A confirmed mismatch keeps the original data address and locks offline access.
  if (account && account !== accountId) {
    await deny();
    throw new Error('The verified account binding did not match.');
  }
  if (!binding || !binding.offlineAllowed) {
    await storage.setItem(key, JSON.stringify({ accountId, offlineAllowed: true }));
  }
  checkCurrent();
  return { accountId, accessToken };
}
