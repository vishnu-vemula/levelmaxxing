import type { LoggedSet, PlanExercise, Program, TrainingData, TrainingDay, Workout } from '@levelmaxing/contracts';
import { dateKey, fromDateKey, selectedDate } from '../../shared/local-date.ts';

export const MAX_PROGRAMS = 100;
export const MAX_DAYS = 30;
export const MAX_EXERCISES = 70;
export const MAX_SETS = 100;
export const MAX_REPS = 1000;
export const MAX_REST_SECONDS = 3600;
export const MAX_LOAD_GRAMS = 2_000_000;
export const MAX_NAME_LENGTH = 120;

export const emptyTraining: TrainingData = {
  programs: [], activeProgramId: null, session: null, history: [],
};

type IdFactory = () => string;
type ExercisePrescription = Pick<PlanExercise, 'name' | 'sets' | 'reps' | 'restSeconds'>;

export const starterRoutines = [
  {
    name: 'Dumbbell full body',
    days: [
      [1, 'Full Body A', [
        ['Goblet squat', 3, 8, 90],
        ['Dumbbell bench press', 3, 10, 90],
        ['One-arm dumbbell row', 3, 10, 90],
      ]],
      [4, 'Full Body B', [
        ['Dumbbell Romanian deadlift', 3, 8, 90],
        ['Dumbbell shoulder press', 3, 10, 90],
        ['Reverse lunge', 3, 8, 60],
      ]],
    ],
  },
  {
    name: 'Barbell upper / lower',
    days: [
      [1, 'Upper', [
        ['Barbell bench press', 3, 6, 120],
        ['Barbell row', 3, 8, 90],
        ['Dumbbell shoulder press', 3, 10, 90],
      ]],
      [4, 'Lower', [
        ['Back squat', 3, 6, 120],
        ['Dumbbell Romanian deadlift', 3, 8, 90],
        ['Reverse lunge', 3, 8, 60],
      ]],
    ],
  },
] as const;

export function makeProgram(createId: IdFactory, template?: (typeof starterRoutines)[number]): Program {
  const id = createId();
  if (!template) return { id, name: '', days: [makeDay(createId, 1)] };
  return {
    id,
    name: template.name,
    days: template.days.map(([weekday, name, prescriptions]) => ({
      id: createId(), name, weekday,
      exercises: prescriptions.map(([exercise, sets, reps, restSeconds]) => ({
        id: createId(), name: exercise, sets, reps, restSeconds,
      })),
    })),
  };
}

export function makeDay(createId: IdFactory, number: number): TrainingDay {
  return { id: createId(), name: `Day ${number}`, exercises: [makeExercise(createId)] };
}

export function makeExercise(createId: IdFactory): PlanExercise {
  return { id: createId(), name: '', sets: 3, reps: 8, restSeconds: 90 };
}

export function alternativesFor(name: string): readonly string[] {
  const equivalents = [
    ['Back squat', 'Goblet squat', 'Front squat', 'Leg press'],
    ['Barbell bench press', 'Dumbbell bench press', 'Machine chest press', 'Push-up'],
    ['Barbell row', 'One-arm dumbbell row', 'Seated cable row', 'Chest-supported dumbbell row'],
    ['Romanian deadlift', 'Dumbbell Romanian deadlift', 'Barbell Romanian deadlift'],
    ['Dumbbell shoulder press', 'Seated barbell overhead press', 'Machine shoulder press'],
    ['Reverse lunge', 'Split squat', 'Step-up'],
  ];
  const key = name.trim().toLowerCase();
  return equivalents.find((group) => group.some((item) => item.toLowerCase() === key))
    ?.filter((item) => item.toLowerCase() !== key) ?? [];
}

export function validateProgram(program: Program): Program {
  const name = cleanName(program.name, 'Program name');
  if (!program.days.length) throw new Error('Add at least one training day.');
  if (program.days.length > MAX_DAYS) throw new Error(`A program can have up to ${MAX_DAYS} days.`);
  const days = program.days.map((day) => {
    const dayName = cleanName(day.name, 'Training day name');
    if (!day.exercises.length) throw new Error(`Add at least one exercise to ${dayName}.`);
    if (day.exercises.length > MAX_EXERCISES) {
      throw new Error(`${dayName} can have up to ${MAX_EXERCISES} exercises.`);
    }
    if (day.weekday !== undefined) boundedInteger(day.weekday, 0, 6, 'Weekday');
    return {
      ...day,
      name: dayName,
      exercises: day.exercises.map((exercise) => normalizePrescription(exercise)),
    };
  });
  return { ...program, name, days };
}

export function saveProgram(data: TrainingData, draft: Program): TrainingData {
  const program = validateProgram(draft);
  const exists = data.programs.some(({ id }) => id === program.id);
  if (!exists && data.programs.length >= MAX_PROGRAMS) {
    throw new Error(`You can save up to ${MAX_PROGRAMS} training programs.`);
  }
  return {
    ...data,
    programs: exists
      ? data.programs.map((item) => item.id === program.id ? program : item)
      : [...data.programs, program],
    activeProgramId: data.activeProgramId ?? program.id,
  };
}

export function deleteProgram(data: TrainingData, programId: string): TrainingData {
  if (data.session?.programId === programId) {
    throw new Error('Finish or discard the active workout before deleting this program.');
  }
  const programs = data.programs.filter(({ id }) => id !== programId);
  const activeProgramId = data.activeProgramId === programId ? programs[0]?.id ?? null : data.activeProgramId;
  return { ...data, programs, activeProgramId };
}

export function duplicateProgram(program: Program, createId: IdFactory): Program {
  const suffix = ' copy';
  return {
    id: createId(),
    name: `${program.name.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`,
    days: program.days.map((day) => ({
      ...day,
      id: createId(),
      exercises: day.exercises.map((exercise) => ({ ...exercise, id: createId() })),
    })),
  };
}

export function dayForToday(program: Program, now: Date): TrainingDay | undefined {
  return program.days.find((day) => day.weekday === now.getDay());
}

export function startWorkout(
  data: TrainingData, programId: string, dayId: string, workoutId: string, now: number,
): TrainingData {
  if (data.session) throw new Error('Finish or resume your active workout first.');
  const program = data.programs.find(({ id }) => id === programId);
  const day = program?.days.find(({ id }) => id === dayId);
  if (!day) throw new Error('This training day is no longer available.');
  return {
    ...data,
    session: {
      id: workoutId,
      name: day.name,
      programId,
      dayId,
      startedAt: new Date(now).toISOString(),
      finishedAt: null,
      restEndsAt: null,
      exercises: day.exercises.map((exercise) => ({ ...exercise, logged: [] })),
    },
  };
}

export function setWorkoutExercise(data: TrainingData, exerciseId: string, replacement: string): TrainingData {
  const session = activeWorkout(data);
  const name = cleanName(replacement, 'Exercise name');
  const current = session.exercises.find(({ id }) => id === exerciseId);
  if (!current) throw new Error('This exercise is no longer available.');
  if (current.logged.length) throw new Error('Finish or remove the logged sets before swapping this exercise.');
  return {
    ...data,
    session: {
      ...session,
      exercises: session.exercises.map((exercise) => exercise.id === exerciseId ? { ...exercise, name } : exercise),
    },
  };
}

export function setWorkoutLog(data: TrainingData, exerciseId: string, set: LoggedSet, now: number): TrainingData {
  const session = activeWorkout(data);
  const exercise = session.exercises.find(({ id }) => id === exerciseId);
  if (!exercise) throw new Error('This exercise is no longer available.');
  boundedInteger(set.reps, 1, MAX_REPS, 'Reps');
  boundedInteger(set.grams, 0, MAX_LOAD_GRAMS, 'Weight');
  const editing = exercise.logged.some(({ id }) => id === set.id);
  if (!editing && exercise.logged.length >= MAX_SETS) {
    throw new Error(`This exercise already has ${MAX_SETS} logged sets.`);
  }
  const logged = editing
    ? exercise.logged.map((previous) => previous.id === set.id ? set : previous)
    : [...exercise.logged, set];
  const restEndsAt = editing
    ? session.restEndsAt
    : exercise.restSeconds === 0 ? null : new Date(now + exercise.restSeconds * 1_000).toISOString();
  return {
    ...data,
    session: {
      ...session, restEndsAt,
      exercises: session.exercises.map((item) => item.id === exerciseId ? { ...item, logged } : item),
    },
  };
}

export function removeWorkoutLog(data: TrainingData, exerciseId: string, setId: string): TrainingData {
  const session = activeWorkout(data);
  return {
    ...data,
    session: {
      ...session,
      exercises: session.exercises.map((exercise) => exercise.id === exerciseId
        ? { ...exercise, logged: exercise.logged.filter(({ id }) => id !== setId) }
        : exercise),
    },
  };
}

export function changeRest(data: TrainingData, now: number, action: 'extend' | 'skip'): TrainingData {
  const session = activeWorkout(data);
  const deadline = session.restEndsAt ? Date.parse(session.restEndsAt) : 0;
  const restEndsAt = action === 'extend' && deadline > now
    ? new Date(Math.min(deadline + 15_000, now + MAX_REST_SECONDS * 1_000)).toISOString()
    : null;
  return { ...data, session: { ...session, restEndsAt } };
}

export function restRemaining(deadline: string | null | undefined, now: number): number {
  if (!deadline) return 0;
  const remaining = Date.parse(deadline) - now;
  return Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining / 1_000)) : 0;
}

export function workoutTotals(workout: Workout, now: number) {
  let sets = 0;
  let volume = 0;
  let planned = 0;
  for (const exercise of workout.exercises) {
    planned += exercise.sets;
    sets += exercise.logged.length;
    for (const set of exercise.logged) volume += set.grams * set.reps;
  }
  const end = workout.finishedAt ? Date.parse(workout.finishedAt) : now;
  const seconds = Math.max(0, Math.floor((end - Date.parse(workout.startedAt)) / 1_000));
  return { sets, volume, planned, seconds };
}

export function finishWorkout(data: TrainingData, workoutId: string, now: number): TrainingData {
  if (data.history.some(({ id }) => id === workoutId)) return data;
  const session = activeWorkout(data);
  if (session.id !== workoutId) throw new Error('This workout is no longer active.');
  if (!workoutTotals(session, now).sets) throw new Error('Log at least one set before you finish.');
  const finishedAt = new Date(Math.max(now, Date.parse(session.startedAt))).toISOString();
  return {
    ...data, session: null,
    history: [{ ...session, finishedAt, restEndsAt: null }, ...data.history],
  };
}

export function parseReps(value: string): number {
  const reps = /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return boundedInteger(reps, 1, MAX_REPS, 'Reps');
}

export type WeightUnit = 'kg' | 'lb';
const gramsPerUnit: Record<WeightUnit, number> = { kg: 1_000, lb: 453.59237 };

export function displayLoad(grams: number, unit: WeightUnit): number {
  return Math.round(grams / gramsPerUnit[unit] * 1_000) / 1_000;
}

export function parseLoad(value: string, unit: WeightUnit): number {
  const input = value.trim().replace(',', '.');
  const grams = /^\d+(\.\d{1,3})?$/.test(input) ? Math.round(Number(input) * gramsPerUnit[unit]) : NaN;
  if (!Number.isSafeInteger(grams) || grams > MAX_LOAD_GRAMS) {
    throw new Error(`Enter a weight from 0 to ${displayLoad(MAX_LOAD_GRAMS, unit)} ${unit}.`);
  }
  return grams;
}

export function updatePastSet(data: TrainingData, workoutId: string, exerciseId: string, set: LoggedSet): TrainingData {
  boundedInteger(set.reps, 1, MAX_REPS, 'Reps');
  boundedInteger(set.grams, 0, MAX_LOAD_GRAMS, 'Weight');
  const workout = data.history.find(({ id }) => id === workoutId);
  const exercise = workout?.exercises.find(({ id }) => id === exerciseId);
  if (!workout || !exercise?.logged.some(({ id }) => id === set.id)) {
    throw new Error('This logged set is no longer available.');
  }
  const corrected = {
    ...workout,
    exercises: workout.exercises.map((item) => item.id === exerciseId
      ? { ...item, logged: item.logged.map((previous) => previous.id === set.id ? set : previous) } : item),
  };
  return { ...data, history: data.history.map((item) => item.id === workoutId ? corrected : item) };
}

export function correctWorkoutDate(data: TrainingData, workoutId: string, expectedFinish: string, input: string, now: Date): TrainingData {
  const day = selectedDate(input.trim(), '');
  if (!day || day > dateKey(now)) throw new Error('Enter a valid date that is today or earlier.');
  const target = data.history.find(({ id }) => id === workoutId);
  if (!target?.finishedAt || target.finishedAt !== expectedFinish) {
    throw new Error('The workout date changed. Close the editor and try again.');
  }
  const finish = new Date(target.finishedAt);
  if (dateKey(finish) === day) return data;

  const nextFinish = fromDateKey(day);
  nextFinish.setHours(finish.getHours(), finish.getMinutes(), finish.getSeconds(), finish.getMilliseconds());
  if (dateKey(nextFinish) !== day) throw new Error('The original finish time is unavailable on that date.');
  const end = Math.min(nextFinish.valueOf(), now.valueOf());
  const duration = Math.max(0, finish.valueOf() - Date.parse(target.startedAt));
  const startedAt = new Date(end - duration).toISOString();
  if (startedAt.length !== 24) throw new Error('This date is outside the supported range for the workout.');
  const corrected = { ...target, startedAt, finishedAt: new Date(end).toISOString() };
  const history = data.history.map((item) => item.id === workoutId ? corrected : item);
  history.sort((left, right) => (right.finishedAt ?? right.startedAt).localeCompare(left.finishedAt ?? left.startedAt));
  return { ...data, history };
}

export function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export const workoutShareFields = ['name', 'date', 'duration', 'sets', 'volume'] as const;
export type WorkoutShareField = typeof workoutShareFields[number];

export function workoutShareContent(details: Record<WorkoutShareField, string>, selected: ReadonlySet<WorkoutShareField>) {
  const fields = workoutShareFields.filter((field) => selected.has(field));
  if (!fields.length) return;
  return { title: selected.has('name') ? details.name : 'Workout summary', message: fields.map((field) => details[field]).join('\n') };
}

function activeWorkout(data: TrainingData): Workout {
  if (!data.session) throw new Error('There is no active workout.');
  return data.session;
}

function normalizePrescription<T extends ExercisePrescription>(exercise: T): T {
  return {
    ...exercise,
    name: cleanName(exercise.name, 'Exercise name'),
    sets: boundedInteger(exercise.sets, 1, MAX_SETS, 'Sets'),
    reps: boundedInteger(exercise.reps, 1, MAX_REPS, 'Reps'),
    restSeconds: boundedInteger(exercise.restSeconds, 0, MAX_REST_SECONDS, 'Rest seconds'),
  };
}

function cleanName(value: string, label: string) {
  const name = value.trim();
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new Error(`${label} must contain 1 to ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
}

function boundedInteger(value: number, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}
