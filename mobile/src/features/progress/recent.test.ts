import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { publishRecent } from './recent.ts';
import type { Entry } from './sync.ts';

const entries: Entry[] = [{ id: 'weigh-in', measuredOn: '2026-11-23', grams: 71_500, state: 'pending' }];

test('a read completed after the account scope changes cannot publish entries', async () => {
  const read = Promise.withResolvers<Entry[]>();
  const observed: Entry[][] = [];
  let current = true;
  const observer = {
    publish: (value: Entry[]) => { observed.push(value); },
    unavailable: () => { throw new Error('Unexpected storage failure'); },
  };
  const refresh = publishRecent({ recent: () => read.promise }, () => current, observer);
  current = false;
  read.resolve(entries);
  await refresh;
  deepEqual(observed, []);

  current = true;
  await publishRecent({ recent: async () => entries }, () => current, observer);
  deepEqual(observed, [entries]);
});

test('storage errors report separately from a durable save and only for the active scope', async () => {
  const read = Promise.withResolvers<Entry[]>();
  let current = true;
  let failures = 0;
  const observer = {
    publish: () => { throw new Error('A failed read cannot publish entries'); },
    unavailable: () => { failures += 1; },
  };
  const refresh = publishRecent({ recent: () => read.promise }, () => current, observer);
  current = false;
  read.reject(new Error('Old connection closed'));
  await refresh;
  equal(failures, 0);

  current = true;
  await publishRecent({ recent: async () => { throw new Error('Storage failed'); } }, () => current, observer);
  equal(failures, 1);
});
