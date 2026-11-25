import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfiguration } from './config.ts';

test('only an explicit local development build offers local credentials', () => {
  assert.equal(readConfiguration({ DEV: true, VITE_LEVELMAXING_AUTH_MODE: 'local' }).identity.kind, 'local');
  assert.equal(readConfiguration({ DEV: false, VITE_LEVELMAXING_AUTH_MODE: 'local' }).identity.kind, 'unavailable');
  assert.equal(readConfiguration({ DEV: true }).identity.kind, 'unavailable');
});

test('the API base is restricted to an unambiguous same-origin path', () => {
  for (const invalid of ['//third-party.example', '/api/../settings', '/api/%2e%2e', '/api//v1', '/api\\app', 'https://api.example.com', '/api?x=1']) {
    const config = readConfiguration({ DEV: true, VITE_LEVELMAXING_AUTH_MODE: 'local', VITE_LEVELMAXING_API_BASE: invalid });
    assert.equal(config.apiBase, '', invalid);
    assert.equal(config.identity.kind, 'unavailable', invalid);
  }
  assert.equal(readConfiguration({ VITE_LEVELMAXING_API_BASE: '/gateway/admin/' }).apiBase, '/gateway/admin');
});

test('hosted identity accepts Firebase public web configuration', () => {
  const valid = {
    VITE_FIREBASE_PROJECT_ID: 'levelmaxing-test',
    VITE_FIREBASE_API_KEY: 'AIza' + 'x'.repeat(35),
    VITE_FIREBASE_APP_ID: '1:123456:web:abc123',
  };
  assert.deepEqual(readConfiguration(valid), {
    apiBase: '/api',
    identity: {
      kind: 'firebase',
      projectId: valid.VITE_FIREBASE_PROJECT_ID,
      apiKey: valid.VITE_FIREBASE_API_KEY,
      authDomain: 'levelmaxing-test.firebaseapp.com',
      appId: valid.VITE_FIREBASE_APP_ID,
    },
  });
  assert.equal(readConfiguration({ ...valid, VITE_FIREBASE_AUTH_DOMAIN: 'auth.example.com' }).identity.kind, 'firebase');

  for (const invalid of [
    { VITE_LEVELMAXING_AUTH_MODE: 'supabase' },
    { VITE_FIREBASE_PROJECT_ID: '' },
    { VITE_FIREBASE_API_KEY: 'sb_secret_fixture' },
    { VITE_FIREBASE_APP_ID: '1:123456:android:abc123' },
    { VITE_FIREBASE_AUTH_DOMAIN: 'https://auth.example.com' },
    { VITE_FIREBASE_AUTH_DOMAIN: 'user@auth.example.com' },
    { VITE_FIREBASE_AUTH_DOMAIN: 'auth.example.com/auth' },
  ]) {
    assert.equal(readConfiguration({ ...valid, ...invalid }).identity.kind, 'unavailable');
  }
});
