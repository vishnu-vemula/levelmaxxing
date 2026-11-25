import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOperatorIdentity } from './operatorIdentity.ts';

const credentials = { email: 'operator@example.invalid', password: 'local fixture' };

function session(token: string, signInSecondFactor: string | null) {
  return { getIdTokenResult: async () => ({ token, signInSecondFactor }) };
}

test('only the completed TOTP challenge yields the Firebase ID token for backend authorization', async () => {
  let assertions = 0;
  const identity = createOperatorIdentity({
    async signIn() {
      return {
        kind: 'challenge',
        factors: [{ id: 'registered-factor', label: 'Authenticator' }],
        async resolve(factor, code) {
          assert.equal(factor, 'registered-factor');
          assertions += 1;
          if (code !== '123456') throw new Error('masked provider error');
          return session('totp-fixture', 'totp');
        },
      };
    },
    signOut: async () => {},
    observe: () => () => {},
  });

  assert.deepEqual(await identity.signIn(credentials), {
    kind: 'challenge', factors: [{ id: 'registered-factor', label: 'Authenticator' }],
  });
  assert.deepEqual(await identity.verify('unregistered-factor', '123456'), {
    kind: 'failed', message: 'Verification failed. Enter a current authenticator code.',
  });
  assert.equal(assertions, 0);
  assert.equal((await identity.verify('registered-factor', '000000')).kind, 'failed');
  assert.deepEqual(await identity.verify('registered-factor', '123456'), { kind: 'token', value: 'totp-fixture' });
  assert.equal((await identity.verify('registered-factor', '123456')).kind, 'failed');
  assert.equal(assertions, 2);
});

test('single-factor, unsupported-factor and provider-failed sign-ins never return a token', async () => {
  for (const secondFactor of [null, 'phone']) {
    const identity = createOperatorIdentity({
      signIn: async () => ({ kind: 'session', session: session('weak-fixture', secondFactor) }),
      signOut: async () => {},
      observe: () => () => {},
    });
    assert.deepEqual(await identity.signIn(credentials), { kind: 'enrollment-required' });
  }

  const unavailable = createOperatorIdentity({
    async signIn() { throw new Error('masked provider error'); },
    signOut: async () => {},
    observe: () => () => {},
  });
  assert.deepEqual(await unavailable.signIn(credentials), {
    kind: 'failed', message: 'Sign-in failed. Check your credentials and try again.',
  });
});

test('sign-out clears the SDK session after a pending assertion finishes and suppresses its token', async () => {
  let finish = () => {};
  const waitForAssertion = new Promise<void>((resolve) => { finish = resolve; });
  let signedOut = false;
  const identity = createOperatorIdentity({
    async signIn() {
      return {
        kind: 'challenge',
        factors: [{ id: 'factor', label: 'Authenticator' }],
        async resolve() {
          await waitForAssertion;
          assert.equal(signedOut, false);
          return session('late-fixture', 'totp');
        },
      };
    },
    async signOut() { signedOut = true; },
    observe: () => () => {},
  });
  await identity.signIn(credentials);
  const verification = identity.verify('factor', '123456');
  const cancelling = identity.signOut();
  assert.equal(signedOut, false);
  finish();
  assert.equal((await verification).kind, 'failed');
  await cancelling;
  assert.equal(signedOut, true);
  assert.equal((await identity.verify('factor', '123456')).kind, 'failed');
});

test('token change rechecks access and loss of TOTP invalidates the console session', async () => {
  let announce: (current: ReturnType<typeof session> | null) => void = () => {};
  const identity = createOperatorIdentity({
    signIn: async () => ({ kind: 'session', session: session('original-fixture', 'totp') }),
    signOut: async () => {},
    observe(listener) {
      announce = listener;
      announce(null);
      return () => { announce = () => {}; };
    },
  });
  const changes: unknown[] = [];
  const stop = identity.listen((change) => changes.push(change));
  assert.deepEqual(changes, []);
  await identity.signIn(credentials);
  announce(session('original-fixture', 'totp'));
  announce(session('updated-fixture', 'totp'));
  await Promise.resolve();
  assert.deepEqual(changes, [{ kind: 'refreshed', token: 'updated-fixture' }]);

  announce(session('weak-fixture', 'phone'));
  await Promise.resolve();
  assert.deepEqual(changes, [
    { kind: 'refreshed', token: 'updated-fixture' },
    { kind: 'signed-out' },
  ]);
  stop();
});
