import { randomUUID } from '../../platform/native-storage.ts';
import { useLocalSearchParams, useRouter } from '../../shared/navigation.tsx';
import { useState } from 'react';
import { Alert, Share, View } from 'react-native';
import type { NutritionData, Recipe, RecipeIngredient } from '@levelmaxing/contracts';
import { Card, Screen, SectionTitle } from '../../shared/ui.tsx';
import { useWorkspace } from '../workspace/index.ts';
import { displayAmount, macroForm, parseAmount, readMacros, recentFoods, recipePortion, recipeShareText, sameMacroForm, sameRecipe,
  selectedDate, type MacroForm } from './model.ts';
import { Body, DraftNotice, FoodAction, FoodError, FoodField, FoodTitle, MacroBoard, MacroFields, foodLayout } from './ui.tsx';
import { useNutritionSave } from './useSave.ts';
import { emptyNutrition, NutritionLoading } from './workspace.tsx';

type OpenRecipe = { mode: 'new' } | { mode: 'existing'; original: Recipe; editorId: string };
type IngredientDraft = { id: string; name: string; amount: string; macros: MacroForm };

export function RecipesScreen() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const router = useRouter();
  const { value: current, status, save } = useWorkspace('nutrition');
  const value = current ?? emptyNutrition;
  const [open, setOpen] = useState<OpenRecipe>();
  const original = open?.mode === 'existing' ? open.original : undefined;
  const existing = original ? value.recipes.find(({ id }) => id === original.id) : undefined;

  function openRecipe(recipe: Recipe) {
    setOpen({ mode: 'existing', original: recipe, editorId: randomUUID() });
  }

  if (status === 'loading' || status === 'unavailable' || (!current && status === 'syncing')) {
    return <NutritionLoading title="Recipes & meals" unavailable={status === 'unavailable'} />;
  }
  if (open) {
    return <RecipeEditor key={open.mode === 'existing' ? open.editorId : 'new'} value={value} save={save} recipe={original}
      currentRecipe={existing} onReload={existing ? () => openRecipe(existing) : undefined}
      onClose={() => setOpen(undefined)} onOpen={openRecipe}
      onLog={(recipeId) => router.push({ pathname: '/food', params: { recipeId, date: selectedDate(date) } })} />;
  }

  return <Screen title="Recipes & meals" detail="Cook once, log by serving." onBack={router.canGoBack() ? () => router.back() : undefined}>
    <View style={foodLayout.wrap}>
      <FoodAction title="New recipe" emphasis onPress={() => setOpen({ mode: 'new' })} />
      <FoodAction title="Food diary" onPress={() => router.replace({ pathname: '/nutrition', params: { date: selectedDate(date) } })} />
    </View>
    {value.recipes.length === 0 && <Card tone="primary"><Body>Add a recipe to calculate nutrition from its ingredients.</Body></Card>}
    {value.recipes.map((recipe) => {
      const portion = recipePortion(recipe, 1);
      return <Card key={recipe.id}>
        <FoodTitle>{recipe.name}</FoodTitle>
        <Body>{displayAmount(recipe.servings)} servings · {recipe.ingredients.length} ingredients</Body>
        <Body>{displayAmount(portion.calories)} kcal · {displayAmount(portion.protein)} g protein per serving</Body>
        <View style={foodLayout.wrap}>
          <FoodAction title="Open recipe" accessibilityLabel={`Open ${recipe.name}`} onPress={() => openRecipe(recipe)} />
          <FoodAction title="Log portion" accessibilityLabel={`Log a portion of ${recipe.name}`}
            onPress={() => router.push({ pathname: '/food', params: { recipeId: recipe.id, date: selectedDate(date) } })} />
        </View>
      </Card>;
    })}
  </Screen>;
}

function ingredientDraft(seed?: RecipeIngredient): IngredientDraft {
  return { id: seed?.id ?? randomUUID(), name: seed?.name ?? '', amount: seed?.amount ?? '', macros: macroForm(seed?.macros) };
}

function RecipeEditor({ value, save, recipe, currentRecipe, onReload, onClose, onOpen, onLog }: {
  value: NutritionData; save(next: NutritionData): Promise<void>; recipe?: Recipe; currentRecipe?: Recipe;
  onReload?: () => void; onClose(): void; onOpen(recipe: Recipe): void; onLog(id: string): void;
}) {
  const [name, setName] = useState(recipe?.name ?? '');
  const [servings, setServings] = useState(String(recipe?.servings ?? 1));
  const [ingredients, setIngredients] = useState<IngredientDraft[]>(() =>
    recipe?.ingredients.length ? recipe.ingredients.map(ingredientDraft) : [ingredientDraft()]);
  const [query, setQuery] = useState('');
  const [choosingFood, setChoosingFood] = useState(false);
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState('');
  const { busy, error, write } = useNutritionSave(save);
  const persisted = new Map(recipe?.ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const scaledServings = parseAmount(servings, 10_000, 0.000001);
  const completed = ingredients.flatMap((ingredient) => {
    const macros = readMacros(ingredient.macros);
    if (!ingredient.name.trim() || !ingredient.amount.trim() || !macros) return [];
    const prior = persisted.get(ingredient.id);
    const exactMacros = prior && sameMacroForm(macroForm(prior.macros), ingredient.macros) ? prior.macros : macros;
    return [{ id: ingredient.id, name: ingredient.name.trim(), amount: ingredient.amount.trim(), macros: exactMacros }];
  });
  const valid = scaledServings && ingredients.length === completed.length && completed.length > 0;
  const dirty = !recipe || name !== recipe.name || servings !== String(recipe.servings)
    || JSON.stringify(ingredients) !== JSON.stringify(recipe.ingredients.map(ingredientDraft));
  const preview = valid ? { id: recipe?.id ?? '', name: name.trim(), servings: scaledServings, ingredients: completed } : undefined;
  const candidates = choosingFood ? recentFoods(value.meals, query, 8) : [];
  const outdated = Boolean(recipe && !sameRecipe(recipe, currentRecipe));

  function updateIngredient(item: IngredientDraft) {
    setIngredients((current) => current.map((row) => row.id === item.id ? item : row));
  }

  function doSave() {
    if (outdated) return;
    setFeedback('');
    if (!preview || !preview.name) {
      setFormError('Enter a recipe name, a positive yield and all four nutrients for every ingredient.');
      return;
    }
    setFormError('');
    const saved = { ...preview, id: recipe?.id ?? randomUUID() };
    void write({ ...value, recipes: recipe
      ? value.recipes.map((row) => row.id === recipe.id ? saved : row)
      : [...value.recipes, saved] }, onClose);
  }

  function duplicate(source: Recipe) {
    const copy = { ...source, name: `${source.name.slice(0, 113)} (copy)`, id: randomUUID(),
      ingredients: source.ingredients.map((ingredient) => ({ ...ingredient, id: randomUUID() })) };
    void write({ ...value, recipes: [...value.recipes, copy] }, () => onOpen(copy));
  }

  function addToGroceries(source: Recipe) {
    setFeedback('');
    const names = new Set(value.groceries.filter(({ checked }) => !checked)
      .map(({ name, amount }) => JSON.stringify([name.toLocaleLowerCase(), amount.toLocaleLowerCase()])));
    const additions = source.ingredients.flatMap(({ name, amount }) => {
      const key = JSON.stringify([name.toLocaleLowerCase(), amount.toLocaleLowerCase()]);
      if (names.has(key)) return [];
      names.add(key);
      return [{ id: randomUUID(), name, amount, checked: false, priceCents: null, store: '' }];
    });
    if (!additions.length) {
      setFeedback('These ingredients are already on your active list.');
      return;
    }
    void write({ ...value, groceries: [...value.groceries, ...additions] }, () =>
      setFeedback(`Added ${additions.length} ${additions.length === 1 ? 'ingredient' : 'ingredients'} to groceries.`));
  }

  async function share(source: Recipe) {
    setFeedback('');
    try {
      await Share.share({ message: recipeShareText(source) });
    } catch {
      setFeedback('Could not open the share sheet. Try again.');
    }
  }

  function remove(source: Recipe) {
    Alert.alert('Remove recipe?', 'Existing diary entries will keep their original nutrition values.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void write({
        ...value, recipes: value.recipes.filter(({ id }) => id !== source.id),
      }, onClose) },
    ]);
  }

  return <Screen title={recipe ? 'Edit recipe' : 'New recipe'}>
    <FoodAction title="Back to recipes" disabled={busy} onPress={onClose} />
    {outdated && <DraftNotice message={currentRecipe ? 'A newer recipe synced while you were editing. Your draft is still open.' :
      'This recipe is no longer saved in your account. Your draft is still open.'} onReload={onReload} />}
    <FoodField label="Recipe name" value={name} onChangeText={setName} maxLength={120} />
    <FoodField label="Servings in the full recipe" value={servings} onChangeText={setServings} maxLength={24} number />
    {preview && <MacroBoard title="Per serving" value={recipePortion(preview, 1)} />}
    <SectionTitle>Ingredients</SectionTitle>
    <Body>Enter the amount and nutrition for each ingredient used in the full recipe.</Body>
    {ingredients.map((item, index) => <Card key={item.id}>
      <FoodTitle>{item.name.trim() || `Ingredient ${index + 1}`}</FoodTitle>
      <FoodField label="Ingredient name" value={item.name} onChangeText={(text) => updateIngredient({ ...item, name: text })} maxLength={120} />
      <FoodField label="Amount, such as 200 g" value={item.amount} onChangeText={(text) => updateIngredient({ ...item, amount: text })} maxLength={120} />
      <MacroFields value={item.macros} onChange={(macros) => updateIngredient({ ...item, macros })} />
      {ingredients.length > 1 && <FoodAction title="Remove ingredient" accessibilityLabel={`Remove ingredient ${index + 1}`}
        onPress={() => setIngredients((current) => current.filter(({ id }) => id !== item.id))} />}
    </Card>)}
    <View style={foodLayout.wrap}>
      <FoodAction title="Add ingredient" disabled={ingredients.length >= 100}
        onPress={() => setIngredients((current) => [...current, ingredientDraft()])} />
      <FoodAction title="Choose from diary" selected={choosingFood} disabled={ingredients.length >= 100 && !choosingFood}
        onPress={() => setChoosingFood(!choosingFood)} />
    </View>
    {choosingFood && <Card>
      <FoodField label="Search logged food" value={query} onChangeText={setQuery} maxLength={120} />
      {candidates.map((food) => <FoodAction key={food.id}
        title={`Add ${food.name} · ${displayAmount(food.quantity)} ${food.unit}`} disabled={ingredients.length >= 100} onPress={() => {
          const next = ingredientDraft({ id: randomUUID(), name: food.name, amount: `${displayAmount(food.quantity)} ${food.unit}`, macros: food.macros });
          setIngredients((current) => current.length === 1 && !current[0]?.name.trim() && !current[0]?.amount.trim()
            && !Object.values(current[0]?.macros ?? {}).some(Boolean) ? [next] : [...current, next]);
          setChoosingFood(false);
          setQuery('');
        }} />)}
      {candidates.length === 0 && <Body>No matching foods in your diary.</Body>}
    </Card>}
    {(formError || error) && <FoodError>{formError || error}</FoodError>}
    <FoodAction title={busy ? 'Saving…' : 'Save recipe'} disabled={busy || outdated} emphasis onPress={doSave} />
    {recipe && !outdated && <Card>
      <SectionTitle>Use saved recipe</SectionTitle>
      {dirty && <Body>These actions use the last saved version.</Body>}
      {feedback && <View accessibilityLiveRegion="polite"><Body>{feedback}</Body></View>}
      <View style={foodLayout.wrap}>
        <FoodAction title="Log portion" disabled={busy} onPress={() => onLog(recipe.id)} />
        <FoodAction title="Add ingredients to groceries" disabled={busy} onPress={() => addToGroceries(recipe)} />
        <FoodAction title="Duplicate" disabled={busy} onPress={() => duplicate(recipe)} />
        <FoodAction title="Share ingredients" disabled={busy} onPress={() => void share(recipe)} />
        <FoodAction title="Remove recipe" disabled={busy} onPress={() => remove(recipe)} />
      </View>
    </Card>}
  </Screen>;
}
