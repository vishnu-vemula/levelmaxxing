import { isEpoch, isUuid, objectValue } from './index.ts';

export const WORKSPACE_MAX_BYTES = 256 * 1024;
export const workspaceSections = ['profile', 'training', 'nutrition', 'journal'] as const;
export type WorkspaceSection = typeof workspaceSections[number];

export type ProfileData = {
  name: string; goal: string; experience: string; equipment: string[]; weekdays: string[];
  minutes: number; muscles: string[]; calories: number | null; units: 'kg' | 'lb'; onboarded: boolean;
};
export type TrainingData = { programs: Program[]; activeProgramId: string | null; session: Workout | null; history: Workout[] };
export type Program = { id: string; name: string; days: TrainingDay[] };
export type TrainingDay = { id: string; name: string; exercises: PlanExercise[]; weekday?: number };
export type PlanExercise = { id: string; name: string; sets: number; reps: number; restSeconds: number };
export type Workout = {
  id: string; name: string; programId: string; dayId: string; startedAt: string; finishedAt: string | null;
  exercises: WorkoutExercise[]; restEndsAt?: string | null;
};
export type WorkoutExercise = PlanExercise & { logged: LoggedSet[] };
export type LoggedSet = { id: string; reps: number; grams: number };

export type MacroAmount = { calories: number; protein: number; carbs: number; fat: number };
export type NutritionData = { meals: FoodLog[]; recipes: Recipe[]; groceries: Grocery[] };
export type FoodLog = {
  id: string; name: string; date: string; meal: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';
  quantity: number; unit: string; macros: MacroAmount; source: string;
};
export type Recipe = { id: string; name: string; servings: number; ingredients: RecipeIngredient[] };
export type RecipeIngredient = { id: string; name: string; amount: string; macros: MacroAmount };
export type Grocery = { id: string; name: string; amount: string; checked: boolean; priceCents: number | null; store: string };

export type JournalData = { checkIns: CheckIn[]; activities: Activity[]; bookmarks: string[] };
export type CheckIn = { id: string; date: string; hunger: number; energy: number; sleep: number; note: string };
export type Activity = { id: string; date: string; name: string; minutes: number };
export interface WorkspaceValues {
  profile: ProfileData;
  training: TrainingData;
  nutrition: NutritionData;
  journal: JournalData;
}
export type WorkspaceSnapshot<K extends WorkspaceSection = WorkspaceSection> = { version: number; value: WorkspaceValues[K] | null };
export type WorkspaceSave = { [K in WorkspaceSection]: { section: K; expect: number; operationId: string; value: WorkspaceValues[K] } }[WorkspaceSection];
export type WorkspaceSaveResult<K extends WorkspaceSection = WorkspaceSection> = { outcome: 'applied' | 'conflict'; snapshot: WorkspaceSnapshot<K> };

type Rule = (value: unknown) => boolean;
const string = (max: number, min = 0): Rule => (value) =>
  typeof value === 'string' && value.length >= min && value.length <= max && !/[\u0000\uD800-\uDFFF]/u.test(value) && (min === 0 || value.trim().length > 0);
const name = string(120, 1);
const number = (min: number, max: number, whole = false): Rule => (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isSafeInteger(value));
const integer = (min: number, max: number) => number(min, max, true);
const versionNumber = integer(0, Number.MAX_SAFE_INTEGER);
const nullable = (rule: Rule): Rule => (value) => value === null || rule(value);
const optional = (rule: Rule): Rule => (value) => value === undefined || rule(value);
const boolean: Rule = (value) => typeof value === 'boolean';
const oneOf = (...choices: string[]): Rule => (value) => typeof value === 'string' && choices.includes(value);
const list = (rule: Rule, max: number): Rule => (value) => Array.isArray(value) && value.length <= max && value.every(rule);
const entities = (rule: Rule, max: number): Rule => (value) =>
  Array.isArray(value) && value.length <= max && value.every(rule) && new Set(value.map((item: { id: string }) => item.id)).size === value.length;
function shape(fields: Record<string, Rule>): Rule {
  return (input) => {
    const record = objectValue(input);
    return record !== undefined && Object.keys(record).every((key) => Object.hasOwn(fields, key)) &&
      Object.entries(fields).every(([key, accepts]) => accepts(record[key]));
  };
}
const date: Rule = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const time = new Date(value + 'T00:00:00Z');
  return Number.isFinite(time.valueOf()) && time.toISOString().slice(0, 10) === value;
};
const instant: Rule = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = new Date(value);
  return Number.isFinite(time.valueOf()) && time.toISOString() === value;
};
const planExerciseFields = { id: isEpoch, name, sets: integer(1, 100), reps: integer(1, 1000), restSeconds: integer(0, 3600) };
const planExercise = shape(planExerciseFields);
const workoutExercise = shape({
  ...planExerciseFields,
  logged: entities(shape({ id: isEpoch, reps: integer(1, 1000), grams: integer(0, 2_000_000) }), 100),
});
const workout = shape({
  id: isEpoch, name, programId: isEpoch, dayId: isEpoch, startedAt: instant, finishedAt: nullable(instant),
  restEndsAt: optional(nullable(instant)), exercises: entities(workoutExercise, 70),
});
const macros = shape({
  calories: number(0, 1_000_000), protein: number(0, 100_000), carbs: number(0, 100_000), fat: number(0, 100_000),
});
const rules: Record<WorkspaceSection, Rule> = {
  profile: shape({
    name: string(120), goal: string(120), experience: string(120), equipment: list(name, 30), weekdays: list(name, 7),
    minutes: integer(0, 600), muscles: list(name, 30), calories: nullable(integer(1, 20_000)),
    units: oneOf('kg', 'lb'), onboarded: boolean,
  }),
  training: shape({
    activeProgramId: nullable(isEpoch), session: nullable(workout), history: entities(workout, 1200),
    programs: entities(shape({
      id: isEpoch, name, days: entities(shape({
        id: isEpoch, name, weekday: optional(integer(0, 6)), exercises: entities(planExercise, 70),
      }), 30),
    }), 100),
  }),
  nutrition: shape({
    meals: entities(shape({
      id: isEpoch, name, date, meal: oneOf('Breakfast', 'Lunch', 'Dinner', 'Snack'),
      quantity: number(0.000001, 1_000_000), unit: string(50, 1), macros, source: string(140, 1),
    }), 5000),
    recipes: entities(shape({
      id: isEpoch, name, servings: number(0.000001, 10_000),
      ingredients: entities(shape({ id: isEpoch, name, amount: string(120), macros }), 100),
    }), 200),
    groceries: entities(shape({
      id: isEpoch, name, amount: string(120), checked: boolean, priceCents: nullable(integer(0, 100_000_000)), store: string(120),
    }), 500),
  }),
  journal: shape({
    checkIns: entities(shape({
      id: isEpoch, date, hunger: integer(1, 5), energy: integer(1, 5), sleep: number(0, 24), note: string(2000),
    }), 1500),
    activities: entities(shape({ id: isEpoch, date, name, minutes: integer(1, 1440) }), 3000),
    bookmarks: list(isEpoch, 250),
  }),
};

export function parseWorkspaceSection(input: unknown): WorkspaceSection | undefined {
  return workspaceSections.find((section) => input === section);
}

export function parseWorkspaceValue<K extends WorkspaceSection>(section: K, input: unknown): WorkspaceValues[K] | undefined {
  if (rules[section](input)) return input as WorkspaceValues[K];
}

export function parseWorkspaceSnapshot<K extends WorkspaceSection>(section: K, input: unknown): WorkspaceSnapshot<K> | undefined {
  const raw = objectValue(input);
  if (!raw || !versionNumber(raw.version)) return;
  const version = raw.version as number;
  if (version === 0) return raw.value === null ? { version, value: null } : undefined;
  const value = parseWorkspaceValue(section, raw.value);
  if (value) return { version, value };
}

export function parseWorkspaceSave(input: unknown): WorkspaceSave | undefined {
  const raw = objectValue(input);
  const section = parseWorkspaceSection(raw?.section);
  if (!raw || !section || !versionNumber(raw.expect) || !isUuid(raw.operationId)) return;
  const value = parseWorkspaceValue(section, raw.value);
  if (value) return { section, expect: raw.expect, operationId: raw.operationId, value } as WorkspaceSave;
}

export function parseWorkspaceSaveResult<K extends WorkspaceSection>(section: K, input: unknown): WorkspaceSaveResult<K> | undefined {
  const raw = objectValue(input);
  if (!raw || (raw.outcome !== 'applied' && raw.outcome !== 'conflict')) return;
  const snapshot = parseWorkspaceSnapshot(section, raw.snapshot);
  if (snapshot) return { outcome: raw.outcome, snapshot };
}
