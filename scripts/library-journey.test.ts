import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createLocalApp } from '../backend/src/local.ts';
import { createNodeServer } from '../backend/src/platform/node-http.ts';
import { createLibraryTransport, loadLibraryDetail, loadLibraryPage } from '../mobile/src/features/journal/guides.ts';
import { createApiRequester } from '../mobile/src/platform/api.ts';

test('mobile library reads through the hosted path prefix and falls back after backend rollback', async t => {
  const token = randomBytes(32).toString('hex');
  const app = createLocalApp({ participantToken: token });
  let available = true;
  const server = createNodeServer(async (request) => {
    const url = new URL(request.url);
    const prefix = '/functions/v1/api';
    if (available && url.pathname.startsWith(prefix + '/')) {
      url.pathname = url.pathname.slice(prefix.length);
      return app(new Request(url, request));
    }
    url.pathname = '/unmapped';
    return app(new Request(url, request));
  }, 0);
  t.after(() => {
    if (server.listening) return new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const transport = createLibraryTransport(createApiRequester(
    'http://127.0.0.1:' + address.port + '/functions/v1/api/', token,
  ));
  const query = { q: 'Training log', category: 'Training' } as const;
  const signal = AbortSignal.timeout(4_000);
  const online = await loadLibraryPage(transport, query, signal);
  assert.equal(online.source, 'server');
  assert.deepEqual(online.data.cards.map(({ id }) => id), ['training-log']);
  const guide = await loadLibraryDetail(transport, online.data.cards[0]!.id, signal);
  assert.equal(guide.source, 'server');
  assert.equal(guide.data?.guide.steps.length, 3);
  available = false;
  const fallback = await loadLibraryPage(transport, query, signal);
  assert.equal(fallback.source, 'bundle');
  assert.deepEqual(fallback.data, online.data);
  assert.deepEqual((await loadLibraryDetail(transport, 'training-log', signal)).data, guide.data);
});
