import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseProblemDetails, parsePullResponse} from '@levelmaxing/contracts';
import {createApp} from '../src/app.ts';
import {createCloudApp, readCloudConfig} from '../src/cloud.ts';
import {createCursorCodec, createMemorySyncStore} from '../src/features/sync/index.ts';

const firebaseProjectId = 'levelmaxing-fixture';
const supabaseUrl = 'https://sandbox.supabase.example';
const cursorSecret = 'fixture_cursor_material_at_least_32_bytes';
const requiredEnvironment = {
  FIREBASE_PROJECT_ID: firebaseProjectId,
  SUPABASE_URL: supabaseUrl,
  LEVELMAXING_CURSOR_SECRET: cursorSecret,
};

const reader = (env: Record<string, string | undefined>) => (name: string) => env[name];

test('both runtimes use the same cloud configuration with their existing key preference', () => {
  const env = reader({
    ...requiredEnvironment,
    LEVELMAXING_PUBLISHABLE_KEY: 'sb_publishable_edge_fixture',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_node_fixture',
    SUPABASE_ANON_KEY: 'fixture-fallback',
    LEVELMAXING_ALLOWED_ORIGIN: 'https://admin.example',
  });
  const config = {firebaseProjectId, supabaseUrl, cursorSecret, allowedOrigin: 'https://admin.example'};
  assert.deepEqual(readCloudConfig(env, 'node'), {...config, publishableKey: 'sb_publishable_node_fixture'});
  assert.deepEqual(readCloudConfig(env, 'edge'), {...config, publishableKey: 'sb_publishable_edge_fixture'});

  assert.deepEqual(
    readCloudConfig(reader({...requiredEnvironment, LEVELMAXING_PUBLISHABLE_KEY: 'sb_publishable_edge_fixture', SUPABASE_ANON_KEY: 'fixture-fallback'}), 'node'),
    {firebaseProjectId, supabaseUrl, cursorSecret, publishableKey: 'fixture-fallback'},
  );
  assert.deepEqual(
    readCloudConfig(reader({...requiredEnvironment, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_node_fixture', SUPABASE_ANON_KEY: 'fixture-fallback'}), 'edge'),
    {firebaseProjectId, supabaseUrl, cursorSecret, publishableKey: 'fixture-fallback'},
  );
});

test('cloud startup fails closed on missing or invalid configuration', () => {
  for (const runtime of ['node', 'edge'] as const) {
    assert.throws(
      () => readCloudConfig(reader(requiredEnvironment), runtime),
      /Missing SUPABASE_ANON_KEY/,
    );
  }
  const valid = {...requiredEnvironment, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture'};
  for (const missing of Object.keys(requiredEnvironment)) {
    assert.throws(
      () => readCloudConfig(reader({...valid, [missing]: undefined}), 'node'),
      new RegExp('Missing ' + missing),
    );
  }
  const config = (patch: Record<string, string>) => readCloudConfig(reader({...valid, ...patch}), 'node');
  assert.throws(
    () => createCloudApp(config({SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_ANON_KEY: 'fixture-fallback'})),
    /publishable key/,
  );
  assert.throws(() => createCloudApp(config({SUPABASE_PUBLISHABLE_KEY: 'sb_secret_fixture'})), /publishable key/);
  assert.throws(() => createCloudApp(config({SUPABASE_URL: 'invalid-url'})), /SUPABASE_URL must be an HTTPS origin/);
  assert.throws(() => createCloudApp(config({LEVELMAXING_CURSOR_SECRET: 'short'})), /at least 32 bytes/);
  assert.throws(() => createCloudApp(config({LEVELMAXING_ALLOWED_ORIGIN: 'invalid-origin'})), /Set the allowed origin/);
});

test('the injected cursor codec controls authenticated pull expiry', async () => {
  const accountId = '99999999-9999-4999-8999-999999999999';
  const epoch = 'fixture_epoch';
  let now = Date.UTC(2026, 10, 23);
  const monthMs = 30 * 24 * 60 * 60 * 1_000;
  const codec = createCursorCodec(cursorSecret, () => now);
  const app = createApp({
    verifyIdentity: async token => token === 'fixture-participant'
      ? {accountId, role: 'participant', assurance: 'aal1'}
      : undefined,
    syncStore: createMemorySyncStore(() => epoch),
    cursorCodec: codec,
  });
  const path = 'https://api.example/v1/sync/pull';
  const request = (url: string) => app(new Request(url, {headers: {authorization: 'Bearer fixture-participant'}}));
  const initial = await request(path);
  assert.equal(initial.status, 200);
  const page = parsePullResponse(await initial.json());
  assert.ok(page);
  assert.deepEqual(await codec.decode(accountId, page.nextCursor), {epoch, after: '0'});

  const continued = path + '?' + new URLSearchParams({cursor: page.nextCursor});
  now += monthMs - 1;
  assert.equal((await request(continued)).status, 200);
  now++;
  const expired = await request(continued);
  assert.equal(expired.status, 410);
  assert.equal(parseProblemDetails(await expired.json())?.code, 'cursor_expired');
});
