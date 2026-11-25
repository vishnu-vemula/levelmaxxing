import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import type { FoodLog, Recipe } from '@levelmaxing/contracts';
import { codeFromSource, findBarcode, foodGroups, groceryShareText, groceryTotals, labelNutrition, readBarcode, readMacros, readPrice,
  recentFoods, recipePortion, sameFoodLog, sameGrocery, sameRecipe, selectedDate, shiftDate, sumMacros, weekDays } from './model.ts';

const macros = { calories: 180, protein: 16, carbs: 8, fat: 10 };
const meal: FoodLog = { id: 'log-1', name: 'Yogurt', date: '2026-11-23', meal: 'Breakfast', quantity: 2,
  unit: 'serving', macros, source: 'Package label · 4006381333931' };

test('diary groups snapshots by local calendar date across month and leap boundaries', () => {
  const rows: FoodLog[] = [meal, { ...meal, id: 'log-2', meal: 'Lunch' }, { ...meal, id: 'log-3', date: '2026-11-24' }];
  const groups = foodGroups(rows, '2026-11-23');
  equal(groups.Breakfast.length, 1);
  equal(groups.Lunch.length, 1);
  equal(groups.Dinner.length, 0);
  deepEqual(sumMacros([...groups.Breakfast, ...groups.Lunch].map(({ macros }) => macros)),
    { calories: 360, protein: 32, carbs: 16, fat: 20 });
  equal(shiftDate('2024-03-01', -1), '2024-02-29');
  equal(selectedDate('2025-02-29', '2025-01-01'), '2025-01-01');
  equal(selectedDate(['2025-02-09'], '2025-01-01'), '2025-01-01');
  deepEqual(weekDays('2026-01-01').map(({ key }) => key), [
    '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04',
  ]);
});

test('logged recipe portions sum full ingredient amounts then divide by yield', () => {
  const recipe: Recipe = { id: 'recipe', name: 'Yogurt bowl', servings: 3,
    ingredients: [{ id: 'a', name: 'Yogurt', amount: '2 cups', macros },
      { id: 'b', name: 'Granola', amount: '100 g', macros: { calories: 420, protein: 14, carbs: 48, fat: 12 } }] };
  const portion = recipePortion(recipe, 1.5);
  deepEqual(portion, { calories: 300, protein: 15, carbs: 28, fat: 11 });
  recipe.servings = 4;
  equal(portion.calories, 300);
  equal(recipePortion(recipe, 1.5).calories, 225);
});

test('recent matching returns the newest personal snapshot and recognizes exact valid barcodes', () => {
  const latest = { ...meal, id: 'log-2', quantity: 1 };
  equal(readBarcode('4006381333931'), '4006381333931');
  equal(readBarcode('04006381333931'), '04006381333931');
  equal(readBarcode('4006381333932'), undefined);
  equal(codeFromSource('Manual entry · 4006381333931'), undefined);
  deepEqual(recentFoods([meal, latest], 'yog'), [latest]);
  deepEqual(recentFoods([meal, latest], '4006381333931'), [latest]);
  equal(findBarcode([meal, latest, { ...meal, name: '4006381333931', source: 'Manual entry' }], '04006381333931'), latest);
});

test('label conversion keeps nutrient grams and scales energy and grams by the actual amount eaten', () => {
  const { calories, ...grams } = labelNutrition({ calories: 836.8, protein: 10, carbs: 20, fat: 14 }, 75, 100, 'kJ');
  ok(Math.abs(calories - 150) < 1e-9);
  deepEqual(grams, { protein: 7.5, carbs: 15, fat: 10.5 });
});

test('draft guards ignore identical copies and detect remote edits or removal', () => {
  equal(sameFoodLog(meal, { ...meal, macros: { ...meal.macros } }), true);
  equal(sameFoodLog(meal, { ...meal, quantity: 3 }), false);
  equal(sameFoodLog(meal, undefined), false);
  const recipe: Recipe = { id: 'recipe', name: 'Yogurt', servings: 2,
    ingredients: [{ id: 'ingredient', name: 'Yogurt', amount: '400 g', macros }] };
  equal(sameRecipe(recipe, { ...recipe, ingredients: recipe.ingredients.map((ingredient) => ({ ...ingredient })) }), true);
  equal(sameRecipe(recipe, { ...recipe, ingredients: [{ ...recipe.ingredients[0]!, amount: '700 g' }] }), false);
  equal(sameRecipe(recipe, undefined), false);
  const grocery = { id: 'grocery', name: 'Yogurt', amount: '400 g', checked: false, priceCents: null, store: '' };
  equal(sameGrocery(grocery, { ...grocery }), true);
  equal(sameGrocery(grocery, { ...grocery, checked: true }), false);
  equal(sameGrocery(grocery, undefined), false);
});

test('macros distinguish explicit zero from missing values and prices preserve cents', () => {
  deepEqual(readMacros({ calories: '90', protein: '8,5', carbs: '0', fat: '10' }),
    { calories: 90, protein: 8.5, carbs: 0, fat: 10 });
  equal(readMacros({ calories: '', protein: '0', carbs: '0', fat: '0' }), undefined);
  equal(readPrice(''), null);
  equal(readPrice('0'), 0);
  equal(readPrice('2.13'), 213);
  equal(readPrice('2.125'), undefined);
  equal(readPrice('1e3'), undefined);
  deepEqual(groceryTotals([
    { id: 'known', name: 'Oats', amount: '200 g', checked: true, priceCents: 213, store: 'Local shop' },
    { id: 'unknown', name: 'Fruit', amount: '200 g', checked: false, priceCents: null, store: '' },
  ]), { checked: 1, priced: 1, cents: 213 });
  equal(groceryShareText([
    { id: 'known', name: 'Oats', amount: '200 g', checked: true, priceCents: 213, store: 'Local shop' },
    { id: 'unknown', name: 'Fruit', amount: '200 g', checked: false, priceCents: null, store: '' },
  ]), 'Grocery list\n\n• Fruit · 200 g');
});
