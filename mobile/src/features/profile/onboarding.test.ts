import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWorkspaceValue } from '@levelmaxing/contracts';
import { emptyProfile, onboardingError, onboardingStep, profileAfterStep, profileFields } from './onboarding.ts';

const form = {
  ...emptyProfile, name: ' Sample ', goal: 'Get stronger', experience: 'Beginner', equipment: ['Dumbbells'],
  weekdays: ['Mon'], minutes: 45, muscles: ['Back'],
};

test('onboarding resumes after each persisted answer and keeps incomplete profiles out of Today', () => {
  assert.equal(onboardingStep(emptyProfile), 0);
  let saved = emptyProfile;
  for (const step of [0, 1, 2]) {
    assert.equal(onboardingError(step, form), undefined);
    const checkpoint = profileAfterStep(saved, form, step, '');
    assert.ok(checkpoint);
    const restored = parseWorkspaceValue('profile', JSON.parse(JSON.stringify(checkpoint)));
    assert.ok(restored);
    assert.equal(restored.onboarded, false);
    assert.equal(onboardingStep(restored), step + 1);
    saved = restored;
  }
  const completed = profileAfterStep(saved, form, 3, '');
  assert.deepEqual(completed, { ...form, name: 'Sample', onboarded: true, calories: null });
  assert.equal(onboardingStep(completed!), 0);
  assert.equal(onboardingStep({ ...saved, muscles: [] }), 2);
});

test('an invalid step stays incomplete and a completed profile saves changes only on Finish', () => {
  assert.match(onboardingError(0, emptyProfile) ?? '', /choose a goal/);
  assert.match(onboardingError(1, emptyProfile) ?? '', /training day/);
  for (const target of ['0', '20001', '1e3', '5.5']) {
    assert.match(onboardingError(3, form, target) ?? '', /daily calorie target/);
  }
  const saved = { ...form, units: 'lb' as const, onboarded: true };
  assert.equal(profileFields(saved), profileFields({ ...saved, units: 'kg' }));
  for (const step of [0, 1, 2]) assert.equal(profileAfterStep(saved, form, step, ''), undefined);
  assert.deepEqual(profileAfterStep(saved, { ...form, minutes: 60 }, 3, ' 2000 '), {
    ...saved, name: 'Sample', minutes: 60, calories: 2000,
  });
});
