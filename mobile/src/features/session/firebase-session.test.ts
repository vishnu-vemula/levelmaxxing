import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiFailure } from '../../platform/api.ts';
import { firebaseVaultScope, resolveFirebaseSession, type AuthStorage } from './firebase-session.ts';

const accountA = '8cd6b47c-fbe5-4c36-8222-4f79bf3e2df1';
const accountB = '97af4659-37e5-4c42-b1da-b625ec59879a';
const userA = { uid: 'Firebase_opaque:account.A', async getIdToken() { return 'fixture.a'; } };
const userB = { uid: 'another-Firebase-user', async getIdToken() { return 'fixture.b'; } };

function setup() {
  const values = new Map<string, string>();
  const storage: AuthStorage = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
  const controller = new AbortController();
  let current: typeof userA | null = userA;
  const verify = async (token: string): Promise<string> => token === 'fixture.a' ? accountA : accountB;
  const resolve = (verifiedAccount = verify) => {
    assert.ok(current);
    return resolveFirebaseSession({ user: current, currentUser: () => current, storage, verifiedAccount, signal: controller.signal });
  };
  const disconnected = async () => { throw new TypeError('Network unavailable'); };
  return { values, controller, resolve, disconnected, select: (user: typeof userA | null) => { current = user; } };
}

test('a Firebase UID is bound to the UUID resolved from the signed-in token', async () => {
  const { resolve, values } = setup();
  assert.deepEqual(await resolve(async token => {
    assert.equal(token, 'fixture.a');
    return accountA;
  }), { accountId: accountA, accessToken: 'fixture.a' });
  assert.deepEqual([...values.values()].map(value => JSON.parse(value)), [{ accountId: accountA, offlineAllowed: true }]);
});

test('an offline cold start can open local data only for the previously bound Firebase UID', async () => {
  const { resolve, disconnected, select, values } = setup();
  assert.equal(await resolve(disconnected), null);
  assert.equal(values.size, 0);
  await resolve();
  assert.deepEqual(await resolve(disconnected), { accountId: accountA, accessToken: null });
  select(userB);
  assert.equal(await resolve(disconnected), null);
  assert.deepEqual(await resolve(), { accountId: accountB, accessToken: 'fixture.b' });
  assert.deepEqual(await resolve(disconnected), { accountId: accountB, accessToken: null });
});

test('a definitive backend denial locks offline access and preserves the canonical binding', async () => {
  const { resolve, disconnected } = setup();
  await resolve();
  assert.equal(await resolve(async () => { throw new ApiFailure(403, 'account_disabled'); }), null);
  assert.equal(await resolve(disconnected), null);
  await assert.rejects(resolve(async () => accountB), /binding did not match/);
  assert.equal(await resolve(disconnected), null);
  assert.deepEqual(await resolve(), { accountId: accountA, accessToken: 'fixture.a' });
});

test('an online account mismatch prevents the previous binding from unlocking on network failure', async () => {
  const { resolve, disconnected, values } = setup();
  await resolve();
  assert.deepEqual(await resolve(disconnected), { accountId: accountA, accessToken: null });

  await assert.rejects(resolve(async () => accountB), /binding did not match/);
  assert.deepEqual([...values.values()].map(value => JSON.parse(value)), [{ accountId: accountA, offlineAllowed: false }]);
  assert.equal(await resolve(disconnected), null);

  assert.deepEqual(await resolve(), { accountId: accountA, accessToken: 'fixture.a' });
  assert.deepEqual(await resolve(disconnected), { accountId: accountA, accessToken: null });
});

test('a malformed backend response never opens cached data', async () => {
  const { resolve } = setup();
  await resolve();
  await assert.rejects(resolve(async () => { throw new ApiFailure(502, 'response_invalid'); }), /response_invalid/);
  await assert.rejects(resolve(async () => 'opaque-Firebase-UID'), /binding did not match/);
});

test('provider network loss can open a prior local scope, while provider revocation locks it', async () => {
  const { resolve, disconnected, select } = setup();
  await resolve();
  const rejected = (code: string) => ({ ...userA, async getIdToken() { throw Object.assign(new Error('Firebase request failed'), { code }); } });
  select(rejected('auth/network-request-failed'));
  assert.deepEqual(await resolve(), { accountId: accountA, accessToken: null });
  select(rejected('auth/user-disabled'));
  assert.equal(await resolve(), null);
  select(userA);
  assert.equal(await resolve(disconnected), null);
});

test('a delayed response for the old Firebase user cannot bind or replace the new account', async () => {
  const { resolve, values, disconnected, select } = setup();
  const waiting = Promise.withResolvers<void>();
  const backend = Promise.withResolvers<string>();
  const earlier = resolve(async () => {
    waiting.resolve();
    return backend.promise;
  });
  await waiting.promise;
  select(userB);
  await resolve();
  backend.resolve(accountA);
  await assert.rejects(earlier, { name: 'AbortError' });
  assert.equal(values.size, 1);
  assert.deepEqual(await resolve(disconnected), { accountId: accountB, accessToken: null });
});

test('cancelling the binding rejects a delayed server result before it can update local storage', async () => {
  const { resolve, controller, values } = setup();
  const waiting = Promise.withResolvers<void>();
  const backend = Promise.withResolvers<string>();
  const earlier = resolve(async () => {
    waiting.resolve();
    return backend.promise;
  });
  await waiting.promise;
  controller.abort();
  backend.resolve(accountA);
  await assert.rejects(earlier, { name: 'AbortError' });
  assert.equal(values.size, 0);
});

test('different Firebase projects, app registrations, and API bases have distinct encrypted vault scopes', () => {
  const vaults = [
    firebaseVaultScope('project-1', 'app-1', 'https://levelmaxing.example/api/'),
    firebaseVaultScope('project-2', 'app-1', 'https://levelmaxing.example/api/'),
    firebaseVaultScope('project-1', 'app-2', 'https://levelmaxing.example/api/'),
    firebaseVaultScope('project-1', 'app-1', 'https://staging.levelmaxing.example/api/'),
  ];
  assert.equal(new Set(vaults).size, 4);
});
