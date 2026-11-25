import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkOperator } from './api.ts';

const signal = () => new AbortController().signal;

test('operator verification sends credentials to the configured access path', async () => {
  const result = await checkOperator('/api', 'local-fixture', signal(), async (url, init) => {
    assert.equal(url, '/api/v1/admin/access');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer local-fixture');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    return Response.json({ role: 'operator' });
  });
  assert.equal(result, 'operator');
});

test('unsuccessful, unverified or invalid responses cannot grant operator access', async () => {
  const checks = [
    { response: new Response('', { status: 401 }), outcome: 'expired' },
    { response: new Response('', { status: 403 }), outcome: 'denied' },
    { response: new Response('', { status: 503 }), outcome: 'unavailable' },
    { response: Response.json({ role: 'member' }), outcome: 'unavailable' },
    { response: new Response('not-json'), outcome: 'unavailable' },
  ];
  for (const { response, outcome } of checks) {
    assert.equal(await checkOperator('/api', 'rejected', signal(), async () => response), outcome);
  }
});

test('aborted access checks do not resolve into application permission state', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(checkOperator('/api', 'local-fixture', controller.signal, async (_input, init) => {
    init?.signal?.throwIfAborted();
    return Response.json({ role: 'operator' });
  }), { name: 'AbortError' });
});
