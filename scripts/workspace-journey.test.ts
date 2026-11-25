import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createLocalApp } from '../backend/src/local.ts';
import { createNodeServer } from '../backend/src/platform/node-http.ts';
import { createApiRequester } from '../mobile/src/platform/api.ts';
import { createWorkspaceTransport } from '../mobile/src/features/workspace/api.ts';
import { WorkspaceController, emptyReplica, type Replica, type WorkspaceStatus, type WorkspaceStore } from '../mobile/src/features/workspace/model.ts';
import { workspaceSections, type WorkspaceSection, type WorkspaceValues } from '../packages/contracts/src/index.ts';

function disk(rows = new Map<WorkspaceSection, Replica>()): WorkspaceStore {
  return {
    async read(section) { return structuredClone(rows.get(section) ?? emptyReplica); },
    async write(section, replica) { rows.set(section, structuredClone(replica)); },
    async close() { return; },
  };
}

function wait(controller: WorkspaceController, section: WorkspaceSection, status: WorkspaceStatus, version?: number) {
  const matches = () => {
    const current = controller.view(section);
    return current.status === status && (version === undefined || current.replica.base.version === version);
  };
  if (matches()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = controller.subscribe(() => {
      if (!matches()) return;
      clearTimeout(timeout);
      cleanup();
      resolve();
    });
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Workspace ${section} did not reach ${status}, version ${version ?? 'any'}`));
    }, 3000);
  });
}

const sample = {
  profile: { name: 'Test', goal: 'Build strength', experience: 'Beginner', equipment: ['Dumbbells'], weekdays: ['Monday'], minutes: 45,
    muscles: ['Back'], calories: null, units: 'kg', onboarded: true },
  training: { activeProgramId: 'plan', programs: [{ id: 'plan', name: 'Training', days: [{ id: 'day', name: 'A', weekday: 1,
    exercises: [{ id: 'row', name: 'Row', sets: 3, reps: 12, restSeconds: 45 }] }] }], session: null, history: [] },
  nutrition: { meals: [{ id: 'meal', name: 'Apple', date: '2026-11-23', meal: 'Breakfast', quantity: 1,
    unit: 'serving', macros: { calories: 100, protein: 0, carbs: 25, fat: 0 }, source: 'Manual' }], recipes: [], groceries: [] },
  journal: { checkIns: [{ id: 'entry', date: '2026-11-23', hunger: 3, energy: 4, sleep: 7.5, note: '' }], activities: [], bookmarks: ['training-log'] },
} satisfies WorkspaceValues;

test('the mobile workspace persists offline edits and replays a lost receipt through HTTP; other accounts remain isolated', async (t) => {
  const participantToken = randomBytes(32).toString('hex');
  const secondParticipantToken = randomBytes(32).toString('hex');
  const app = createLocalApp({ participantToken, secondParticipantToken });
  const scenarioPath = '/functions/v1/api/';
  const server = createNodeServer((request) => {
    const target = new URL(request.url);
    if (!target.pathname.startsWith(scenarioPath)) return Promise.resolve(new Response(null, { status: 404 }));
    target.pathname = target.pathname.slice(scenarioPath.length - 1);
    return app(new Request(target, request));
  }, 0);
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}${scenarioPath}`;
  const transport = createWorkspaceTransport(createApiRequester(base, participantToken));
  const otherTransport = createWorkspaceTransport(createApiRequester(base, secondParticipantToken));
  const persisted = new Map<WorkspaceSection, Replica>();
  const offline = new WorkspaceController(randomUUID);
  await offline.start(async () => disk(persisted));
  for (const section of workspaceSections) await offline.save(section, sample[section]);
  await offline.close();

  const one = new WorkspaceController(randomUUID);
  const two = new WorkspaceController(randomUUID);
  const outsider = new WorkspaceController(randomUUID);
  t.after(async () => { await Promise.all([one.close(), two.close(), outsider.close()]); });
  await Promise.all([one.start(async () => disk(persisted)), two.start(async () => disk()), outsider.start(async () => disk())]);
  assert.deepEqual(one.view('nutrition').replica.local, sample.nutrition);
  let operation: string | undefined;
  one.connect({
    ...transport,
    async save(command, signal) {
      const result = await transport.save(command, signal);
      if (command.section !== 'training') return result;
      operation = JSON.stringify(command);
      throw new Error('Simulated lost receipt after commit');
    },
  });
  await wait(one, 'training', 'offline');
  assert.ok(operation);
  one.connect({
    ...transport,
    save(command, signal) {
      if (command.section === 'training' && command.expect === 0) assert.equal(JSON.stringify(command), operation);
      return transport.save(command, signal);
    },
  });
  await Promise.all(workspaceSections.map((section) => wait(one, section, 'saved', 1)));
  two.connect(transport);
  outsider.connect(otherTransport);
  await Promise.all(workspaceSections.map(async (section) => {
    await wait(two, section, 'saved', 1);
    assert.deepEqual(two.view(section).replica.local, sample[section]);
    await wait(outsider, section, 'saved', 0);
    assert.equal(outsider.view(section).replica.local, null);
  }));

  two.connect(null);
  const mealOnTwo = { ...sample.nutrition, meals: [...sample.nutrition.meals, { ...sample.nutrition.meals[0]!, id: 'second', name: 'Rice' }] };
  await two.save('nutrition', mealOnTwo);
  const mealOnOne = { ...sample.nutrition, meals: [{ ...sample.nutrition.meals[0]!, name: 'Banana' }] };
  await one.save('nutrition', mealOnOne);
  await wait(one, 'nutrition', 'saved', 2);
  two.connect(transport);
  await wait(two, 'nutrition', 'conflict');
  assert.deepEqual(two.view('nutrition').replica.local, mealOnTwo);
  assert.deepEqual(two.view('nutrition').replica.conflict?.value, mealOnOne);
  await two.resolve('nutrition', 'local');
  await wait(two, 'nutrition', 'saved', 3);
  one.syncAll();
  await wait(one, 'nutrition', 'saved', 3);
  assert.deepEqual(one.view('nutrition').replica.local, mealOnTwo);

  // Preserve nonoverlapping edits through the real version check and then get the combined document on both clients.
  two.connect(null);
  const firstMeal = mealOnTwo.meals[0]!;
  const secondMeal = mealOnTwo.meals[1]!;
  await two.save('nutrition', { ...mealOnTwo, meals: [firstMeal, { ...secondMeal, name: 'Brown rice' }] });
  await one.save('nutrition', { ...mealOnTwo, meals: [{ ...firstMeal, name: 'Pear' }, secondMeal] });
  await wait(one, 'nutrition', 'saved', 4);
  two.connect(transport);
  await wait(two, 'nutrition', 'conflict');
  await two.resolve('nutrition', 'combine');
  await wait(two, 'nutrition', 'saved', 5);
  one.connect({ ...transport });
  await wait(one, 'nutrition', 'saved', 5);
  assert.deepEqual(one.view('nutrition').replica.local, {
    ...mealOnTwo, meals: [{ ...firstMeal, name: 'Pear' }, { ...secondMeal, name: 'Brown rice' }],
  });
});

test('edits made during a slow save preserve the in-flight request and send a new version after its receipt', async (t) => {
  const controller = new WorkspaceController(randomUUID);
  t.after(() => controller.close());
  await controller.start(async () => disk());
  const first = sample.profile;
  const second = { ...first, name: 'Changed offline' };
  await controller.save('profile', first);
  const commands: Array<{ operationId: string; expect: number; value: WorkspaceValues[WorkspaceSection] }> = [];
  const gate = Promise.withResolvers<void>();
  controller.connect({
    async read() { return { version: 0, value: null }; },
    async save(command) {
      commands.push(command);
      if (command.expect === 0) await gate.promise;
      return { outcome: 'applied', snapshot: { version: command.expect + 1, value: command.value } };
    },
  });
  await controller.save('profile', second);
  gate.resolve();
  await wait(controller, 'profile', 'saved', 2);
  assert.deepEqual(commands.map(({ expect, value }) => ({ expect, value })), [
    { expect: 0, value: first }, { expect: 1, value: second },
  ]);
  assert.notEqual(commands[0]?.operationId, commands[1]?.operationId);
});

test('a stale rendered change cannot overwrite a newer remote snapshot waiting for disk', { timeout: 5000 }, async (t) => {
  const controller = new WorkspaceController(randomUUID);
  t.after(() => controller.close());
  const storage = disk();
  const writing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const initial = sample.profile;
  const remote = { ...initial, minutes: 55 };
  await controller.start(async () => ({
    ...storage,
    async write(section, replica) {
      if (section === 'profile' && replica.base.version === 2) {
        writing.resolve();
        await release.promise;
      }
      await storage.write(section, replica);
    },
  }));
  let version = 1;
  let sent = false;
  const transport = {
    async read(section: WorkspaceSection) {
      if (section !== 'profile') return { version: 0, value: null };
      return { version, value: version === 1 ? initial : remote };
    },
    async save() {
      sent = true;
      throw new Error('The stale edit should never leave this device.');
    },
  };
  controller.connect(transport);
  await wait(controller, 'profile', 'saved', 1);
  version = 2;
  controller.connect({ ...transport });
  await writing.promise;
  const save = controller.save('profile', { ...initial, name: 'Out of date' }, initial);
  release.resolve();
  await assert.rejects(save, /changed while you were editing/);
  await wait(controller, 'profile', 'saved', 2);
  assert.deepEqual(controller.view('profile').replica.local, remote);
  assert.equal(sent, false);
});
