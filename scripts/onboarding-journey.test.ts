import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { WorkspaceSection } from '@levelmaxing/contracts';
import { createLocalApp } from '../backend/src/local.ts';
import { emptyProfile, onboardingStep, profileAfterStep } from '../mobile/src/features/profile/onboarding.ts';
import { createWorkspaceTransport } from '../mobile/src/features/workspace/api.ts';
import { emptyReplica, WorkspaceController, type Replica, type WorkspaceStatus } from '../mobile/src/features/workspace/model.ts';
import { createApiRequester } from '../mobile/src/platform/api.ts';

function installation(rows = new Map<WorkspaceSection, Replica>()) {
  const controller = new WorkspaceController(randomUUID);
  return { controller, open: () => controller.start(async () => ({
    async read(section) { return structuredClone(rows.get(section) ?? emptyReplica); },
    async write(section, replica) { rows.set(section, structuredClone(replica)); },
    async close() {},
  })) };
}

function profileAt(controller: WorkspaceController, status: WorkspaceStatus, version: number) {
  const matches = () => {
    const view = controller.view('profile');
    return view.status === status && view.replica.base.version === version;
  };
  if (matches()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const stop = controller.subscribe(() => {
      if (!matches()) return;
      clearTimeout(timeout);
      stop();
      resolve();
    });
    const timeout = setTimeout(() => {
      stop();
      reject(new Error(`Profile did not reach ${status}, version ${version}`));
    }, 3000);
  });
}

test('setup checkpoints survive restart, sync within the account and preserve an explicit conflict', async (t) => {
  const participantToken = randomBytes(32).toString('hex');
  const secondParticipantToken = randomBytes(32).toString('hex');
  const app = createLocalApp({ participantToken, secondParticipantToken });
  t.mock.method(globalThis, 'fetch', (input: RequestInfo | URL, init?: RequestInit) => app(new Request(input, init)));
  const transport = (token: string) => createWorkspaceTransport(createApiRequester('http://127.0.0.1:4321/', token));
  const disk = new Map<WorkspaceSection, Replica>();
  const first = installation(disk);
  const resumed = installation(disk);
  const second = installation();
  const outsider = installation();
  t.after(async () => { await Promise.all([first, resumed, second, outsider].map(({ controller }) => controller.close())); });
  await first.open();

  const form = { ...emptyProfile, name: 'Test participant', goal: 'Get stronger', experience: 'Beginner', equipment: ['Dumbbells'],
    weekdays: ['Mon'], minutes: 45, muscles: ['Back'] };
  const firstStep = profileAfterStep(emptyProfile, form, 0, '');
  assert.ok(firstStep);
  await first.controller.save('profile', firstStep, null);
  const secondStep = profileAfterStep(firstStep, form, 1, '');
  assert.ok(secondStep);
  await first.controller.save('profile', secondStep, firstStep);
  await first.controller.close();

  await Promise.all([resumed.open(), second.open(), outsider.open()]);
  assert.deepEqual(resumed.controller.view('profile').replica.local, secondStep);
  assert.equal(onboardingStep(secondStep), 2);
  resumed.controller.connect(transport(participantToken));
  await profileAt(resumed.controller, 'saved', 2);
  second.controller.connect(transport(participantToken));
  outsider.controller.connect(transport(secondParticipantToken));
  await profileAt(second.controller, 'saved', 2);
  await profileAt(outsider.controller, 'saved', 0);
  assert.deepEqual(second.controller.view('profile').replica.local, secondStep);
  assert.equal(outsider.controller.view('profile').replica.local, null);

  resumed.controller.connect(null);
  const thirdStep = profileAfterStep(secondStep, form, 2, '');
  assert.ok(thirdStep);
  await resumed.controller.save('profile', thirdStep, secondStep);
  const finished = profileAfterStep(secondStep, { ...form, minutes: 60 }, 3, '');
  assert.ok(finished);
  await second.controller.save('profile', finished, secondStep);
  await profileAt(second.controller, 'saved', 3);
  resumed.controller.connect(transport(participantToken));
  await profileAt(resumed.controller, 'conflict', 2);
  assert.deepEqual(resumed.controller.view('profile').replica.local, thirdStep);
  assert.deepEqual(resumed.controller.view('profile').replica.conflict?.value, finished);
  const staleFinish = profileAfterStep(thirdStep, form, 3, '');
  assert.ok(staleFinish);
  await assert.rejects(resumed.controller.save('profile', staleFinish, thirdStep, { requireNoConflict: true }), /Resolve the sync conflict/);
  assert.deepEqual(resumed.controller.view('profile').replica.local, thirdStep);
  await resumed.controller.resolve('profile', 'remote');
  await profileAt(resumed.controller, 'saved', 3);
  assert.deepEqual(resumed.controller.view('profile').replica.local, finished);
  assert.equal(outsider.controller.view('profile').replica.local, null);
});
