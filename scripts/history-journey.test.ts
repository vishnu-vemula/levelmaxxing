import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createLocalApp } from '../backend/src/local.ts';
import { createNodeServer } from '../backend/src/platform/node-http.ts';
import { getArchiveExportPage } from '../mobile/src/features/account-export/api.ts';
import { createHistoryApi, prepareHistoryCommand } from '../mobile/src/features/history/api.ts';
import { createWorkspaceTransport } from '../mobile/src/features/workspace/api.ts';
import { createApiRequester } from '../mobile/src/platform/api.ts';
import type { FoodLog, WorkspaceSave } from '../packages/contracts/src/index.ts';

test('mobile archives with exact retry, a second installation exports and restores the same record, and older saves cannot revive it',
  {timeout: 7000}, async (t) => {
    const participantToken = randomBytes(32).toString('hex');
    const secondParticipantToken = randomBytes(32).toString('hex');
    const app = createLocalApp({participantToken, secondParticipantToken});
    const prefix = '/functions/v1/api';
    const server = createNodeServer((request) => {
      const url = new URL(request.url);
      if (!url.pathname.startsWith(prefix + '/')) return Promise.resolve(new Response(null, {status: 404}));
      url.pathname = url.pathname.slice(prefix.length);
      return app(new Request(url, request));
    }, 0);
    t.after(() => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}${prefix}/`;
    const requester = createApiRequester(base, participantToken);
    const workspace = createWorkspaceTransport(requester);
    const device = createHistoryApi(createApiRequester(base, participantToken));
    const unrelated = createHistoryApi(createApiRequester(base, secondParticipantToken));
    const signal = new AbortController().signal;
    const meal: FoodLog = {
      id: 'rice-1', date: '2026-11-20', name: 'Rice', meal: 'Lunch', quantity: 1, unit: 'serving',
      macros: {calories: 204, carbs: 45, protein: 4, fat: 0.4}, source: 'Manual',
    };
    const original = {meals: [meal], recipes: [], groceries: []};
    const seed: WorkspaceSave = {section: 'nutrition', expect: 0, operationId: randomUUID(), value: original};
    assert.equal((await workspace.save(seed, signal)).outcome, 'applied');
    const before = await device.activeSnapshot('meals', signal);
    const row = {id: meal.id, date: meal.date, value: meal};
    const command = prepareHistoryCommand('archive', 'meals', [row], randomUUID(), before);
    assert.ok(command);
    const lost = createHistoryApi(async (path, decode, stop, body) => {
      const result = await requester(path, decode, stop, body);
      assert.equal(path, 'v1/history/move');
      assert.ok(JSON.stringify(result).includes('"outcome":"applied"'));
      throw new Error('Simulated connection loss after commit');
    });
    await assert.rejects(lost.move(command, signal), /after commit/);
    const confirming = await device.move(command, signal);
    assert.equal(confirming.moved, 1);
    assert.equal(confirming.version, 2);
    const archived = await device.archivePage('meals', null, signal);
    const archivedRow = archived.rows[0];
    assert.ok(archivedRow);
    assert.equal(archived.next, null);
    assert.equal(archived.rows.length, 1);
    assert.match(archivedRow.tag ?? '', /^[0-9a-f]{64}$/);
    assert.deepEqual({id: archivedRow.id, date: archivedRow.date, value: archivedRow.value}, row);
    assert.deepEqual(await unrelated.archivePage('meals', null, signal), {rows: [], next: null});
    assert.deepEqual(await getArchiveExportPage(requester, 'meals', null, signal), archived);

    const duplicate = await workspace.save({...seed, expect: 2, operationId: randomUUID()}, signal);
    assert.equal(duplicate.outcome, 'conflict');
    assert.equal(duplicate.snapshot.version, 2);
    assert.deepEqual(duplicate.snapshot.value, {...original, meals: []});
    const afterArchive = await device.activeSnapshot('meals', signal);
    const restore = prepareHistoryCommand('restore', 'meals', [archivedRow], randomUUID(), afterArchive);
    assert.ok(restore);
    assert.equal((await device.move(restore, signal)).outcome, 'applied');
    assert.deepEqual(await workspace.read('nutrition', signal), {version: 3, value: original});
    assert.deepEqual(await device.archivePage('meals', null, signal), {rows: [], next: null});
    assert.deepEqual(await device.move(command, signal), confirming);
  });
