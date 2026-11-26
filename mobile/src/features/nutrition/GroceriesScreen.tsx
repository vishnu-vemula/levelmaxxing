import { randomUUID } from '../../platform/native-storage.ts';
import { useRouter } from '../../shared/navigation.tsx';
import { useState } from 'react';
import { Alert, Share, Switch, View } from 'react-native';
import type { Grocery } from '@levelmaxing/contracts';
import { Card, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';
import { useWorkspace } from '../workspace/index.ts';
import { groceryShareText, groceryTotals, readPrice, sameGrocery } from './model.ts';
import { Body, DraftNotice, FoodAction, FoodError, FoodField, FoodTitle, foodLayout } from './ui.tsx';
import { useNutritionSave } from './useSave.ts';
import { emptyNutrition, NutritionLoading } from './workspace.tsx';

type Draft = { id: string; name: string; amount: string; price: string; store: string; checked: boolean; original?: Grocery };

function edit(item?: Grocery): Draft {
  return { id: item?.id ?? randomUUID(), name: item?.name ?? '', amount: item?.amount ?? '',
    price: item?.priceCents === null || item?.priceCents === undefined ? '' : (item.priceCents / 100).toFixed(2),
    store: item?.store ?? '', checked: item?.checked ?? false, original: item };
}

const amountLabel = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function GroceriesScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { value: current, status, save } = useWorkspace('nutrition');
  const value = current ?? emptyNutrition;
  const [draft, setDraft] = useState<Draft>();
  const [formError, setFormError] = useState('');
  const [shareError, setShareError] = useState('');
  const { busy, error, write } = useNutritionSave(save);
  const items = value.groceries;
  const totals = groceryTotals(items);
  const latest = draft?.original ? items.find(({ id }) => id === draft.id) : undefined;
  const outdated = Boolean(draft?.original && !sameGrocery(draft.original, latest));

  function editItem(item?: Grocery) {
    setFormError('');
    setDraft(edit(item));
  }

  function submit() {
    if (!draft || outdated) return;
    const name = draft.name.trim();
    const amount = draft.amount.trim();
    const priceCents = readPrice(draft.price);
    const store = draft.store.trim();
    if (!name || !amount) {
      setFormError('Enter an item and the amount you need.');
      return;
    }
    if (priceCents === undefined || (priceCents !== null && !store)) {
      setFormError('Enter a price with at most two decimals and the store where you saw it.');
      return;
    }
    const item = { id: draft.id, name, amount, priceCents, store, checked: draft.checked };
    const groceries = items.some(({ id }) => id === draft.id)
      ? items.map((row) => row.id === draft.id ? item : row)
      : [...items, item];
    setFormError('');
    void write({ ...value, groceries }, () => setDraft(undefined));
  }

  function remove(item: Grocery) {
    Alert.alert('Remove item?', `${item.name} will be removed from your grocery list.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void write({
        ...value, groceries: items.filter(({ id }) => id !== item.id),
      }) },
    ]);
  }

  async function shareList() {
    setShareError('');
    try {
      await Share.share({ message: groceryShareText(items) });
    } catch {
      setShareError('Could not open the share sheet. Try again.');
    }
  }

  if (status === 'loading' || status === 'unavailable' || (!current && status === 'syncing')) {
    return <NutritionLoading title="Groceries" unavailable={status === 'unavailable'} />;
  }

  return <Screen title="Groceries" detail="Build your list and keep track of what you’ve picked up." onBack={router.canGoBack() ? () => router.back() : undefined}>
    <View style={foodLayout.wrap}>
      <FoodAction title="Food diary" onPress={() => router.replace('/nutrition')} />
      <FoodAction title="Recipes" onPress={() => router.push('/recipes')} />
      {totals.checked < items.length && <FoodAction title="Share remaining items" onPress={() => void shareList()} />}
    </View>
    {shareError && <FoodError>{shareError}</FoodError>}
    <Card tone="success">
      <SectionTitle>{totals.checked} of {items.length} picked up</SectionTitle>
      {totals.priced > 0 && <Body>Entered prices total {amountLabel.format(totals.cents / 100)} across {totals.priced} {totals.priced === 1 ? 'item' : 'items'}.</Body>}
    </Card>
    {!draft && <FoodAction title="Add grocery item" emphasis onPress={() => editItem()} />}
    {draft && <Card>
      <SectionTitle>{draft.original ? 'Edit item' : 'Add item'}</SectionTitle>
      {outdated && <DraftNotice message={latest ? 'A newer grocery item synced while you were editing. Your draft is still open.' :
        'This item is no longer on your grocery list. Your draft is still open.'} onReload={latest ? () => editItem(latest) : undefined} />}
      <FoodField label="Item" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} maxLength={120} />
      <FoodField label="Amount, such as 2 cans" value={draft.amount} onChangeText={(amount) => setDraft({ ...draft, amount })} maxLength={120} />
      <FoodField label="Observed total price (optional)" value={draft.price} onChangeText={(price) => setDraft({ ...draft, price })} number maxLength={12} />
      <FoodField label="Store" value={draft.store} onChangeText={(store) => setDraft({ ...draft, store })} maxLength={120} />
      <Body>Use the same local currency for all prices. Enter what you saw at the store.</Body>
      {formError && <FoodError>{formError}</FoodError>}
      <View style={foodLayout.wrap}>
        <FoodAction title={busy ? 'Saving…' : 'Save item'} emphasis disabled={busy || outdated} onPress={submit} />
        <FoodAction title="Cancel" disabled={busy} onPress={() => setDraft(undefined)} />
      </View>
    </Card>}
    {error && <FoodError>{error}</FoodError>}
    {!items.length && <Card><Body>Your shopping list is empty. Add an item here or bring in ingredients from a saved recipe.</Body></Card>}
    {items.map((item) => <Card key={item.id}>
      <View style={foodLayout.spread}>
        <FoodTitle>{item.name}</FoodTitle>
        <Switch accessibilityLabel={`${item.name} picked up`} value={item.checked} disabled={busy || draft?.id === item.id}
          trackColor={{ true: colors.success }} onValueChange={(checked) => void write({
            ...value, groceries: items.map((row) => row.id === item.id ? { ...row, checked } : row),
          })} />
      </View>
      <Body>{item.amount}{item.checked ? ' · Picked up' : ''}</Body>
      {item.priceCents !== null
        ? <Body>{amountLabel.format(item.priceCents / 100)} · {item.store} · Entered price</Body>
        : <Body>{item.store ? `${item.store} · No price entered` : 'No price entered'}</Body>}
      <View style={foodLayout.wrap}>
        <FoodAction title="Edit" accessibilityLabel={`Edit ${item.name}`} disabled={busy || Boolean(draft)} onPress={() => editItem(item)} />
        <FoodAction title="Remove" accessibilityLabel={`Remove ${item.name}`} disabled={busy || Boolean(draft)} onPress={() => remove(item)} />
      </View>
    </Card>)}
  </Screen>;
}
