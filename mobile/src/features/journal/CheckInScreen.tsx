import { useRouter } from '../../shared/navigation.tsx';
import type { CheckIn } from '@levelmaxing/contracts';
import { randomUUID } from '../../platform/native-storage.ts';
import { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Action, Card, Field, Notice, Pill, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';
import { useWorkspace } from '../workspace/index.ts';
import { emptyJournal, localDay, updateCheckIn } from './model.ts';

export function CheckInScreen() {
  const { value, save, status } = useWorkspace('journal');
  const colors = useTheme();
  const router = useRouter();
  const day = localDay();
  const journal = value ?? emptyJournal;
  const existing = journal.checkIns.find((entry) => entry.date === day);
  type Draft = { hunger: number; energy: number; sleep: string; note: string };
  const [draft, setDraft] = useState<{ fields: Draft; base: CheckIn | undefined; date: string }>();
  const saving = useRef(false);
  const [historyLimit, setHistoryLimit] = useState({ checkIns: 12, activities: 12 });
  const [activity, setActivity] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: true }>();
  const checkIn = draft?.fields ?? {
    hunger: existing?.hunger ?? 0, energy: existing?.energy ?? 0, sleep: existing ? String(existing.sleep) : '', note: existing?.note ?? '',
  };
  const disabled = busy || status === 'loading' || status === 'unavailable';

  const stale = Boolean(draft && (draft.date !== day || !sameCheckIn(draft.base, existing)));
  function edit(fields: Draft) {
    setDraft((current) => current ? { ...current, fields } : { fields, base: existing, date: day });
  }

  async function persist(next: typeof journal, message: string, finished?: () => void) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      await save(next);
      finished?.();
      setFeedback({ message });
    } catch (error) {
      setFeedback({ error: true, message: error instanceof Error ? error.message : 'Could not save this entry.' });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function saveCheckIn() {
    if (stale) return;
    const sleep = Number(checkIn.sleep.trim().replace(',', '.'));
    if (!checkIn.hunger || !checkIn.energy || !checkIn.sleep.trim() || !Number.isFinite(sleep) || sleep < 0 || sleep > 24) {
      setFeedback({ error: true, message: 'Choose hunger and energy scores and enter sleep between 0 and 24 hours.' });
      return;
    }
    void persist(updateCheckIn(journal, {
      id: existing?.id ?? randomUUID(), date: day, hunger: checkIn.hunger, energy: checkIn.energy,
      sleep, note: checkIn.note.trim(),
    }), 'Check-in saved on this device.', () => setDraft(undefined));
  }

  function addActivity() {
    const duration = Number(minutes);
    if (!activity.trim() || !/^\d+$/.test(minutes.trim()) || duration < 1 || duration > 1440) {
      setFeedback({ error: true, message: 'Enter an activity name and between 1 and 1,440 minutes.' });
      return;
    }
    void persist({ ...journal, activities: [{ id: randomUUID(), date: day, name: activity.trim(), minutes: duration }, ...journal.activities] },
      'Activity saved on this device.', () => { setActivity(''); setMinutes(''); });
  }

  function confirmRemove(section: 'checkIns' | 'activities', id: string) {
    const checkIn = section === 'checkIns';
    Alert.alert(checkIn ? 'Remove check-in?' : 'Remove activity?', 'This removes the entry from your journal.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        void persist({ ...journal, [section]: journal[section].filter((entry) => entry.id !== id) }, 'Entry removed from this device.');
      } },
    ]);
  }

  return <Screen title="Check-ins" detail="Keep track of sleep, appetite, energy and activity." onBack={router.canGoBack() ? () => router.back() : undefined}>
    {status === 'unavailable' && <Notice kind="error">Journal storage is unavailable.</Notice>}
    {feedback && <Notice kind={feedback.error ? 'error' : 'success'}>{feedback.message}</Notice>}
    <Card tone="success">
      <SectionTitle>Today · {day}</SectionTitle>
      <Rating label="Hunger" value={checkIn.hunger} disabled={disabled} onChange={(hunger) => edit({ ...checkIn, hunger })} />
      <Rating label="Energy" value={checkIn.energy} disabled={disabled} onChange={(energy) => edit({ ...checkIn, energy })} />
      <Field label="Hours slept" value={checkIn.sleep} onChangeText={(sleep) => edit({ ...checkIn, sleep })} keyboardType="decimal-pad" maxLength={7} editable={!disabled} />
      <Field label="Notes (optional)" value={checkIn.note} onChangeText={(note) => edit({ ...checkIn, note })} maxLength={2000} multiline editable={!disabled} />
      {stale && <>
        <Notice kind="error">The current check-in changed while you were editing. Load the latest entry before saving.</Notice>
        <Action title="Load latest check-in" subtle onPress={() => setDraft(undefined)} />
      </>}
      <Action title={existing ? 'Update check-in' : 'Save check-in'} disabled={disabled || stale} onPress={saveCheckIn} />
    </Card>
    <Card>
      <SectionTitle>Log an activity</SectionTitle>
      <Field label="Activity" value={activity} onChangeText={setActivity} maxLength={120} editable={!disabled} />
      <Field label="Minutes" value={minutes} keyboardType="number-pad" onChangeText={setMinutes} maxLength={4} editable={!disabled} />
      <Action title="Add activity" disabled={disabled} onPress={addActivity} />
    </Card>
    <Card>
      <SectionTitle>Recent check-ins</SectionTitle>
      {journal.checkIns.length === 0 && <Text style={{ color: colors.muted }}>Your saved check-ins will appear here.</Text>}
      {journal.checkIns.slice().sort((left, right) => right.date.localeCompare(left.date)).slice(0, historyLimit.checkIns).map((entry) =>
        <View key={entry.id} style={styles.row}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{entry.date}</Text>
          <Text style={{ color: colors.muted }}>Energy {entry.energy}/5 · Hunger {entry.hunger}/5 · Sleep {entry.sleep} h</Text>
          {entry.note !== '' && <Text style={{ color: colors.text }}>{entry.note}</Text>}
          <Action title={`Remove check-in for ${entry.date}`} subtle disabled={disabled} onPress={() => confirmRemove('checkIns', entry.id)} />
        </View>)}
      {journal.checkIns.length > historyLimit.checkIns && <Action title="Show older check-ins" subtle
        onPress={() => setHistoryLimit((current) => ({ ...current, checkIns: current.checkIns + 12 }))} />}
    </Card>
    <Card>
      <SectionTitle>Recent activity</SectionTitle>
      {journal.activities.length === 0 && <Text style={{ color: colors.muted }}>Your saved activities will appear here.</Text>}
      {journal.activities.slice().sort((left, right) => right.date.localeCompare(left.date)).slice(0, historyLimit.activities).map((entry) =>
        <View key={entry.id} style={styles.row}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{entry.name}</Text>
          <Text style={{ color: colors.muted }}>{entry.date} · {entry.minutes} min</Text>
          <Action title={`Remove ${entry.name} activity`} subtle disabled={disabled} onPress={() => confirmRemove('activities', entry.id)} />
        </View>)}
      {journal.activities.length > historyLimit.activities && <Action title="Show older activities" subtle
        onPress={() => setHistoryLimit((current) => ({ ...current, activities: current.activities + 12 }))} />}
    </Card>
  </Screen>;
}

function sameCheckIn(left: CheckIn | undefined, right: CheckIn | undefined): boolean {
  return left === right || Boolean(left && right && left.id === right.id && left.date === right.date
    && left.hunger === right.hunger && left.energy === right.energy && left.sleep === right.sleep && left.note === right.note);
}

function Rating({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void }) {
  const colors = useTheme();
  return <View style={styles.row}>
    <Text style={{ color: colors.text, fontWeight: '700' }}>{label} · 1 is low, 5 is high</Text>
    <View style={styles.ratings}>
      {[1, 2, 3, 4, 5].map((score) => <Pill key={score} label={String(score)} accessibilityLabel={`${label} ${score} of 5`} selected={value === score}
        onPress={() => onChange(score)} disabled={disabled} />)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { gap: 5 },
  ratings: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
