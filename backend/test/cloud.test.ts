import assert from 'node:assert/strict';
import {test} from 'node:test';
import {operationId, parseProblemDetails, parsePullResponse, type PushRequest} from '@levelmaxing/contracts';
import {exportJWK, generateKeyPair, SignJWT, type JWTPayload} from 'jose';
import {createCloudApp} from '../src/cloud.ts';

const supabaseUrl = 'https://sandbox.supabase.example';
const publishableKey = 'sb_publishable_fixture';
const firebaseProjectId = 'levelmaxing-fixture';
const issuer = 'https://securetoken.google.com/' + firebaseProjectId;
const secureTokenKeys = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const directory = '/rest/v1/rpc/levelmaxing_resolve_firebase_user_v1';
const firebaseUid = 'firebaseUID_28characters_demo';
const accountId = '99999999-9999-4999-8999-999999999999';
const deviceId = '77777777-7777-4777-8777-777777777777';
const entityId = '88888888-8888-4888-8888-888888888888';
const device = {deviceId, epoch: 'fixture_epoch', generation: 1};
const measurement = {grams: 81_125, measuredOn: '2026-11-23'};
const keyId = 'levelmaxing-fixture-kid';
const signingKeys = generateKeyPair('RS256', {extractable: true});

async function token(extra: JWTPayload = {}, signingKey?: CryptoKey, kid = keyId): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const payload: JWTPayload = {
    sub: firebaseUid,
    iss: issuer,
    aud: firebaseProjectId,
    iat: now - 10,
    auth_time: now - 20,
    exp: now + 3_590,
    role: 'authenticated',
    firebase: {sign_in_provider: 'password'},
    ...extra,
  };
  return new SignJWT(payload)
    .setProtectedHeader({alg: 'RS256', typ: 'JWT', ...(kid ? {kid} : {})})
    .sign(signingKey ?? (await signingKeys).privateKey);
}

async function jwks(headers?: HeadersInit) {
  const publicKey = await exportJWK((await signingKeys).publicKey);
  return Response.json({keys: [{...publicKey, kid: keyId, alg: 'RS256', use: 'sig'}]}, {headers});
}

function scaffold(upstream: typeof fetch, keys: () => Promise<Response> = jwks) {
  const app = createCloudApp({
    firebaseProjectId, supabaseUrl, publishableKey, cursorSecret: 'fixture_secret_with_at_least_32_bytes',
    fetch: (url, init) => {
      assert.equal(init?.redirect, 'error');
      if (String(url) === secureTokenKeys) {
        assert.equal(new Headers(init?.headers).has('authorization'), false);
        return keys();
      }
      assert.equal(new URL(String(url)).origin, supabaseUrl);
      return upstream(url, init);
    },
  });
  return (path: string, userToken: string, body?: unknown) => app(new Request('https://api.example' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {authorization: `Bearer ${userToken}`, ...(body === undefined ? {} : {'content-type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  }));
}

async function problem(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(parseProblemDetails(await response.json())?.code, code);
}

test('opaque Firebase UID resolves to the existing account UUID and the same JWT scopes each sync RPC', async () => {
  const jwt = await token();
  const input: PushRequest = {...device, ops: [{
    seq: 1, opId: operationId(deviceId, 1, 1), entityId, type: 'progress.weight.record',
    version: 1, expectedVersion: 0, payload: measurement,
  }]};
  const calls: string[] = [];
  let jwksLoads = 0;
  const command = input.ops[0]!;
  const request = scaffold(async (url, init) => {
    const target = new URL(String(url));
    calls.push(target.pathname);
    assert.equal(init?.method, 'POST');
    assert.ok(init?.signal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), `Bearer ${jwt}`);
    assert.equal(headers.get('apikey'), publishableKey);
    switch (target.pathname) {
      case directory:
        assert.deepEqual(JSON.parse(String(init.body)), {});
        return Response.json({accountId, role: 'participant'});
      case '/rest/v1/rpc/levelmaxing_register_device_v1':
        assert.deepEqual(JSON.parse(String(init.body)), {p_device_id: deviceId});
        return Response.json(device);
      case '/rest/v1/rpc/levelmaxing_push_v1':
        assert.deepEqual(JSON.parse(String(init.body)), {p_request: input});
        return Response.json({results: [{seq: command.seq, opId: command.opId, status: 'applied', revision: '1', entityVersion: 1}]});
      case '/rest/v1/rpc/levelmaxing_pull_v1':
        assert.deepEqual(JSON.parse(String(init.body)), {p_epoch: null, p_after: '0', p_high_water: null, p_limit: 5});
        return Response.json({epoch: device.epoch, highWater: '1', groups: [{revision: '1',
          items: [{id: entityId, type: 'progress.weight', version: 1, view: measurement}],
        }]});
      default: assert.fail('Unexpected upstream route');
    }
  }, async () => {
    jwksLoads += 1;
    return jwks();
  });
  const session = await request('/v1/session', jwt);
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), {accountId});
  const registration = await request('/v1/devices', jwt, {deviceId});
  assert.equal(registration.status, 200);
  assert.deepEqual(await registration.json(), device);
  assert.equal((await request('/v1/sync/push', jwt, input)).status, 200);
  const pull = await request('/v1/sync/pull?limit=5', jwt);
  assert.equal(pull.status, 200);
  const result = parsePullResponse(await pull.json());
  assert.equal(result?.groups[0]?.items[0]?.id, entityId);
  assert.equal(result?.hasMore, false);
  assert.equal(jwksLoads, 1);
  assert.deepEqual(calls, [
    directory,
    directory, '/rest/v1/rpc/levelmaxing_register_device_v1',
    directory, '/rest/v1/rpc/levelmaxing_push_v1',
    directory, '/rest/v1/rpc/levelmaxing_pull_v1',
  ]);
});

test('untrusted issuers, audiences, dates, claims, and signatures never reach the user directory', async () => {
  let directoryCalls = 0;
  const request = scaffold(async () => {
    directoryCalls += 1;
    return Response.json({accountId, role: 'operator'});
  });
  const alternateKey = (await generateKeyPair('RS256')).privateKey;
  const invalid = await Promise.all([
    token({iss: 'https://securetoken.google.com/other-firebase-project'}),
    token({aud: 'another-firebase-project'}),
    token({aud: [firebaseProjectId]}),
    token({sub: ''}),
    token({sub: 'u'.repeat(129)}),
    token({role: 'service_role'}),
    token({role: undefined}),
    token({firebase: {}}),
    token({firebase: {sign_in_provider: 'anonymous'}}),
    token({firebase: {sign_in_provider: 'custom'}}),
    token({firebase: {sign_in_provider: 'password', tenant: 'separate-tenant'}}),
    token({auth_time: Math.floor(Date.now() / 1_000) + 120}),
    token({exp: Math.floor(Date.now() / 1_000) - 5}),
    token({}, alternateKey),
    token({}, undefined, 'unknown-fixture-key'),
    token({}, undefined, ''),
  ]);
  for (const credential of [...invalid, 'not-a-jwt']) {
    await problem(await request('/v1/admin/access', credential), 401, 'unauthenticated');
  }
  assert.equal(directoryCalls, 0);
});

test('key revalidation follows the provider cache deadline', async () => {
  const jwt = await token();
  let jwksLoads = 0;
  const request = scaffold(async () => Response.json({accountId, role: 'participant'}), async () => {
    jwksLoads += 1;
    return jwks(jwksLoads === 1
      ? {'cache-control': 'public, max-age=60', age: '60'}
      : {'cache-control': 'public, max-age=300'});
  });
  assert.equal((await request('/v1/session', jwt)).status, 200);
  assert.equal((await request('/v1/session', jwt)).status, 200);
  assert.equal((await request('/v1/session', jwt)).status, 200);
  assert.equal(jwksLoads, 2);
});

test('the internal operator grant and a signed Firebase TOTP factor are both required', async () => {
  const totpClaim = {firebase: {sign_in_provider: 'password', sign_in_second_factor: 'totp'}};
  const enrolledOperator = await token(totpClaim);
  const regularOperator = await token({aal: 'aal2'});
  const nonTotpOperator = await token({firebase: {sign_in_provider: 'password', sign_in_second_factor: 'phone'}});
  const participant = await token({...totpClaim, levelmaxing_role: 'operator', sub: 'differentFirebaseUserUID'});
  let accountEnabled = true;
  const request = scaffold(async (url, init) => {
    assert.equal(new URL(String(url)).pathname, directory);
    const authorization = new Headers(init?.headers).get('authorization');
    if (!accountEnabled) return Response.json(null);
    return Response.json({accountId, role: authorization === `Bearer ${participant}` ? 'participant' : 'operator'});
  });
  for (const credential of [regularOperator, nonTotpOperator, participant]) {
    await problem(await request('/v1/admin/access', credential), 403, 'operator_step_up_required');
  }
  assert.deepEqual(await (await request('/v1/admin/access', enrolledOperator)).json(), {role: 'operator'});
  await problem(await request('/v1/session', enrolledOperator), 403, 'participant_required');
  accountEnabled = false;
  await problem(await request('/v1/admin/access', enrolledOperator), 401, 'unauthenticated');
});

test('JWKS or user-directory infrastructure failures are retryable without exposing provider details', async () => {
  const jwt = await token();
  const keysUnavailable = scaffold(async () => {
    assert.fail('The user directory must not be called if signing keys are unavailable.');
  }, async () => new Response('internal Google detail', {status: 503}));
  await problem(await keysUnavailable('/v1/session', jwt), 503, 'dependency_unavailable');

  const replies = [
    Response.json({message: 'misconfigured Firebase data API detail'}, {status: 401}),
    Response.json({accountId: firebaseUid, role: 'participant'}),
    Response.json({accountId, role: 'admin'}),
    Response.json(null),
  ];
  const request = scaffold(async url => {
    assert.equal(new URL(String(url)).pathname, directory);
    const response = replies.shift();
    assert.ok(response);
    return response;
  });
  const failure = await request('/v1/session', jwt);
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get('retry-after'), '2');
  assert.doesNotMatch(await failure.text(), /data API detail/);
  await problem(await request('/v1/session', jwt), 503, 'dependency_unavailable');
  await problem(await request('/v1/session', jwt), 503, 'dependency_unavailable');
  await problem(await request('/v1/session', jwt), 401, 'unauthenticated');
});

test('sync RPC errors and malformed success bodies retain their stable public problems', async () => {
  const jwt = await token();
  const replies = [
    Response.json({code: 'P0001', message: 'cursor_expired'}, {status: 400}),
    Response.json({code: '42501', message: 'participant_required'}, {status: 403}),
    Response.json({epoch: 'broken', highWater: '1', groups: []}),
    Response.json({message: 'internal database detail'}, {status: 500}),
  ];
  const request = scaffold(async url => {
    if (new URL(String(url)).pathname === directory) return Response.json({accountId, role: 'participant'});
    const response = replies.shift();
    assert.ok(response);
    return response;
  });
  await problem(await request('/v1/sync/pull', jwt), 410, 'cursor_expired');
  await problem(await request('/v1/sync/pull', jwt), 403, 'participant_required');
  await problem(await request('/v1/sync/pull', jwt), 503, 'dependency_unavailable');
  const availability = await request('/v1/sync/pull', jwt);
  assert.equal(availability.status, 503);
  assert.equal(availability.headers.get('retry-after'), '2');
  assert.doesNotMatch(await availability.text(), /internal database detail/);
});

test('an upstream receipt for a different operation cannot acknowledge a signed request', async () => {
  const jwt = await token();
  const command = {
    seq: 1, opId: operationId(deviceId, 1, 1), entityId, type: 'progress.weight.record',
    version: 1, expectedVersion: 0, payload: measurement,
  } satisfies PushRequest['ops'][number];
  const input = {...device, ops: [command]};
  const receipt = {
    seq: command.seq, opId: operationId(deviceId, 1, 2),
    status: 'applied', revision: '1', entityVersion: 1,
  };
  let pushCalls = 0;
  const request = scaffold(async (url, init) => {
    const route = new URL(String(url)).pathname;
    if (route === directory) return Response.json({accountId, role: 'participant'});
    assert.equal(route, '/rest/v1/rpc/levelmaxing_push_v1');
    assert.deepEqual(JSON.parse(String(init?.body)), {p_request: input});
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${jwt}`);
    pushCalls++;
    return Response.json({results: [receipt]});
  });
  await problem(await request('/v1/sync/push', jwt, input), 503, 'dependency_unavailable');
  assert.equal(pushCalls, 1);
});

test('workspace RPCs use the verified participant JWT and validate scoped reads and receipts', async () => {
  const jwt = await token();
  const value = {meals: [], recipes: [], groceries: []};
  const command = {section: 'nutrition', expect: 0, operationId: entityId, value};
  const snapshot = {version: 1, value};
  let saveReply = Response.json({outcome: 'applied', snapshot});
  let readReply = Response.json(snapshot);
  const request = scaffold(async (url, init) => {
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + jwt);
    assert.equal(new Headers(init?.headers).get('apikey'), publishableKey);
    assert.ok(init?.signal);
    const argumentsSent = JSON.parse(String(init.body));
    switch (new URL(String(url)).pathname) {
      case directory:
        assert.deepEqual(argumentsSent, {});
        return Response.json({accountId, role: 'participant'});
      case '/rest/v1/rpc/levelmaxing_workspace_read_v1':
        assert.deepEqual(argumentsSent, {p_section: 'nutrition'});
        return readReply;
      case '/rest/v1/rpc/levelmaxing_workspace_save_v1':
        assert.deepEqual(argumentsSent, {p_section: 'nutrition', p_expect: 0, p_operation_id: entityId, p_value: value});
        return saveReply;
      default:
        return assert.fail('Unexpected workspace RPC');
    }
  });
  assert.deepEqual(await (await request('/v1/workspace?section=nutrition', jwt)).json(), snapshot);
  assert.deepEqual(await (await request('/v1/workspace/save', jwt, command)).json(), {outcome: 'applied', snapshot});
  readReply = Response.json({version: 1, value: {checkIns: [], activities: [], bookmarks: []}});
  await problem(await request('/v1/workspace?section=nutrition', jwt), 503, 'dependency_unavailable');
  saveReply = Response.json({outcome: 'applied', snapshot: {...snapshot, version: 2}});
  await problem(await request('/v1/workspace/save', jwt, command), 503, 'dependency_unavailable');
  saveReply = Response.json({outcome: 'conflict', snapshot});
  assert.deepEqual(await (await request('/v1/workspace/save', jwt, command)).json(), {outcome: 'conflict', snapshot});
  saveReply = Response.json({code: 'P0001', message: 'workspace_operation_changed'}, {status: 400});
  await problem(await request('/v1/workspace/save', jwt, command), 409, 'workspace_operation_changed');
  saveReply = Response.json({code: '42501', message: 'participant_required'}, {status: 403});
  await problem(await request('/v1/workspace/save', jwt, command), 403, 'participant_required');
});

test('account export requires recent Firebase authentication even when the ID token was just issued', async () => {
  const now = Math.floor(Date.now() / 1000);
  const stale = await token({iat: now - 1, auth_time: now - 301});
  const fresh = await token({iat: now - 1, auth_time: now - 2});
  const calls: string[] = [];
  const request = scaffold(async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === directory) return Response.json({accountId, role: 'participant'});
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + fresh);
    if (path.endsWith('/levelmaxing_pull_v1')) {
      return Response.json({epoch: device.epoch, highWater: '0', groups: []});
    }
    if (path.endsWith('/levelmaxing_workspace_batch_v1')) {
      return Response.json({sections: ['profile', 'training', 'nutrition', 'journal'].map((section) =>
        ({section, tag: '0'.repeat(64), snapshot: {version: 0, value: null}}))});
    }
    assert.fail('Unexpected upstream route');
  });
  await problem(await request('/v1/account/export', stale), 403, 'recent_authentication_required');
  assert.deepEqual(calls, [directory]);
  const result = await request('/v1/account/export', fresh);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), {
    schemaVersion: 1,
    workspace: Object.fromEntries(['profile', 'training', 'nutrition', 'journal'].map((section) => [section, {version: 0, value: null}])),
    weight: {highWater: '0', groups: [], nextCursor: null},
  });
});

test('cloud batch uses one scoped RPC and falls back only when the function is absent', async () => {
  const jwt = await token();
  const known = '0'.repeat(64);
  const command = {sections: [{section: 'profile', known}, {section: 'training', known: null}]};
  const observation = {
    sections: [
      {section: 'profile', tag: known, snapshot: null},
      {section: 'training', tag: known, snapshot: {version: 0, value: null}},
    ],
  };
  const calls: string[] = [];
  let mode: 'active' | 'missing' | 'failed' = 'active';
  const request = scaffold(async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + jwt);
    if (path === directory) return Response.json({accountId, role: 'participant'});
    if (path.endsWith('/levelmaxing_workspace_batch_v1')) {
      assert.deepEqual(JSON.parse(String(init?.body)), {p_sections: command.sections});
      if (mode === 'missing') return Response.json({code: 'PGRST202'}, {status: 404});
      if (mode === 'failed') return Response.json({code: 'PGRST000'}, {status: 503});
      return Response.json(observation);
    }
    assert.equal(mode, 'missing');
    assert.ok(path.endsWith('/levelmaxing_workspace_read_v1'));
    return Response.json({version: 0, value: null});
  });
  assert.deepEqual(await (await request('/v1/workspace/batch', jwt, command)).json(), observation);
  assert.deepEqual(calls.map((path) => path.split('/').at(-1)), [
    'levelmaxing_resolve_firebase_user_v1', 'levelmaxing_workspace_batch_v1',
  ]);
  mode = 'missing';
  calls.length = 0;
  assert.deepEqual(await (await request('/v1/workspace/batch', jwt, command)).json(), observation);
  assert.deepEqual(calls.map((path) => path.split('/').at(-1)), [
    'levelmaxing_resolve_firebase_user_v1', 'levelmaxing_workspace_batch_v1',
    'levelmaxing_workspace_read_v1', 'levelmaxing_workspace_read_v1',
  ]);
  mode = 'failed';
  calls.length = 0;
  await problem(await request('/v1/workspace/batch', jwt, command), 503, 'dependency_unavailable');
  assert.equal(calls.length, 2);
});

test('cloud checked save forwards the representation and accepts a replayed same-version conflict', async () => {
  const jwt = await token();
  const known = 'b'.repeat(64);
  const operationId = '66666666-6666-4666-8666-666666666666';
  const profile = {name: 'Fixture', goal: '', experience: '', equipment: [], weekdays: [], minutes: 30, muscles: [],
    calories: null, units: 'kg', onboarded: true};
  const command = {section: 'profile', expect: 1, operationId, value: profile};
  const reply = {outcome: 'conflict', snapshot: {version: 1, value: {...profile, minutes: 55}}};
  let unavailableFunction = false;
  const request = scaffold(async (url, init) => {
    const path = new URL(String(url)).pathname;
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + jwt);
    if (path === directory) return Response.json({accountId, role: 'participant'});
    const params = {p_section: 'profile', p_expect: 1, p_operation_id: operationId, p_value: profile};
    if (path.endsWith('/levelmaxing_workspace_save_checked_v1')) {
      assert.deepEqual(JSON.parse(String(init?.body)), {...params, p_known: known});
      return unavailableFunction ? Response.json({code: 'PGRST202'}, {status: 404}) : Response.json(reply);
    }
    assert.ok(path.endsWith('/levelmaxing_workspace_save_v1'));
    assert.deepEqual(JSON.parse(String(init?.body)), params);
    return Response.json(reply);
  });
  assert.deepEqual(await (await request('/v1/workspace/save-checked', jwt, {command, known})).json(), reply);
  assert.deepEqual(await (await request('/v1/workspace/save', jwt, command)).json(), reply);
  unavailableFunction = true;
  await problem(await request('/v1/workspace/save-checked', jwt, {command, known}), 501, 'checked_workspace_unavailable');
});

test('archive browse and export use caller-scoped keyset pages, and export requires recent authentication', async () => {
  const fresh = await token();
  const now = Math.floor(Date.now() / 1000);
  const older = await token({iat: now - 1, auth_time: now - 350});
  const meal = {id: 'apple', name: 'Apple', date: '2026-11-15', meal: 'Breakfast', quantity: 1, unit: 'serving',
    macros: {calories: 85, protein: 0, carbs: 22, fat: 0}, source: 'Manual'};
  const page = {rows: [{id: meal.id, date: meal.date, value: meal, tag: 'c'.repeat(64)}], next: null};
  let pageRequests = 0;
  let disabled = false;
  let wrongDate = false;
  const request = scaffold(async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    if (endpoint === directory) return Response.json({accountId, role: 'participant'});
    assert.ok(endpoint.endsWith('/levelmaxing_history_page_v1'));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + fresh);
    assert.deepEqual(JSON.parse(String(init?.body)), {p_kind: 'meals', p_limit: 10, p_before_date: '2026-11-16', p_before_id: 'next'});
    pageRequests++;
    if (disabled) return Response.json({code: 'PGRST202'}, {status: 404});
    if (wrongDate) return Response.json({...page, rows: [{...page.rows[0], date: '2026-11-17'}]});
    return Response.json(page);
  });
  const query = '?kind=meals&beforeDate=2026-11-16&beforeId=next';
  await problem(await request('/v1/account/export/history' + query, older), 403, 'recent_authentication_required');
  assert.equal(pageRequests, 0);
  assert.deepEqual(await (await request('/v1/history' + query, fresh)).json(), page);
  const exported = await request('/v1/account/export/history' + query, fresh);
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await exported.json(), page);
  wrongDate = true;
  await problem(await request('/v1/history' + query, fresh), 503, 'dependency_unavailable');
  disabled = true;
  await problem(await request('/v1/history' + query, fresh), 501, 'history_unavailable');
});

test('archive move passes no account input and rejects impossible applied acknowledgments', async () => {
  const jwt = await token();
  const tag = 'a'.repeat(64);
  const input = {action: 'archive', kind: 'workouts', ids: ['session-1'], operationId: '66666666-6666-4666-8666-666666666666',
    expectVersion: 4, known: tag};
  let moved = 1;
  const request = scaffold(async (url, init) => {
    if (new URL(String(url)).pathname === directory) return Response.json({accountId, role: 'participant'});
    assert.ok(String(url).endsWith('/levelmaxing_history_move_v1'));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + jwt);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      p_action: input.action, p_kind: input.kind, p_ids: input.ids, p_operation_id: input.operationId,
      p_expect_version: input.expectVersion, p_known: tag, p_record_tags: null,
    });
    return Response.json({outcome: 'applied', moved, version: 5, tag: 'b'.repeat(64)});
  });
  const ok = await request('/v1/history/move', jwt, input);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {outcome: 'applied', moved: 1, version: 5, tag: 'b'.repeat(64)});
  moved = 2;
  await problem(await request('/v1/history/move', jwt, input), 503, 'dependency_unavailable');
});
