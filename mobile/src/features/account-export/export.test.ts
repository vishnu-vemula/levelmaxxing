import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ACCOUNT_EXPORT_FORMAT, parseAccountExportPage, type AccountExportPage} from '@levelmaxing/contracts';
import {getAccountExportPage, getArchiveExportPage} from './api.ts';
import {accountExportTexts, archiveExportTexts} from './format.ts';

const empty = {version: 0, value: null};
const page: AccountExportPage = {schemaVersion: 1,
  workspace: {profile: empty, training: empty, nutrition: empty, journal: empty},
  weight: {highWater: '0', groups: [], nextCursor: null},
};
const info = {exportId: 'synthetic-id', startedAt: '2026-11-23T00:00:00.000Z', index: 1};

test('exports plain JSON without including the cursor in shared contents', () => {
  const [payload] = accountExportTexts({...page, weight: {...page.weight, nextCursor: 'cursor.signature'}}, info);
  assert.ok(payload);
  assert.ok(!payload.includes('cursor.signature'));
  assert.deepEqual(JSON.parse(payload), {
    format: ACCOUNT_EXPORT_FORMAT, ...info, workspace: page.workspace,
    weight: {throughRevision: '0', groups: []}, hasMoreWeight: true,
  });
});

test('large exports emit bounded JSON parts that reassemble losslessly', () => {
  assert.ok(page.workspace);
  const data = {...page, workspace: {...page.workspace, journal: {version: 3, value: {
    activities: [], bookmarks: [], checkIns: Array.from({length: 96}, (_, index) => ({
      id: 'check-' + index, date: '2026-11-23', hunger: 3, energy: 3, sleep: 8, note: '"😀'.repeat(500),
    })),
  }}}};
  const parts = accountExportTexts(data, info);
  assert.ok(parts.length > 1 && parts.every(part => part.length <= 80_000));
  const decoded: {format: string; exportId: string; page: number; index: number; count: number; payload: string}[] = parts.map(part => JSON.parse(part));
  for (const [index, part] of decoded.entries()) {
    assert.equal(part.format, ACCOUNT_EXPORT_FORMAT);
    assert.equal(part.exportId, info.exportId);
    assert.equal(part.page, info.index);
    assert.equal(part.index, index + 1);
    assert.equal(part.count, parts.length);
  }
  assert.deepEqual(JSON.parse(decoded.map(part => part.payload).join('')).workspace, data.workspace);
});

test('the account export client keeps the API-relative path and propagates cancellation', async () => {
  const signal = new AbortController().signal;
  const result = await getAccountExportPage(async (route, parse, stopped) => {
    assert.equal(route, 'v1/account/export?cursor=%3F%26%3D');
    assert.equal(stopped, signal);
    assert.equal(parse, parseAccountExportPage);
    const result = parse(page);
    assert.ok(result);
    return result;
  }, '?&=', signal);
  assert.deepEqual(result, page);
});

test('archive export keeps the stored record and excludes the continuation position from shared JSON', async () => {
  const value = {id: 'rice', date: '2026-11-15', name: 'Rice', meal: 'Dinner' as const, quantity: 1, unit: 'serving',
    macros: {calories: 250, protein: 5, carbs: 50, fat: 0}, source: 'Manual'};
  const record = {id: value.id, date: value.date, value};
  const stored = {...record, tag: 'b'.repeat(64)};
  const signal = new AbortController().signal;
  const data = await getArchiveExportPage(async (route, parse, stopped) => {
    assert.equal(route, 'v1/account/export/history?kind=meals&limit=10&beforeDate=2026-11-16&beforeId=previous');
    assert.equal(stopped, signal);
    assert.equal(parse({rows: [{...stored, id: 'different-id'}], next: null}), undefined);
    const page = parse({rows: [stored], next: {id: record.id, date: record.date}});
    assert.ok(page);
    return page;
  }, 'meals', {date: '2026-11-16', id: 'previous'}, signal);
  const exported = archiveExportTexts('meals', data, info);
  assert.equal(exported.length, 1);
  assert.deepEqual(JSON.parse(exported[0]!), {
    format: 'levelmaxing-archived-records-v1', ...info, kind: 'meals', records: [record], hasMore: true,
  });
});
