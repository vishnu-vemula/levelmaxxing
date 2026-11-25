import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { parseLibraryDetail, parseLibraryPage, parseProblemDetails } from '@levelmaxing/contracts';
import { createLocalApp } from '../src/local.ts';
import { createNodeServer } from '../src/platform/node-http.ts';

const participant = 'library-local-participant-00000001';
const operator = 'library-local-operator-0000000002';

async function start(t: TestContext) {
  const logs: Array<{ route: string }> = [];
  const app = createLocalApp({participantToken: participant, operatorToken: operator, log: (record) => logs.push(record)});
  const server = createNodeServer(app, 0);
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
  return {
    logs,
    get(path: string, token = participant) {
      return fetch('http://127.0.0.1:' + address.port + path, {
        ...(token && { headers: { authorization: 'Bearer ' + token } }),
        signal: AbortSignal.timeout(3_000),
      });
    },
  };
}

test('participant library serves a stable versioned catalogue with keyset pages and detail', async t => {
  const { get, logs } = await start(t);
  const firstReply = await get('/v1/library?limit=1');
  assert.equal(firstReply.status, 200);
  assert.equal(firstReply.headers.get('cache-control'), 'no-store');
  const first = parseLibraryPage(await firstReply.json());
  assert.equal(first?.nextAfter, 'check-in');
  assert.deepEqual(first?.cards.map(({ id }) => id), ['check-in']);
  assert.ok(first && !('steps' in first.cards[0]!));
  const rest = parseLibraryPage(await (await get('/v1/library?limit=2&after=' + first.nextAfter)).json());
  assert.equal(rest?.catalogVersion, first.catalogVersion);
  assert.deepEqual(rest?.cards.map(({ id }) => id), ['food-label', 'training-log']);
  assert.equal(rest?.nextAfter, null);

  const filtered = parseLibraryPage(await (await get('/v1/library?q=FOOD%20label&category=Nutrition')).json());
  assert.deepEqual(filtered?.cards.map(({ id }) => id), ['food-label']);
  const detail = parseLibraryDetail(await (await get('/v1/library/guide?id=food-label')).json());
  assert.equal(detail?.catalogVersion, first.catalogVersion);
  assert.equal(detail?.guide.title, 'Log a serving from a food label');
  assert.equal(detail.guide.steps.length, 3);
  const absent = parseLibraryPage(await (await get('/v1/library?q=alphabet-soup&category=Progress')).json());
  assert.deepEqual(absent?.cards, []);

  // Search phrases never become log fields or route names.
  assert.doesNotMatch(JSON.stringify(logs), /alphabet-soup|FOOD|food-label|Bearer/);
});

test('library validates its query, distinguishes missing guides and requires participant access', async t => {
  const { get } = await start(t);
  const cases = [
    ['/v1/library', '', 401, 'unauthenticated'],
    ['/v1/library/guide?id=training-log', operator, 403, 'participant_required'],
    ['/v1/library?limit=26', participant, 400, 'invalid_library_query'],
    ['/v1/library?q=first&q=second', participant, 400, 'invalid_library_query'],
    ['/v1/library?category=Medical', participant, 400, 'invalid_library_query'],
    ['/v1/library?after=%2Fevil', participant, 400, 'invalid_library_query'],
    ['/v1/library?q=' + 'a'.repeat(81), participant, 400, 'invalid_library_query'],
    ['/v1/library/guide', participant, 400, 'invalid_library_query'],
    ['/v1/library/guide?id=food-label&id=check-in', participant, 400, 'invalid_library_query'],
    ['/v1/library/guide?id=unknown', participant, 404, 'library_guide_not_found'],
  ] as const;
  for (const [path, token, status, code] of cases) {
    const reply = await get(path, token);
    assert.equal(reply.status, status, path);
    assert.equal(parseProblemDetails(await reply.json())?.code, code, path);
  }
});
