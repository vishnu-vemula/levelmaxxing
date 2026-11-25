import type { FoodLog, Grocery, MacroAmount, NutritionData, Recipe } from '@levelmaxing/contracts';
import { dateKey, fromDateKey, selectedDate } from '../../shared/local-date.ts';

export { dateKey, selectedDate };

export const mealNames = ['Breakfast', 'Lunch', 'Dinner', 'Snack'] as const;
export const macroKeys = ['calories', 'protein', 'carbs', 'fat'] as const;
export const macroLabels = { calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' } satisfies Record<keyof MacroAmount, string>;
export type MealName = FoodLog['meal'];
export type MacroForm = Record<keyof MacroAmount, string>;
const amountFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function mealName(value?: string): MealName {
  return mealNames.find((meal) => meal === value) ?? 'Snack';
}

export function shiftDate(value: string, days: number): string {
  const date = fromDateKey(value);
  date.setDate(date.getDate() + days);
  const shifted = dateKey(date);
  return selectedDate(shifted, value);
}

export function weekDays(value: string): { key: string; weekday: string; day: number; label: string }[] {
  const date = fromDateKey(value);
  const offset = (date.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => shiftDate(value, index - offset))
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .map((key) => {
      const day = fromDateKey(key);
      return { key, weekday: day.toLocaleDateString(undefined, { weekday: 'short' }), day: day.getDate(), label: fullDate(key) };
    });
}

export function fullDate(value: string): string {
  return fromDateKey(value).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function parseAmount(raw: string, maximum: number, minimum = 0): number | undefined {
  const value = raw.trim();
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value)) return;
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : undefined;
}

export function readMacros(form: MacroForm): MacroAmount | undefined {
  const calories = parseAmount(form.calories, 1_000_000);
  const protein = parseAmount(form.protein, 100_000);
  const carbs = parseAmount(form.carbs, 100_000);
  const fat = parseAmount(form.fat, 100_000);
  if (calories === undefined || protein === undefined || carbs === undefined || fat === undefined) return;
  return { calories, protein, carbs, fat };
}

export function supportedMacros(value: MacroAmount): boolean {
  return macroKeys.every((key) => Number.isFinite(value[key]) && value[key] >= 0 &&
    value[key] <= (key === 'calories' ? 1_000_000 : 100_000));
}

export function displayAmount(amount: number): string {
  return amountFormat.format(amount);
}

export function macroForm(value?: MacroAmount): MacroForm {
  return {
    calories: value === undefined ? '' : String(Number(value.calories.toFixed(6))),
    protein: value === undefined ? '' : String(Number(value.protein.toFixed(6))),
    carbs: value === undefined ? '' : String(Number(value.carbs.toFixed(6))),
    fat: value === undefined ? '' : String(Number(value.fat.toFixed(6))),
  };
}

export function sameMacroForm(left: MacroForm, right: MacroForm): boolean {
  return macroKeys.every((key) => left[key] === right[key]);
}

function sameMacros(left: MacroAmount, right: MacroAmount): boolean {
  return macroKeys.every((key) => left[key] === right[key]);
}

export function sameFoodLog(left: FoodLog, right: FoodLog | undefined): boolean {
  return Boolean(right && left.id === right.id && left.name === right.name && left.date === right.date
    && left.meal === right.meal && left.quantity === right.quantity && left.unit === right.unit
    && left.source === right.source && sameMacros(left.macros, right.macros));
}

export function sameRecipe(left: Recipe, right: Recipe | undefined): boolean {
  return Boolean(right && left.id === right.id && left.name === right.name && left.servings === right.servings
    && left.ingredients.length === right.ingredients.length && left.ingredients.every((ingredient, index) => {
      const current = right.ingredients[index];
      return current && ingredient.id === current.id && ingredient.name === current.name
        && ingredient.amount === current.amount && sameMacros(ingredient.macros, current.macros);
    }));
}

export function sameGrocery(left: Grocery, right: Grocery | undefined): boolean {
  return Boolean(right && left.id === right.id && left.name === right.name && left.amount === right.amount
    && left.checked === right.checked && left.priceCents === right.priceCents && left.store === right.store);
}

export function sumMacros(values: readonly MacroAmount[]): MacroAmount {
  const result = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const value of values) {
    result.calories += value.calories;
    result.protein += value.protein;
    result.carbs += value.carbs;
    result.fat += value.fat;
  }
  return result;
}

export function scaleMacros(value: MacroAmount, factor: number): MacroAmount {
  return { calories: value.calories * factor, protein: value.protein * factor, carbs: value.carbs * factor, fat: value.fat * factor };
}

export function labelNutrition(value: MacroAmount, amount: number, basis: number, energy: 'kcal' | 'kJ'): MacroAmount {
  return scaleMacros({ ...value, calories: energy === 'kJ' ? value.calories / 4.184 : value.calories }, amount / basis);
}

export function recipePortion(recipe: Recipe, servings: number): MacroAmount {
  return scaleMacros(sumMacros(recipe.ingredients.map((ingredient) => ingredient.macros)), servings / recipe.servings);
}

export function foodGroups(rows: readonly FoodLog[], date: string) {
  const groups: Record<MealName, FoodLog[]> = { Breakfast: [], Lunch: [], Dinner: [], Snack: [] };
  for (const row of rows) {
    if (row.date === date) groups[row.meal].push(row);
  }
  return groups;
}

export function copyFoodLogs(value: NutritionData, selected: readonly FoodLog[], { date, meal }: { date: string; meal: MealName },
  createId: () => string): NutritionData | undefined {
  if (!selected.length || !selectedDate(date, '') || !mealNames.includes(meal)) return;
  const current = new Map(value.meals.map((entry) => [entry.id, entry]));
  if (!selected.every((entry) => sameFoodLog(entry, current.get(entry.id)))) return;
  const copies = selected.map((entry) => ({ ...entry, date, meal, id: createId(), macros: { ...entry.macros } }));
  return { ...value, meals: [...value.meals, ...copies] };
}

export function recentFoods(rows: readonly FoodLog[], query: string, count = 12): FoodLog[] {
  const normalized = query.trim().toLocaleLowerCase();
  const seen = new Set<string>();
  const results: FoodLog[] = [];
  for (let i = rows.length - 1; i >= 0 && results.length < count; i -= 1) {
    const row = rows[i]!;
    if (normalized && !row.name.toLocaleLowerCase().includes(normalized)
      && codeFromSource(row.source) !== normalized) continue;
    const key = [row.name.toLocaleLowerCase(), row.unit.toLocaleLowerCase(), codeFromSource(row.source)].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(row);
  }
  return results;
}

export function readBarcode(raw: string): string | undefined {
  const digits = raw.trim();
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return;
  let total = 0;
  for (let index = digits.length - 2, weight = 3; index >= 0; index -= 1, weight = 4 - weight) {
    total += Number(digits[index]) * weight;
  }
  return (10 - total % 10) % 10 === Number(digits.at(-1)) ? digits : undefined;
}

export function codeFromSource(source: string): string | undefined {
  return source.startsWith('Package label · ') ? readBarcode(source.slice('Package label · '.length)) : undefined;
}

export function findBarcode(rows: readonly FoodLog[], raw: string): FoodLog | undefined {
  const barcode = readBarcode(raw)?.padStart(14, '0');
  if (!barcode) return;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (codeFromSource(row.source)?.padStart(14, '0') === barcode) return row;
  }
}

export function readPrice(raw: string): number | null | undefined {
  if (!raw.trim()) return null;
  const value = raw.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 100_000_000 ? cents : undefined;
}

export function groceryTotals(items: readonly Grocery[]) {
  return items.reduce((totals, item) => ({
    checked: totals.checked + Number(item.checked),
    priced: totals.priced + Number(item.priceCents !== null),
    cents: totals.cents + (item.priceCents ?? 0),
  }), { checked: 0, priced: 0, cents: 0 });
}

export function recipeShareText(recipe: Recipe): string {
  return [recipe.name, `Yield: ${displayAmount(recipe.servings)} servings`, '',
    ...recipe.ingredients.map(({ name, amount }) => `${amount} ${name}`)].join('\n');
}

export function groceryShareText(items: readonly Grocery[]): string {
  return ['Grocery list', '', ...items.filter(({ checked }) => !checked).map(({ name, amount }) => `• ${name} · ${amount}`)].join('\n');
}
