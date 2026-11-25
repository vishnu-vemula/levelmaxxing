import { deepEqual, equal, rejects } from 'node:assert/strict';
import { test } from 'node:test';
import { ApiFailure, type ApiRequester } from '../../platform/api.ts';
import { createProgressTransport } from './api.ts';
import { SyncContextChanged, SyncCursorExpired, SyncSignInRequired } from './sync.ts';

function failingTransport(error: Error) {
  return createProgressTransport(async () => { throw error; });
}

test('pulling translates the expired cursor problem and keeps other recovery outcomes distinct', async () => {
  await rejects(failingTransport(new ApiFailure(410, 'cursor_expired')).pull('old'), SyncCursorExpired);
  await rejects(failingTransport(new ApiFailure(409, 'cursor_expired')).pull('old'), SyncContextChanged);
  await rejects(failingTransport(new ApiFailure(403, 'cursor_expired')).pull('old'), SyncSignInRequired);
  await rejects(failingTransport(new ApiFailure(410, 'cursor_expired')).register('device'), SyncContextChanged);
  const providerUnavailable = new ApiFailure(503, 'dependency_unavailable');
  await rejects(failingTransport(providerUnavailable).pull(null), e => e === providerUnavailable);
});

test('the progress adapter preserves encoded cursor and cancellation signal', async () => {
  const signal = new AbortController().signal;
  const payload = { epoch: 'test', groups: [], nextCursor: 'next', hasMore: false };
  const request: ApiRequester = async (route, parse, actualSignal, body) => {
    equal(route, 'v1/sync/pull?cursor=a%2Fb%20c');
    equal(actualSignal, signal);
    equal(body, undefined);
    const result = parse(payload);
    if (!result) throw new Error('Fixture must match production response');
    return result;
  };
  deepEqual(await createProgressTransport(request).pull('a/b c', signal), payload);
});
