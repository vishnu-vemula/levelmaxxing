import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getServiceStatus } from './api.ts';

const signal = () => new AbortController().signal;

test('public liveness is checked without credentials and requires a matching response', async () => {
  const available = await getServiceStatus('/api', signal(), async (url, init) => {
    assert.equal(url, '/api/healthz');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return Response.json({ status: 'ok' });
  });
  assert.equal(available, true);
  assert.equal(await getServiceStatus('/api', signal(), async () => Response.json({ status: 'unknown' })), false);
});
