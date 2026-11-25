import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseWorkspaceValue } from '@levelmaxing/contracts';
import { dateKey } from '../../shared/local-date.ts';
import {
  changeRest, correctWorkoutDate, dayForToday, deleteProgram, displayLoad, duplicateProgram, emptyTraining, finishWorkout, makeProgram, parseLoad, parseReps,
  removeWorkoutLog, restRemaining, saveProgram, setWorkoutExercise, setWorkoutLog, starterRoutines, startWorkout,
  updatePastSet, workoutShareContent, workoutTotals,
} from './model.ts';

const start = Date.parse('2026-02-16T08:30:00.000Z');

test('workout recap excludes every unselected field, including the workout name in share metadata', () => {
  const details = { name: 'Private routine', date: '16 Feb 2026', duration: '3:00', sets: '1 set', volume: '225 kg lifted' };
  assert.equal(workoutShareContent(details, new Set()), undefined);
  assert.deepEqual(workoutShareContent(details, new Set(['sets'])), { title: 'Workout summary', message: '1 set' });
  assert.deepEqual(workoutShareContent(details, new Set(['volume', 'duration'])), {
    title: 'Workout summary', message: '3:00\n225 kg lifted',
  });
  assert.deepEqual(workoutShareContent(details, new Set(['name', 'date'])), {
    title: 'Private routine', message: 'Private routine\n16 Feb 2026',
  });
});

function fixture() {
  let sequence = 0;
  const createId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const program = makeProgram(createId, starterRoutines[0]);
  const [day] = program.days;
  assert.ok(day);
  const [exercise] = day.exercises;
  assert.ok(exercise);
  const data = saveProgram(emptyTraining, program);
  return { createId, program, data, day, exercise };
}

test('correcting the local date preserves duration and sets, reorders history and round-trips through v1', () => {
  const { createId, data, program, day, exercise } = fixture();
  const finish = +new Date(2026, 2, 10, 0, 15);
  const started = startWorkout(data, program.id, day.id, createId(), finish - 3_600_000);
  const logged = setWorkoutLog(started, exercise.id, { id: createId(), reps: 9, grams: 25_000 }, finish - 600_000);
  const finished = finishWorkout(logged, logged.session!.id, finish);
  const original = finished.history[0]!;
  const other = { ...original, id: createId(), startedAt: new Date(2026, 2, 9, 10).toISOString(),
    finishedAt: new Date(2026, 2, 9, 11).toISOString() };
  const training = { ...finished, history: [original, other] };
  const now = new Date(2026, 2, 11, 14);
  const next = correctWorkoutDate(training, original.id, original.finishedAt!, '2026-03-08', now);
  const [first, moved] = next.history;
  assert.equal(first, other);
  assert.ok(moved?.finishedAt);
  assert.equal(moved.id, original.id);
  assert.equal(dateKey(new Date(moved.finishedAt)), '2026-03-08');
  assert.equal(dateKey(new Date(moved.startedAt)), '2026-03-07');
  assert.equal(moved.exercises, original.exercises);
  assert.deepEqual(workoutTotals(moved, +now), workoutTotals(original, +now));
  assert.deepEqual(parseWorkspaceValue('training', JSON.parse(JSON.stringify(next))), next);
  assert.equal(correctWorkoutDate(next, moved.id, moved.finishedAt, '2026-03-08', now), next);
  assert.throws(() => correctWorkoutDate(next, moved.id, original.finishedAt!, '2026-03-07', now), /changed/);
  assert.throws(() => correctWorkoutDate(training, original.id, original.finishedAt!, '2026-02-29', now), /valid date/);
  assert.throws(() => correctWorkoutDate(training, original.id, original.finishedAt!, '2026-03-12', now), /today or earlier/);
});

test('program creation selects the first program, validates entry, and copies without reusing identities', () => {
  const { createId, data, program, day } = fixture();
  assert.equal(data.activeProgramId, program.id);
  assert.equal(dayForToday(program, new Date(2026, 1, 16))?.id, day.id);
  assert.equal(dayForToday(program, new Date(2026, 1, 17)), undefined);
  assert.throws(() => saveProgram(data, makeProgram(createId)), /Program name/);
  assert.throws(() => saveProgram(data, { ...program, name: 'A', days: [{ ...day, exercises: [] }] }), /one exercise/);
  assert.throws(() => saveProgram(data, { ...program, days: [{ ...day, weekday: 7 }] }), /Weekday/);
  const copy = duplicateProgram(program, createId);
  assert.notEqual(copy.id, program.id);
  assert.notEqual(copy.days[0]?.id, day.id);
  assert.notEqual(copy.days[0]?.exercises[0]?.id, day.exercises[0]?.id);
  assert.equal(saveProgram(data, copy).activeProgramId, program.id);
});

test('workout edits and deadline survive JSON reload, honor exact elapsed time and save once', () => {
  const { createId, data, program, day, exercise } = fixture();
  const workoutId = createId();
  const setId = createId();
  const running = startWorkout(data, program.id, day.id, workoutId, start);
  assert.throws(() => startWorkout(running, program.id, day.id, createId(), start), /active workout/);
  assert.throws(() => finishWorkout(running, workoutId, start), /Log at least one set/);
  const recorded = setWorkoutLog(running, exercise.id, { id: setId, reps: 10, grams: 22_500 }, start + 40_000);
  const recovered = parseWorkspaceValue('training', JSON.parse(JSON.stringify(recorded)));
  assert.ok(recovered?.session);
  assert.equal(recovered.session.id, workoutId);
  assert.equal(recovered.session.exercises[0]?.logged[0]?.grams, 22_500);
  assert.equal(restRemaining(recovered.session.restEndsAt, start + 45_500), 85);

  const corrected = setWorkoutLog(recovered, exercise.id, { id: setId, reps: 9, grams: 25_000 }, start + 46_000);
  assert.equal(corrected.session?.restEndsAt, recovered.session.restEndsAt);
  assert.equal(corrected.session?.exercises[0]?.logged.length, 1);
  const extended = changeRest(corrected, start + 50_000, 'extend');
  assert.equal(restRemaining(extended.session?.restEndsAt, start + 50_000), 95);
  assert.equal(restRemaining(extended.session?.restEndsAt, start + 145_000), 0);
  const fractionalExtension = changeRest(corrected, start + 50_500, 'extend');
  assert.equal(fractionalExtension.session?.restEndsAt, extended.session?.restEndsAt);
  assert.equal(changeRest(extended, start + 50_000, 'skip').session?.restEndsAt, null);

  const finished = finishWorkout(extended, workoutId, start + 180_000);
  const [saved] = finished.history;
  assert.ok(saved);
  assert.equal(finished.session, null);
  assert.equal(saved.restEndsAt, null);
  assert.deepEqual(workoutTotals(saved, start + 240_000), { planned: 9, seconds: 180, sets: 1, volume: 225_000 });
  assert.equal(finishWorkout(finished, workoutId, start + 250_000), finished);
  const revision = updatePastSet(finished, workoutId, exercise.id, { id: setId, reps: 8, grams: 25_000 });
  assert.equal(revision.history[0]?.finishedAt, saved.finishedAt);
  assert.equal(revision.history[0]?.exercises[0]?.logged[0]?.reps, 8);
  assert.equal(saved.exercises[0]?.logged[0]?.reps, 9);
});

test('plan changes and session-specific substitutions stay isolated from history', () => {
  const { createId, data, program, day, exercise } = fixture();
  const workoutId = createId();
  const session = startWorkout(data, program.id, day.id, workoutId, start);
  const replacement = setWorkoutExercise(session, exercise.id, 'Front squat');
  assert.equal(replacement.programs[0]?.days[0]?.exercises[0]?.name, exercise.name);
  const setId = createId();
  const recorded = setWorkoutLog(replacement, exercise.id, { id: setId, reps: 8, grams: 40_000 }, start);
  assert.throws(() => setWorkoutExercise(recorded, exercise.id, 'Leg press'), /logged sets/);
  const reversed = removeWorkoutLog(recorded, exercise.id, setId);
  assert.equal(reversed.session?.exercises[0]?.logged.length, 0);
  assert.throws(() => deleteProgram(recorded, program.id), /active workout/);
  const editedProgram = { ...program, days: [{ ...day, exercises: [{ ...exercise, name: 'Leg press' }] }] };
  const updated = saveProgram(recorded, editedProgram);
  assert.equal(updated.session?.exercises[0]?.name, 'Front squat');
  const finished = finishWorkout(updated, workoutId, start + 45_000);
  assert.equal(finished.history[0]?.exercises[0]?.name, 'Front squat');
  assert.equal(finished.programs[0]?.days[0]?.exercises[0]?.name, 'Leg press');
  const deleted = deleteProgram(finished, program.id);
  assert.equal(deleted.activeProgramId, null);
  assert.equal(deleted.programs.length, 0);
  assert.equal(deleted.history[0]?.id, workoutId);
});

test('log inputs reject coercion and round-trip grams in each unit', () => {
  assert.equal(parseLoad('22,5', 'kg'), 22_500);
  assert.equal(parseLoad('45', 'lb'), 20_412);
  assert.equal(parseLoad(String(displayLoad(40_001, 'lb')), 'lb'), 40_001);
  assert.equal(parseLoad('0', 'kg'), 0);
  for (const invalid of ['', '-1', 'Infinity', '1e2', '2500', '12.3456']) {
    assert.throws(() => parseLoad(invalid, 'kg'), /Enter a weight/);
  }
  assert.equal(parseReps(' 12 '), 12);
  for (const invalid of ['', '0', '1.1', '2e0', '1001']) {
    assert.throws(() => parseReps(invalid), /Reps/);
  }
});
