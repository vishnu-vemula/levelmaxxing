import { useLocalSearchParams, useRouter } from '../../shared/navigation.tsx';
import { randomUUID } from '../../platform/native-storage.ts';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { FoodLog } from '@levelmaxing/contracts';
import { Card, Notice, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';
import { useWorkspace } from '../workspace/index.ts';
import { copyFoodLogs, dateKey, displayAmount, foodGroups, fullDate, mealNames, selectedDate, shiftDate, sumMacros, weekDays,
  type MealName } from './model.ts';
import { Body, FoodAction, FoodError, FoodField, FoodTitle, MacroBoard, foodLayout } from './ui.tsx';
import { useNutritionSave } from './useSave.ts';
import { emptyNutrition, NutritionLoading } from './workspace.tsx';

type CopyDraft = { entries: FoodLog[]; sourceMeal: MealName; date: string; meal: MealName };

export function NutritionScreen() {
  const { date: requested } = useLocalSearchParams<{ date?: string }>();
  const { fontScale, width } = useWindowDimensions();
  const [copiedMeal, setCopiedMeal] = useState<MealName | null>(null);
  const [copyDraft, setCopyDraft] = useState<CopyDraft | null>(null);
  const [copyError, setCopyError] = useState('');
  const [feedback, setFeedback] = useState('');
  const colors = useTheme();
  const router = useRouter();
  const { value: current, status, save } = useWorkspace('nutrition');
  const profile = useWorkspace('profile').value;
  const value = current ?? emptyNutrition;
  const { busy, error, write } = useNutritionSave(save);
  const active = selectedDate(requested);
  const today = dateKey();
  const groups = useMemo(() => foodGroups(value.meals, active), [value.meals, active]);
  const prior = useMemo(() => foodGroups(value.meals, shiftDate(active, -1)), [value.meals, active]);
  const datesWithFood = useMemo(() => new Set(value.meals.map(({ date }) => date)), [value.meals]);
  const total = sumMacros(mealNames.flatMap((name) => groups[name].map(({ macros }) => macros)));
  const dateLabel = active === today ? 'Today' : fullDate(active);
  const wrapCalendar = fontScale >= 1.3 || width < 366;

  function chooseDate(date: string) {
    setCopiedMeal(null);
    setCopyDraft(null);
    setCopyError('');
    setFeedback('');
    router.setParams({ date });
  }

  function openFood(meal: MealName, id?: string) {
    router.push({ pathname: '/food', params: { date: active, meal, ...(id ? { id } : {}) } });
  }

  function remove(entry: FoodLog) {
    Alert.alert('Remove food?', `${entry.name} will be removed from this day.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void write({
        ...value,
        meals: value.meals.filter(({ id }) => id !== entry.id),
      }, () => setFeedback(`Removed ${entry.name}.`)) },
    ]);
  }

  function copyPrevious(meal: MealName) {
    copyEntries(prior[meal], { date: active, meal });
  }

  function openCopy(entries: FoodLog[], meal: MealName) {
    setCopiedMeal(null);
    setCopyError('');
    setCopyDraft({ entries, sourceMeal: meal, date: active === today ? shiftDate(active, 1) : today, meal });
  }

  function copyEntries(entries: FoodLog[], destination: { date: string; meal: MealName }) {
    setFeedback('');
    const date = selectedDate(destination.date.trim(), '');
    if (!date) {
      setCopyError('Enter a valid date in YYYY-MM-DD format.');
      return;
    }
    const next = copyFoodLogs(value, entries, { date, meal: destination.meal }, randomUUID);
    if (!next) {
      setCopyError('The source entries changed. Close this copy and select them again.');
      return;
    }
    setCopyError('');
    void write(next, () => {
      setCopiedMeal(null);
      setCopyDraft(null);
      const count = entries.length === 1 ? '1 entry' : `${entries.length} entries`;
      setFeedback(`Copied ${count} to ${destination.meal} on ${fullDate(date)}.`);
    });
  }

  if (status === 'loading' || status === 'unavailable' || (!current && status === 'syncing')) {
    return <NutritionLoading title="Food" unavailable={status === 'unavailable'} />;
  }

  return <Screen title="Food">
    <View style={foodLayout.spread}>
      <FoodAction title="Recipes & meals" onPress={() => router.push({ pathname: '/recipes', params: { date: active } })} />
      <FoodAction title="Groceries" onPress={() => router.push('/groceries')} />
      <FoodAction title="Food archive" onPress={() => router.push({ pathname: '/history', params: { kind: 'meals' } })} />
    </View>
    <View style={foodLayout.group}>
      <SectionTitle>{dateLabel}</SectionTitle>
      <View style={foodLayout.spread}>
        <FoodAction title="Previous week" disabled={busy} onPress={() => chooseDate(shiftDate(active, -7))} />
        {active !== today && <FoodAction title="Today" disabled={busy} onPress={() => chooseDate(today)} />}
        <FoodAction title="Next week" disabled={busy} onPress={() => chooseDate(shiftDate(active, 7))} />
      </View>
      <View style={[styles.calendar, wrapCalendar && styles.calendarWrapped]}>
        {weekDays(active).map(({ key, day, weekday, label }) =>
          <View key={key} style={[styles.day, wrapCalendar && styles.dayWrapped]}>
            <FoodAction title={`${weekday}\n${day}`} compact selected={key === active} disabled={busy} onPress={() => chooseDate(key)}
              accessibilityLabel={datesWithFood.has(key) ? `${label}, food logged` : label} />
            {datesWithFood.has(key) && <Text style={[styles.marker, { color: colors.primary }]} accessibilityElementsHidden
              importantForAccessibility="no">●</Text>}
          </View>
        )}
      </View>
    </View>
    <MacroBoard title={active === today ? 'Today’s nutrition' : 'Daily nutrition'} value={total}
      target={active === today ? profile?.calories ?? undefined : undefined} />
    {status === 'offline' && <Notice>Food entries are stored on this device and can sync when the connection returns.</Notice>}
    {feedback && <Notice kind="success">{feedback}</Notice>}
    {error && <FoodError>{error}</FoodError>}
    {mealNames.map((meal) => {
      const entries = groups[meal];
      const kcal = sumMacros(entries.map(({ macros }) => macros)).calories;
      return <View style={foodLayout.group} key={meal}>
        <View style={foodLayout.spread}>
          <SectionTitle>{meal}</SectionTitle>
          <Body>{displayAmount(kcal)} kcal</Body>
        </View>
        {entries.map((entry) => (
          <Card key={entry.id}>
            <View style={foodLayout.spread}>
              <FoodTitle>{entry.name}</FoodTitle>
              <Body>{displayAmount(entry.macros.calories)} kcal</Body>
            </View>
            <Body>{displayAmount(entry.quantity)} {entry.unit} · {displayAmount(entry.macros.protein)} g protein</Body>
            <Body>{entry.source}</Body>
            <View style={foodLayout.wrap}>
              <FoodAction title="Edit" accessibilityLabel={`Edit ${entry.name}`} disabled={busy} onPress={() => openFood(meal, entry.id)} />
              <FoodAction title="Copy" accessibilityLabel={`Copy ${entry.name}`} disabled={busy} onPress={() => openCopy([entry], meal)} />
              <FoodAction title="Remove" accessibilityLabel={`Remove ${entry.name}`} disabled={busy} onPress={() => remove(entry)} />
            </View>
          </Card>
        ))}
        {entries.length === 0 && <Card><Body>Nothing logged yet.</Body></Card>}
        <View style={foodLayout.wrap}>
          <FoodAction title="Add food" accessibilityLabel={`Add food to ${meal}`} emphasis disabled={busy} onPress={() => openFood(meal)} />
          {entries.length > 1 && <FoodAction title="Copy meal" accessibilityLabel={`Copy ${meal}`} disabled={busy}
            onPress={() => openCopy(entries, meal)} />}
          {prior[meal].length > 0 && <FoodAction title={active === today ? 'Copy yesterday' : 'Copy previous day'} selected={copiedMeal === meal}
            disabled={busy} onPress={() => {
              setCopyDraft(null);
              setCopyError('');
              setCopiedMeal(copiedMeal === meal ? null : meal);
            }} />}
        </View>
        {copyDraft?.sourceMeal === meal && <Card>
          <FoodTitle>{copyDraft.entries.length === 1 ? `Copy ${copyDraft.entries[0]?.name}` : `Copy ${meal}`}</FoodTitle>
          <FoodField label="Destination date (YYYY-MM-DD)" value={copyDraft.date} maxLength={10} editable={!busy}
            onChangeText={(date) => { setCopyDraft({ ...copyDraft, date }); setCopyError(''); }} />
          <View style={foodLayout.wrap}>
            {mealNames.map((slot) => <FoodAction key={slot} title={slot} accessibilityLabel={`Destination meal, ${slot}`}
              selected={copyDraft.meal === slot} disabled={busy} onPress={() => { setCopyDraft({ ...copyDraft, meal: slot }); setCopyError(''); }} />)}
          </View>
          {copyError && <FoodError>{copyError}</FoodError>}
          <View style={foodLayout.wrap}>
            <FoodAction title="Confirm copy" emphasis disabled={busy} onPress={() => copyEntries(copyDraft.entries, copyDraft)} />
            <FoodAction title="Cancel copy" disabled={busy} onPress={() => { setCopyDraft(null); setCopyError(''); }} />
          </View>
        </Card>}
        {copiedMeal === meal && <Card>
          <Body>Copy {meal.toLocaleLowerCase()} from {fullDate(shiftDate(active, -1))}.</Body>
          {prior[meal].map((entry) => <Body key={entry.id}>{entry.name} · {displayAmount(entry.quantity)} {entry.unit}</Body>)}
          {copyError && <FoodError>{copyError}</FoodError>}
          <FoodAction title="Copy to this day" disabled={busy} onPress={() => copyPrevious(meal)} />
        </Card>}
      </View>;
    })}
  </Screen>;
}

const styles = StyleSheet.create({
  calendar: { flexDirection: 'row', gap: 3 },
  calendarWrapped: { flexWrap: 'wrap', gap: 8 },
  day: { flex: 1, minWidth: 0, gap: 2 },
  dayWrapped: { flex: 0, minWidth: 74 },
  marker: { fontSize: 8, textAlign: 'center' },
});
