import 'react-native-url-polyfill/auto';
import { getApps, initializeApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  initializeAuth,
  onIdTokenChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Persistence,
  type User,
} from 'firebase/auth';
import { isUuid, objectValue } from '@levelmaxing/contracts';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createApiRequester } from '../../platform/api.ts';
import { openCipher } from '../../platform/sqlcipher.ts';
import { resolveAccountSession } from './api.ts';
import { firebaseVaultScope, interruption, resolveFirebaseSession, type AuthStorage, type Session } from './firebase-session.ts';

export type { Session } from './firebase-session.ts';
export class AccountSetupPending extends Error {}
export type AuthEnvironment = { api: string } & (
  | { mode: 'local' }
  | { mode: 'cloud'; firebase: { apiKey: string; projectId: string; appId: string }; publishableKey: string }
);

function safeURL(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.username || url.password || url.search || url.hash ? null : url;
  } catch {
    return null;
  }
}

export function readEnvironment(): AuthEnvironment | null {
  const api = safeURL(process.env.EXPO_PUBLIC_API_URL);
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!api) return null;
  const base = api.href.endsWith('/') ? api.href : `${api.href}/`;
  const loopback = ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(api.hostname);
  if (__DEV__ && process.env.EXPO_PUBLIC_ENABLE_LOCAL_AUTH === '1' && loopback &&
      (api.protocol === 'http:' || api.protocol === 'https:')) {
    return { api: base, mode: 'local' };
  }
  const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID;
  if (api.protocol === 'https:' && !loopback && publishableKey?.startsWith('sb_publishable_') &&
    apiKey && /^[A-Za-z0-9_-]+$/.test(apiKey) && projectId && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) &&
    appId && /^1:\d+:(?:web|android|ios):[A-Za-z0-9]+$/.test(appId)) {
    return { api: base, mode: 'cloud', firebase: { apiKey, projectId, appId }, publishableKey };
  }
  return null;
}

export interface AuthGateway {
  load(): Promise<Session | null>;
  signIn(fields: { email: string; password: string; token: string }): Promise<Session>;
  confirmIdentity?(password: string): Promise<Session>;
  createAccount?(fields: { email: string; password: string }): Promise<Session>;
  resetPassword?(email: string): Promise<void>;
  signOut(): Promise<void>;
  subscribe(callback: (session: Session | null) => void, unavailable: () => void): () => void;
  foreground(enabled: boolean): void;
}

const vaults = new Map<string, Promise<SQLiteDatabase>>();
function authStorage(scope: string): AuthStorage {
  async function db(): Promise<SQLiteDatabase> {
    let flight = vaults.get(scope);
    if (!flight) {
      flight = (async () => {
        const connection = await openCipher('session', scope);
        try {
          await connection.execAsync('CREATE TABLE IF NOT EXISTS secure_storage (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
          return connection;
        } catch (error) {
          await connection.closeAsync();
          throw error;
        }
      })();
      vaults.set(scope, flight);
    }
    try {
      return await flight;
    } catch (error) {
      vaults.delete(scope);
      throw error;
    }
  }
  return {
    async getItem(key: string): Promise<string | null> {
      return (await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM secure_storage WHERE id = ?', [key]))?.value ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      await (await db()).runAsync(
        'INSERT INTO secure_storage (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
        [key, value],
      );
    },
    async removeItem(key: string): Promise<void> {
      await (await db()).runAsync('DELETE FROM secure_storage WHERE id = ?', [key]);
    },
  };
}

function nativePersistence(storage: AuthStorage): Persistence {
  // Firebase's shared declarations omit this export, which Metro loads from the React Native entry.
  const native = firebaseAuth as typeof firebaseAuth & { getReactNativePersistence?: (source: AuthStorage) => Persistence };
  if (!native.getReactNativePersistence) throw new Error('Firebase React Native persistence is unavailable.');
  return native.getReactNativePersistence(storage);
}

export function createAuth(environment: AuthEnvironment): AuthGateway {
  const scope = environment.mode === 'local'
    ? `development|${environment.api}`
    : firebaseVaultScope(environment.firebase.projectId, environment.firebase.appId, environment.api);
  const storage = authStorage(scope);
  if (environment.mode === 'local') {
    return {
      async load() {
        const raw = await storage.getItem('local-session');
        if (!raw) return null;
        const value = objectValue(JSON.parse(raw));
        return isUuid(value?.accountId) && typeof value.accessToken === 'string'
          ? { accountId: value.accountId, accessToken: value.accessToken }
          : null;
      },
      async signIn({ token }) {
        const accessToken = token.trim();
        if (accessToken.length < 16 || accessToken.length > 8192 || /\s/.test(accessToken)) throw new Error('Invalid token');
        const { accountId } = await resolveAccountSession(createApiRequester(environment.api, accessToken));
        const session = { accountId, accessToken };
        await storage.setItem('local-session', JSON.stringify(session));
        return session;
      },
      signOut: () => storage.removeItem('local-session'),
      subscribe: () => () => undefined,
      foreground: () => undefined,
    };
  }

  const { api, firebase, publishableKey } = environment;
  const name = `levelmaxing-mobile:${scope}`;
  const existing = getApps().find(app => app.name === name);
  const client = existing ? getAuth(existing) : initializeAuth(initializeApp(firebase, name), {
    persistence: nativePersistence(storage),
  });

  let flight: { user: User; controller: AbortController; task: Promise<Session | null> } | undefined;
  let observer: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let signingOut = false;
  let establishedUser: User | null = null;

  function stopFlight() {
    flight?.controller.abort();
    flight = undefined;
  }

  async function resolve(user: User | null): Promise<Session | null> {
    if (signingOut) return null;
    if (user !== client.currentUser) throw interruption();
    if (user && flight?.user === user) return flight.task;
    stopFlight();
    if (!user) return null;
    const controller = new AbortController();
    const task = resolveFirebaseSession({
      user,
      storage,
      currentUser: () => client.currentUser,
      signal: controller.signal,
      verifiedAccount: async (token, signal) => (
        await resolveAccountSession(createApiRequester(api, token, publishableKey), signal)
      ).accountId,
    });
    const operation = { user, controller, task };
    flight = operation;
    try {
      return await task;
    } finally {
      if (flight === operation) flight = undefined;
    }
  }

  async function establish(user: User): Promise<Session> {
    const session = await resolve(user);
    if (signingOut || user !== client.currentUser) throw interruption();
    if (!session) throw new Error('No verified Levelmaxing account.');
    establishedUser = user;
    return session;
  }

  return {
    async load() {
      await client.authStateReady();
      const user = client.currentUser;
      const session = await resolve(user);
      if (signingOut || user !== client.currentUser) throw interruption();
      establishedUser = session ? user : null;
      return session;
    },
    async signIn({ email, password }) {
      const { user } = await signInWithEmailAndPassword(client, email.trim(), password);
      return establish(user);
    },
    async confirmIdentity(password) {
      const user = client.currentUser;
      const email = user?.email;
      if (!user || !email || signingOut || user !== establishedUser) throw new Error('Sign in before confirming your identity.');
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
      const accessToken = await user.getIdToken(true);
      if (signingOut || client.currentUser !== user || establishedUser !== user) throw interruption();
      const { accountId } = await resolveAccountSession(createApiRequester(api, accessToken, publishableKey));
      if (signingOut || client.currentUser !== user || establishedUser !== user) throw interruption();
      return { accountId, accessToken };
    },
    async createAccount({ email, password }) {
      const { user } = await createUserWithEmailAndPassword(client, email.trim(), password);
      try {
        await user.getIdToken(true);
        return await establish(user);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        throw new AccountSetupPending('The Firebase account was created but its Levelmaxing session could not be verified.', { cause: error });
      }
    },
    resetPassword(email) {
      return sendPasswordResetEmail(client, email.trim());
    },
    async signOut() {
      signingOut = true;
      stopFlight();
      try {
        await firebaseSignOut(client);
        establishedUser = null;
      } finally {
        signingOut = false;
      }
    },
    subscribe(callback, unavailable) {
      let active = true;
      let revision = 0;
      const publish = () => {
        const event = ++revision;
        const user = client.currentUser;
        // A token refresh for the same user keeps the current data mounted. An
        // account switch closes that scope immediately while the new one binds.
        if (flight && user !== flight.user) stopFlight();
        if (establishedUser && establishedUser !== user) {
          establishedUser = null;
          callback(null);
        }
        void resolve(user).then(session => {
          if (!active || event !== revision || user !== client.currentUser) return;
          establishedUser = session ? user : null;
          callback(session);
        }, error => {
          if (active && event === revision && user === client.currentUser &&
            !(error instanceof Error && error.name === 'AbortError')) {
            establishedUser = null;
            unavailable();
          }
        });
      };
      observer = () => {
        if (signingOut) return;
        void client.authStateReady().then(() => { if (active && !signingOut) publish(); }, () => {
          if (active && !signingOut) unavailable();
        });
      };
      const unsubscribe = onIdTokenChanged(client, publish);
      return () => {
        active = false;
        observer = undefined;
        stopFlight();
        unsubscribe();
      };
    },
    foreground(enabled) {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (!enabled) return;
      observer?.();
      timer = setInterval(() => observer?.(), 60_000);
    },
  };
}
