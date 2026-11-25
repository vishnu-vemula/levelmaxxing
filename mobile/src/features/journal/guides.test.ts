import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLibraryPage, readBundledGuide } from '@levelmaxing/contracts';
import { ApiFailure, type ApiRequester } from '../../platform/api.ts';
import { createLibraryTransport, loadLibraryDetail, loadLibraryPage, type LibraryTransport } from './guides.ts';

const bundleDetail = readBundledGuide('training-log')!;
const signal = new AbortController().signal;
const unavailable: LibraryTransport = {
  async list() { throw new Error('No connection'); },
  async detail() { throw new Error('No connection'); },
};

test('the guide repository gives the same search and guide IDs from the bundled offline copy', async () => {
  const query = { q: '  FOOd  Label ', category: 'Nutrition', limit: 1 } as const;
  const result = await loadLibraryPage(unavailable, query, signal);
  assert.equal(result.source, 'bundle');
  assert.deepEqual(result.data.cards.map(({ id }) => id), ['food-label']);
  const detail = await loadLibraryDetail(null, 'training-log', signal);
  assert.equal(detail.source, 'bundle');
  assert.deepEqual(detail.data, bundleDetail);
});

test('a server removal does not resurrect bundled content, while an older backend can fall back', async () => {
  const removed = await loadLibraryDetail({
    ...unavailable,
    async detail() { throw new ApiFailure(404, 'library_guide_not_found'); },
  }, 'training-log', signal);
  assert.deepEqual(removed, { source: 'server', data: undefined });

  const oldBackend = await loadLibraryDetail({
    ...unavailable,
    async detail() { throw new ApiFailure(404, 'route_not_found'); },
  }, 'training-log', signal);
  assert.deepEqual(oldBackend, { source: 'bundle', data: bundleDetail });
});

test('library adapter preserves relative API paths and rejects a response for a different guide', async () => {
  const paths: string[] = [];
  const request: ApiRequester = async (path, decode) => {
    paths.push(path);
    const raw = path.startsWith('v1/library/guide?') ? bundleDetail : { catalogVersion: 2, cards: [], nextAfter: null };
    const result = decode(raw);
    if (result) return result;
    throw new ApiFailure(502, 'response_invalid');
  };
  const transport = createLibraryTransport(request);
  const page = await loadLibraryPage(transport, { q: 'food label', limit: 10 }, signal);
  assert.equal(page.source, 'server');
  assert.equal(page.data.catalogVersion, 2);
  await assert.rejects(() => transport.detail('food-label', signal), { code: 'response_invalid' });
  assert.deepEqual(paths, ['v1/library?q=food+label&limit=10', 'v1/library/guide?id=food-label']);
  assert.equal(parseLibraryPage({
    catalogVersion: 1,
    cards: [{ ...bundleDetail.guide, id: 'training-log' }],
    nextAfter: 'food-label',
  }), undefined);
});

test('cancelled library requests cannot publish even if the transport ignores cancellation', async () => {
  const aborted = new AbortController();
  await assert.rejects(() => loadLibraryPage({
    ...unavailable,
    async list() {
      aborted.abort();
      return { catalogVersion: 1, cards: [], nextAfter: null };
    },
  }, {}, aborted.signal), { name: 'AbortError' });
});
