import { randomUUID } from '../../platform/native-storage.ts';
import { useLocalSearchParams, useRouter } from '../../shared/navigation.tsx';
import { useState } from 'react';
import { View } from 'react-native';
import type { FoodLog, NutritionData, Recipe } from '@levelmaxing/contracts';
import { Card, Screen, SectionTitle } from '../../shared/ui.tsx';
import { useWorkspace } from '../workspace/index.ts';
import { displayAmount, findBarcode, fullDate, labelNutrition, macroForm, mealName, mealNames, parseAmount,
  readBarcode, readMacros, recentFoods, recipePortion, sameFoodLog, sameMacroForm, sameRecipe, selectedDate, supportedMacros,
  type MacroForm, type MealName } from './model.ts';
import { Body, DraftNotice, FoodAction, FoodError, FoodField, FoodTitle, MacroBoard, MacroFields, foodLayout } from './ui.tsx';
import { useNutritionSave } from './useSave.ts';
import { emptyNutrition, NutritionLoading } from './workspace.tsx';

type Mode = 'recent' | 'manual' | 'label' | 'description' | 'barcode';
type LabelBasis = 'serving' | '100 g' | '100 ml';
const labelBases: LabelBasis[] = ['serving', '100 g', '100 ml'];
const modes: { type: Mode; label: string }[] = [
  { type: 'recent', label: 'Search' },
  { type: 'manual', label: 'Manual' },
  { type: 'label', label: 'Label' },
  { type: 'description', label: 'Describe' },
  { type: 'barcode', label: 'Barcode' },
];

export function FoodScreen() {
  const params = useLocalSearchParams<{ date?: string; meal?: string; id?: string; recipeId?: string; mode?: string }>();
  const { value: current, status, save } = useWorkspace('nutrition');
  const value = current ?? emptyNutrition;
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const entry = typeof params.id === 'string' ? value.meals.find(({ id }) => id === params.id) : undefined;
  const recipe = typeof params.recipeId === 'string' ? value.recipes.find(({ id }) => id === params.recipeId) : undefined;
  const date = entry?.date ?? selectedDate(params.date);
  function diary() { router.replace({ pathname: '/nutrition', params: { date } }); }
  if (status === 'loading' || status === 'unavailable' || (!current && status === 'syncing')) {
    return <NutritionLoading title="Add food" unavailable={status === 'unavailable'} />;
  }
  const initialMode = params.mode === 'barcode' ? 'barcode' : 'recent';
  return <FoodEditor key={`${params.id ?? ''}|${params.recipeId ?? ''}|${params.date ?? ''}|${params.meal ?? ''}|${initialMode}|${revision}`}
    value={value} save={save} requestedDate={date} defaultMeal={mealName(params.meal)}
    expectsEntry={Boolean(params.id)} expectsRecipe={Boolean(params.recipeId)}
    currentEntry={entry} currentRecipe={recipe} initialMode={initialMode} onClose={diary} onReload={() => setRevision((current) => current + 1)} />;
}

function FoodEditor({ value, save, requestedDate, defaultMeal, currentEntry, currentRecipe, expectsEntry, expectsRecipe,
  initialMode, onClose, onReload }: {
  value: NutritionData; save(next: NutritionData): Promise<void>; requestedDate: string; defaultMeal: MealName;
  currentEntry?: FoodLog; currentRecipe?: Recipe; expectsEntry: boolean; expectsRecipe: boolean;
  initialMode: Mode; onClose(): void; onReload(): void;
}) {
  const [entry] = useState(currentEntry);
  const [recipe] = useState(currentRecipe);
  const [date] = useState(requestedDate);
  const [mode, setMode] = useState<Mode>(entry ? 'manual' : initialMode);
  const [nutritionSource, setNutritionSource] = useState(entry);
  const [name, setName] = useState(entry?.name ?? '');
  const [query, setQuery] = useState('');
  const [barcode, setBarcode] = useState('');
  const [barcodeSearched, setBarcodeSearched] = useState(false);
  const [source, setSource] = useState(entry?.source ?? 'Manual entry');
  const [quantity, setQuantity] = useState(String(entry?.quantity ?? 1));
  const [basisQuantity, setBasisQuantity] = useState(String(entry?.quantity ?? 1));
  const [basis, setBasis] = useState<LabelBasis>('serving');
  const [unit, setUnit] = useState(entry?.unit ?? 'serving');
  const [energy, setEnergy] = useState<'kcal' | 'kJ'>('kcal');
  const [meal, setMeal] = useState(entry?.meal ?? defaultMeal);
  const [macros, setMacros] = useState<MacroForm>(() => macroForm(entry?.macros));
  const [review, setReview] = useState<FoodLog>();
  const [formError, setFormError] = useState('');
  const { busy, error, write } = useNutritionSave(save);
  const gettingLabel = mode === 'label';
  const labelUnit = basis === 'serving' ? 'serving' : basis.slice(4);
  const unavailable = (expectsEntry && !entry) || (expectsRecipe && !recipe);
  const outdated = (entry && !sameFoodLog(entry, currentEntry)) || (recipe && !sameRecipe(recipe, currentRecipe));
  const canReload = expectsEntry ? Boolean(currentEntry) : Boolean(currentRecipe);
  const changedDraft = outdated && <DraftNotice
    message={canReload ? 'A newer version synced while you were editing. Your draft is still open.' :
      'This food or recipe is no longer saved in your account. Your draft is still open.'}
    onReload={canReload ? onReload : undefined} />;

  function newMode(nextMode: Mode) {
    setFormError('');
    setMode(nextMode);
    setBarcodeSearched(false);
    setSource(nextMode === 'description' ? 'Your estimated nutrition' : 'Manual entry');
  }

  function reuse(row: FoodLog) {
    setName(row.name);
    setMacros(macroForm(row.macros));
    setMode('manual');
    setSource(row.source);
    setNutritionSource(row);
    setQuantity(String(row.quantity));
    setBasisQuantity(String(row.quantity));
    setUnit(row.unit);
    setFormError('');
  }

  function searchBarcode() {
    const code = readBarcode(barcode);
    setFormError(code ? '' : 'Enter a valid 8-, 12-, 13-, or 14-digit barcode.');
    setBarcodeSearched(Boolean(code));
  }

  function transcribeLabel() {
    setMode('label');
    setSource(`Package label · ${barcode.trim()}`);
    setFormError('');
  }

  function reviewFood() {
    const label = (recipe?.name ?? name).trim();
    const amount = parseAmount(quantity, 1_000_000, 0.000001);
    const reportBasis = gettingLabel && basis !== 'serving' ? 100 : gettingLabel ? 1 : parseAmount(basisQuantity, 1_000_000, 0.000001);
    const servedAs = recipe ? 'serving' : gettingLabel ? labelUnit : unit.trim();
    const entered = readMacros(macros);
    if (!label || !amount || !servedAs || (!recipe && (!reportBasis || !entered))) {
      setFormError('Enter a name, a positive amount and values for all four nutrients.');
      return;
    }
    let total;
    if (recipe) {
      total = recipePortion(recipe, amount);
    } else if (entered && reportBasis) {
      const original = nutritionSource && !gettingLabel && sameMacroForm(macroForm(nutritionSource.macros), macros)
        ? nutritionSource.macros : entered;
      total = labelNutrition(original, amount, reportBasis, gettingLabel ? energy : 'kcal');
    }
    if (!total || !supportedMacros(total)) {
      setFormError('The calculated serving is too large. Check the amount and nutrition values.');
      return;
    }
    setFormError('');
    setReview({
      id: entry?.id ?? randomUUID(), name: label, date, meal, quantity: amount, unit: servedAs, macros: total,
      source: recipe ? 'Saved recipe' : gettingLabel ? source.startsWith('Package label · ') ? source : 'Package label' : source,
    });
  }

  function confirm() {
    if (!review || outdated) return;
    const meals = entry
      ? value.meals.map((row) => row.id === entry.id ? review : row)
      : [...value.meals, review];
    void write({ ...value, meals }, onClose);
  }

  if (unavailable) {
    return <Screen title="Food unavailable">
      <Body>This food or recipe could not be loaded from your account.</Body>
      {canReload && <FoodAction title="Load latest data" onPress={onReload} />}
      <FoodAction title="Back to food diary" onPress={onClose} />
    </Screen>;
  }

  if (review) {
    return <Screen title="Review food" detail={fullDate(review.date)}>
      <SectionTitle>{review.name}</SectionTitle>
      <Body>{review.meal} · {displayAmount(review.quantity)} {review.unit} · {review.source}</Body>
      <MacroBoard title="Nutrition for this entry" value={review.macros} />
      {changedDraft}
      {error && <FoodError>{error}</FoodError>}
      <FoodAction title={busy ? 'Saving…' : entry ? 'Save changes' : 'Log food'} emphasis disabled={busy || Boolean(outdated)} onPress={confirm} />
      <FoodAction title="Back to edit" disabled={busy} onPress={() => setReview(undefined)} />
      {outdated && <FoodAction title="Close draft" disabled={busy} onPress={onClose} />}
    </Screen>;
  }

  const recent = mode === 'recent' ? recentFoods(value.meals, query) : [];
  const barcodeMatch = barcodeSearched ? findBarcode(value.meals, barcode) : undefined;
  return <Screen title={entry ? 'Edit food' : recipe ? 'Log recipe' : 'Add food'} detail={fullDate(date)}>
    <FoodAction title="Back to food diary" onPress={onClose} />
    {changedDraft}
    <View style={foodLayout.group}>
      <SectionTitle>Meal</SectionTitle>
      <View style={foodLayout.wrap}>
        {mealNames.map((name) => <FoodAction key={name} title={name} selected={meal === name} onPress={() => setMeal(name)} />)}
      </View>
    </View>
    {!entry && !recipe && <View style={foodLayout.wrap}>
      {modes.map(({ type, label }) => <FoodAction key={type} title={label} selected={mode === type} onPress={() => newMode(type)} />)}
    </View>}
    {mode === 'recent' && !recipe && <>
      <FoodField label="Search foods you’ve logged" value={query} onChangeText={setQuery} maxLength={120} />
      <SectionTitle>{query.trim() ? 'Matches' : 'Recent foods'}</SectionTitle>
      {recent.length === 0 && <Card>
        <Body>{query.trim() ? 'No matching foods in your diary.' : 'Logged foods will appear here for quick reuse.'}</Body>
        <FoodAction title="Enter food manually" onPress={() => newMode('manual')} />
      </Card>}
      {recent.map((row) => <Card key={row.id}>
        <FoodTitle>{row.name}</FoodTitle>
        <Body>{displayAmount(row.quantity)} {row.unit} · {displayAmount(row.macros.calories)} kcal · {row.source}</Body>
        <FoodAction title="Use this food" accessibilityLabel={`Use ${row.name}`} onPress={() => reuse(row)} />
      </Card>)}
    </>}
    {mode === 'barcode' && <>
      <FoodField label="Package barcode" value={barcode} number maxLength={14}
        onChangeText={(text) => { setBarcode(text); setBarcodeSearched(false); setFormError(''); }} />
      <FoodAction title="Search my diary" emphasis onPress={searchBarcode} />
      {barcodeSearched && (barcodeMatch ? <Card>
        <FoodTitle>{barcodeMatch.name}</FoodTitle>
        <Body>{barcodeMatch.source}</Body>
        <FoodAction title="Use this food" onPress={() => reuse(barcodeMatch)} />
      </Card> : <Card>
        <Body>This barcode hasn’t been logged in your diary.</Body>
        <FoodAction title="Enter package label" onPress={transcribeLabel} />
      </Card>)}
    </>}
    {(recipe || mode === 'manual' || mode === 'label' || mode === 'description') && <>
      {recipe ? <MacroBoard title={`${recipe.name} · per serving`} value={recipePortion(recipe, 1)} /> : <>
        {gettingLabel && <Body>Copy the nutrition figures from the package. Select the basis and energy unit printed on the label.</Body>}
        {mode === 'description' && <Body>Describe your meal, then enter your own nutrition estimate.</Body>}
        <FoodField label={mode === 'description' ? 'Meal description' : 'Food name'}
          value={name} onChangeText={setName} maxLength={120} multiline={mode === 'description'} />
      </>}
      {gettingLabel && <>
        <View style={foodLayout.wrap}>
          {labelBases.map((item) => <FoodAction key={item} title={item === 'serving' ? 'Per serving' : `Per ${item}`}
            selected={basis === item} onPress={() => setBasis(item)} />)}
        </View>
        <View style={foodLayout.wrap}>
          {(['kcal', 'kJ'] as const).map((item) => <FoodAction key={item} title={item} selected={energy === item} onPress={() => setEnergy(item)} />)}
        </View>
      </>}
      <FoodField label={recipe ? 'Servings eaten' : gettingLabel ? `Amount eaten (${labelUnit})` : 'Amount eaten'}
        value={quantity} onChangeText={setQuantity} maxLength={24} number />
      {!recipe && <>
        {!gettingLabel && <>
          <FoodField label="Unit, such as g or serving" value={unit} onChangeText={setUnit} maxLength={50} />
          <FoodField label="Amount the nutrition values describe" value={basisQuantity} onChangeText={setBasisQuantity} maxLength={24} number />
        </>}
        <MacroFields value={macros} onChange={setMacros} energy={`Energy (${gettingLabel ? energy : 'kcal'})`} />
        <Body>Enter zero only when the nutrient is zero.</Body>
      </>}
      <FoodAction title="Review food" emphasis onPress={reviewFood} />
    </>}
    {formError && <FoodError>{formError}</FoodError>}
  </Screen>;
}
