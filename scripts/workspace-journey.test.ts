import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createLocalApp } from '../backend/src/local.ts';
import { createNodeServer } from '../backend/src/platform/node-http.ts';
import { createApiRequester } from '../mobile/src/platform/api.ts';
import { copyFoodLogs, labelNutrition, readMacros } from '../mobile/src/features/nutrition/model.ts';
import { correctWorkoutDate, setWorkoutLog, startWorkout } from '../mobile/src/features/training/model.ts';
import { createWorkspaceTransport } from '../mobile/src/features/workspace/api.ts';
import { WorkspaceController, decodeReplica, emptyReplica, type Replica, type WorkspaceStatus, type WorkspaceStore } from '../mobile/src/features/workspace/model.ts';
import { workspaceSections, type WorkspaceSection, type WorkspaceValues } from '../packages/contracts/src/index.ts';

function disk(rows = new Map<WorkspaceSection, Replica>()): WorkspaceStore {
  return {
    async read(section) {
      const decoded = decodeReplica(section, JSON.parse(JSON.stringify(rows.get(section) ?? emptyReplica)));
      assert.ok(decoded);
      return decoded;
    },
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

test('a copied meal survives an offline restart and syncs only within the account through the API handler', async (t) => {
  const participantToken = randomBytes(32).toString('hex');
  const secondParticipantToken = randomBytes(32).toString('hex');
  const app = createLocalApp({ participantToken, secondParticipantToken });
  t.mock.method(globalThis, 'fetch', (input: RequestInfo | URL, init?: RequestInit) => app(new Request(input, init)));
  const base = 'http://127.0.0.1:4321/';
  const transport = createWorkspaceTransport(createApiRequester(base, participantToken));
  const otherTransport = createWorkspaceTransport(createApiRequester(base, secondParticipantToken));
  const persisted = new Map<WorkspaceSection, Replica>();
  const offline = new WorkspaceController(randomUUID);
  await offline.start(async () => disk(persisted));
  await offline.save('nutrition', sample.nutrition);
  const source = sample.nutrition.meals[0]!;
  const destination = { date: '2026-11-24', meal: 'Dinner' } as const;
  const copied = copyFoodLogs(sample.nutrition, [source], destination, randomUUID);
  assert.ok(copied);
  const duplicate = copied.meals[1]!;
  assert.notEqual(duplicate.id, source.id);
  assert.deepEqual(duplicate, { ...source, ...destination, id: duplicate.id });
  await offline.save('nutrition', copied);
  await offline.close();

  const one = new WorkspaceController(randomUUID);
  const two = new WorkspaceController(randomUUID);
  const outsider = new WorkspaceController(randomUUID);
  t.after(async () => { await Promise.all([one.close(), two.close(), outsider.close()]); });
  await Promise.all([one.start(async () => disk(persisted)), two.start(async () => disk()), outsider.start(async () => disk())]);
  assert.deepEqual(one.view('nutrition').replica.local, copied);
  one.connect(transport);
  await wait(one, 'nutrition', 'saved', 2);
  two.connect(transport);
  outsider.connect(otherTransport);
  await wait(two, 'nutrition', 'saved', 2);
  await wait(outsider, 'nutrition', 'saved', 0);
  assert.deepEqual(two.view('nutrition').replica.local, copied);
  assert.equal(outsider.view('nutrition').replica.local, null);
});

test('a corrected workout date uses the existing checked-save route and appears on a second client', async (t) => {
  const participantToken = randomBytes(32).toString('hex');
  const app = createLocalApp({ participantToken });
  t.mock.method(globalThis, 'fetch', (input: RequestInfo | URL, init?: RequestInit) => app(new Request(input, init)));
  const client = () => createWorkspaceTransport(createApiRequester('http://127.0.0.1:4321/', participantToken));
  const one = new WorkspaceController(randomUUID);
  const two = new WorkspaceController(randomUUID);
  t.after(async () => { await Promise.all([one.close(), two.close()]); });
  await Promise.all([one.start(async () => disk()), two.start(async () => disk())]);
  one.connect(client());
  await wait(one, 'training', 'saved', 0);

  const plan = sample.training.programs[0]!;
  const day = plan.days[0]!;
  const workout = { id: 'session', name: day.name, programId: plan.id, dayId: day.id, restEndsAt: null,
    startedAt: new Date(2026, 10, 24, 10).toISOString(), finishedAt: new Date(2026, 10, 24, 11).toISOString(),
    exercises: day.exercises.map((exercise) => ({ ...exercise, logged: [{ id: 'set', reps: 8, grams: 20_000 }] })) };
  const training = { ...sample.training, history: [workout] };
  await one.save('training', training);
  await wait(one, 'training', 'saved', 1);
  const corrected = correctWorkoutDate(training, workout.id, workout.finishedAt, '2026-11-22', new Date(2026, 10, 25));
  await one.save('training', corrected);
  await wait(one, 'training', 'saved', 2);
  two.connect(client());
  await wait(two, 'training', 'saved', 2);
  assert.deepEqual(two.view('training').replica.local, corrected);
});

test('offline workout sets and manual food survive restart and sync once after a dropped receipt', async (t) => {
  const participantToken = randomBytes(32).toString('hex');
  const otherToken = randomBytes(32).toString('hex');
  const app = createLocalApp({ participantToken, secondParticipantToken: otherToken });
  let lostBody: string | undefined;
  let replayed = false;
  let dropReceipt = false;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const reply = await app(request);
    if (new URL(request.url).pathname !== '/v1/workspace/save-checked' || typeof init?.body !== 'string') return reply;
    const { command } = JSON.parse(init.body);
    if (command.section !== 'training' || command.expect !== 1 || !reply.ok) return reply;
    if (dropReceipt) {
      dropReceipt = false;
      lostBody = init.body;
      throw new TypeError('Receipt lost after server commit');
    }
    if (lostBody !== undefined) {
      assert.equal(init.body, lostBody);
      replayed = true;
    }
    return reply;
  });
  const client = (token = participantToken) => createWorkspaceTransport(createApiRequester('http://127.0.0.1:4321/', token));
  const persisted = new Map<WorkspaceSection, Replica>();
  const first = new WorkspaceController(randomUUID);
  const resumed = new WorkspaceController(randomUUID);
  const retried = new WorkspaceController(randomUUID);
  const second = new WorkspaceController(randomUUID);
  const outsider = new WorkspaceController(randomUUID);
  t.after(async () => { await Promise.all([first, resumed, retried, second, outsider].map((controller) => controller.close())); });
  await first.start(async () => disk(persisted));
  first.connect(client());
  await wait(first, 'training', 'saved', 0);
  await first.save('training', sample.training);
  await wait(first, 'training', 'saved', 1);
  first.connect(null);

  const plan = sample.training.programs[0]!;
  const day = plan.days[0]!;
  const exercise = day.exercises[0]!;
  const start = Date.parse('2026-11-24T09:00:00.000Z');
  const workout = startWorkout(sample.training, plan.id, day.id, randomUUID(), start);
  await first.save('training', workout);
  const set = { id: randomUUID(), reps: 9, grams: 25_000 };
  const trained = setWorkoutLog(workout, exercise.id, set, start + 2000);
  await first.save('training', trained);

  const entered = readMacros({ calories: '90', protein: '4', carbs: '9.5', fat: '2' });
  assert.ok(entered);
  const meal = { id: randomUUID(), name: 'Sample oats', date: '2026-11-24', meal: 'Breakfast', quantity: 2,
    unit: 'serving', macros: labelNutrition(entered, 2, 1, 'kcal'), source: 'Manual entry' } as const;
  const nutrition = { meals: [meal], recipes: [], groceries: [] };
  await first.save('nutrition', nutrition);
  await first.close();

  await Promise.all([resumed.start(async () => disk(persisted)), second.start(async () => disk()), outsider.start(async () => disk())]);
  assert.deepEqual(resumed.view('training').replica.local, trained);
  assert.deepEqual(resumed.view('nutrition').replica.local, nutrition);
  dropReceipt = true;
  resumed.connect(client());
  await wait(resumed, 'training', 'offline', 1);
  assert.ok(lostBody);
  assert.equal(resumed.view('training').replica.pendingKnown, JSON.parse(lostBody).known);
  await resumed.close();
  await retried.start(async () => disk(persisted));
  retried.connect(client());
  await wait(retried, 'training', 'saved', 3);
  await wait(retried, 'nutrition', 'saved', 1);
  assert.equal(retried.view('training').replica.pendingKnown, undefined);
  assert.equal(replayed, true);

  second.connect(client());
  outsider.connect(client(otherToken));
  await wait(second, 'training', 'saved', 3);
  await wait(second, 'nutrition', 'saved', 1);
  await wait(outsider, 'training', 'saved', 0);
  await wait(outsider, 'nutrition', 'saved', 0);
  assert.deepEqual(second.view('training').replica.local, trained);
  assert.deepEqual(second.view('nutrition').replica.local, nutrition);
  assert.equal(outsider.view('training').replica.local, null);
  assert.equal(outsider.view('nutrition').replica.local, null);
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

test('transport replacement during the disk write uses the already persisted check tag', { timeout: 5000 }, async (t) => {
  const controller = new WorkspaceController(randomUUID);
  t.after(() => controller.close());
  const store = disk();
  const writing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const freshAttempt = Promise.withResolvers<void>();
  const firstTag = 'a'.repeat(64);
  const nextTag = 'b'.repeat(64);
  const prior = sample.profile;
  try {
    await controller.start(async () => ({
      ...store,
      async write(section, replica) {
        if (section === 'profile' && replica.pendingKnown === firstTag) {
          writing.resolve();
          await release.promise;
        }
        await store.write(section, replica);
      },
    }));
    const read = async (section: WorkspaceSection) => section === 'profile' ? { version: 1, value: prior } : { version: 0, value: null };
    controller.connect({ read, async save(_command, signal, _base, check) {
      assert.ok(check);
      await check.persist(firstTag);
      assert.equal(signal.aborted, true);
      throw new Error('The old transport was interrupted');
    } });
    await wait(controller, 'profile', 'saved', 1);
    await controller.save('profile', { ...prior, minutes: 60 });
    await writing.promise;
    controller.connect({ read, async save(command, _signal, _base, check) {
      assert.ok(check);
      assert.equal(check.known, undefined);
      freshAttempt.resolve();
      assert.equal(await check.persist(nextTag), firstTag);
      return { outcome: 'applied', snapshot: { version: command.expect + 1, value: command.value } };
    } });
    await freshAttempt.promise;
    release.resolve();
    await wait(controller, 'profile', 'saved', 2);
    assert.equal(controller.view('profile').replica.pendingKnown, undefined);
  } finally {
    release.resolve();
  }
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
