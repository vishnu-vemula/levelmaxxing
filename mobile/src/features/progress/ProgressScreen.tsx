import type { Activity, Workout } from '@levelmaxing/contracts';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Action, Card, Field, Notice, Pill, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';
import { useWorkspace } from '../workspace/index.ts';
import { useProgress } from './ProgressBoundary.tsx';
import { formatWeight, parseDisplayedWeight, type WeightUnit } from './presentation.ts';
import { todayLocal, type Entry } from './sync.ts';

const statuses = {
  idle: 'Sync is ready.',
  running: 'Syncing…',
  current: 'Last sync complete.',
  offline: 'Sync is unavailable. New entries stay on this device.',
  reconnect: 'Reconnect your account to sync. New entries stay on this device.',
  review: 'Sync needs review. Your local entries are still available.',
};

const entryStatus = { confirmed: 'Synced', pending: 'Waiting to sync', review: 'Needs review' };
const tabs = ['Body', 'Training', 'Activity'] as const;
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

function recentDays(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(now);
    day.setDate(day.getDate() + index + 1 - count);
    return { date: todayLocal(day), weekday: weekdayFormat.format(day) };
  });
}

export function ProgressScreen() {
  const colors = useTheme();
  const router = useRouter();
  const profile = useWorkspace('profile').value;
  const training = useWorkspace('training');
  const journal = useWorkspace('journal');
  const [tab, setTab] = useState<typeof tabs[number]>('Body');
  const unit = profile?.units ?? 'kg';

  return <Screen title="Progress" detail="Your recorded history">
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map(label => <Pill key={label} label={label} role="tab" selected={tab === label} onPress={() => setTab(label)} />)}
    </View>
    {tab === 'Body' && <WeightLog key={unit} unit={unit} />}
    {tab === 'Training' && (training.status === 'loading'
      ? <ActivityIndicator color={colors.focus} accessibilityLabel="Opening training history" />
      : <TrainingStats history={training.value?.history ?? []} unit={unit} onHistory={() =>
        router.push({ pathname: '/workout', params: { view: 'history' } })} />)}
    {tab === 'Activity' && (journal.status === 'loading'
      ? <ActivityIndicator color={colors.focus} accessibilityLabel="Opening activity history" />
      : <ActivityStats activities={journal.value?.activities ?? []} onOpen={() => router.push('/check-in')} />)}
  </Screen>;
}

function WeightLog({ unit }: { unit: WeightUnit }) {
  const colors = useTheme();
  const { entries, availability, syncState, save, refresh } = useProgress();
  const [weight, setWeight] = useState('');
  const [day, setDay] = useState(todayLocal);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [hasError, setHasError] = useState(false);
  const pending = useRef(false);

  async function submit() {
    if (pending.current) return;
    const input = parseDisplayedWeight(weight, day, unit);
    if (!input) {
      setNotice(`Enter a weight from ${unit === 'kg' ? '20 to 450 kg' : 'about 44.1 to 992.0 lb'} and a date in YYYY-MM-DD format.`);
      setHasError(true);
      return;
    }
    pending.current = true;
    setSaving(true);
    setHasError(false);
    setNotice('');
    try {
      await save(input);
      setWeight('');
      setNotice('Weight saved on this device.');
    } catch {
      setHasError(true);
      setNotice('The weight could not be saved. Your input is still here.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <>
    {entries.length > 0 && <WeightTrend entries={entries} unit={unit} />}
    <Card tone="primary">
      <SectionTitle>Log a weigh-in</SectionTitle>
      {availability === 'opening' && <ActivityIndicator color={colors.focus} accessibilityLabel="Opening progress log" />}
      {availability === 'failed' && <Notice kind="error">Secure storage could not be opened. Reopen Levelmaxing and try again.</Notice>}
      {availability === 'ready' && <>
        <Field label={`Weight (${unit})`} keyboardType="decimal-pad" maxLength={8} editable={!saving} value={weight} onChangeText={setWeight} />
        <Field label="Date (YYYY-MM-DD)" autoCapitalize="none" autoCorrect={false} maxLength={10}
          editable={!saving} value={day} onChangeText={setDay} />
        <Action title={saving ? 'Saving…' : 'Save weight'} disabled={saving} onPress={() => { void submit(); }} />
        {notice && <Notice kind={hasError ? 'error' : 'success'}>{notice}</Notice>}
      </>}
    </Card>
    <Card>
      <SectionTitle>Recent weigh-ins</SectionTitle>
      <Notice>{statuses[syncState]}</Notice>
      {entries.length === 0 && availability === 'ready' && <Notice>No weigh-ins recorded yet.</Notice>}
      {entries.map(entry => <StatRow key={entry.id} title={formatWeight(entry.grams, unit)}
        detail={entry.measuredOn} metric={entryStatus[entry.state]} warning={entry.state === 'review'} />)}
      {availability === 'ready' && <Action title="Sync now" disabled={syncState === 'running'} onPress={refresh} subtle />}
    </Card>
  </>;
}

function WeightTrend({ entries, unit }: { entries: Entry[]; unit: WeightUnit }) {
  const colors = useTheme();
  const newest = entries[0]!;
  const points = entries.slice(0, 12).reverse();
  const minimum = Math.min(...points.map(entry => entry.grams));
  const maximum = Math.max(...points.map(entry => entry.grams));
  const oldest = points[0]!;
  const difference = newest.grams - oldest.grams;
  return <Card tone="primary">
    <SectionTitle>Latest weight</SectionTitle>
    <Text style={[styles.display, { color: colors.text }]}>{formatWeight(newest.grams, unit)}</Text>
    {points.length === 1 ? <Notice>{newest.measuredOn}</Notice> : <>
      <Notice>{difference === 0 ? 'No change' : `${formatWeight(Math.abs(difference), unit)} ${difference > 0 ? 'higher' : 'lower'}`} · Latest {points.length} entries</Notice>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.chart}>
        {points.map(entry => <View key={entry.id} style={[styles.bar, {
          height: 16 + 58 * ((entry.grams - minimum) / (maximum - minimum || 1)),
          backgroundColor: entry.id === newest.id ? colors.primary : colors.border,
        }]} />)}
      </View>
      <View style={styles.chartLabels}><Notice>{oldest.measuredOn}</Notice><Notice>{newest.measuredOn}</Notice></View>
    </>}
  </Card>;
}

function TrainingStats({ history, unit, onHistory }: { history: Workout[]; unit: WeightUnit; onHistory: () => void }) {
  const colors = useTheme();
  const dates = recentDays(28);
  const firstDay = dates[0]!.date;
  const lastDay = dates[dates.length - 1]!.date;
  const summary = useMemo(() => {
    const byDay = new Map<string, number>();
    const strongest = new Map<string, { name: string; grams: number; reps: number }>();
    let sessions = 0;
    let sets = 0;
    for (const workout of history) {
      if (!workout.finishedAt) continue;
      const day = todayLocal(new Date(workout.finishedAt));
      if (day < firstDay || day > lastDay) continue;
      sessions += 1;
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      for (const move of workout.exercises) {
        const movement = move.name.trim().toLowerCase();
        for (const set of move.logged) {
          sets += 1;
          if (set.grams === 0) continue;
          const previous = strongest.get(movement);
          if (!previous || previous.grams < set.grams || (previous.grams === set.grams && previous.reps < set.reps)) {
            strongest.set(movement, { name: move.name, grams: set.grams, reps: set.reps });
          }
        }
      }
    }
    return { byDay, sessions, sets, top: [...strongest.values()].sort((a, b) => b.grams - a.grams).slice(0, 5) };
  }, [history, firstDay, lastDay]);

  return <>
    <Card tone="success">
      <SectionTitle>Training · Last 28 days</SectionTitle>
      <Text style={[styles.display, { color: colors.text }]}>{summary.sessions} {summary.sessions === 1 ? 'session' : 'sessions'}</Text>
      <Notice>{summary.sets} {summary.sets === 1 ? 'set' : 'sets'} logged · {summary.byDay.size} training days</Notice>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.calendar}>
        {dates.map(day => <View key={day.date}
          style={[styles.day, { backgroundColor: summary.byDay.has(day.date) ? colors.successGraphic : colors.canvas }]} />)}
      </View>
      <Action title="View workout history" subtle onPress={onHistory} />
    </Card>
    <Card>
      <SectionTitle>Highest loads logged</SectionTitle>
      {summary.top.length === 0 && <Notice>Log a loaded set to see your recent strength history.</Notice>}
      {summary.top.map(move => <StatRow key={move.name.toLowerCase()} title={move.name}
        detail={`${move.reps} ${move.reps === 1 ? 'rep' : 'reps'}`} metric={formatWeight(move.grams, unit)} />)}
    </Card>
  </>;
}

function ActivityStats({ activities, onOpen }: { activities: Activity[]; onOpen: () => void }) {
  const colors = useTheme();
  const dates = recentDays(7);
  const byDate = new Map(dates.map(day => [day.date, 0]));
  for (const activity of activities) {
    const previous = byDate.get(activity.date);
    if (previous !== undefined) byDate.set(activity.date, previous + activity.minutes);
  }
  const minutes = [...byDate.values()].reduce((sum, value) => sum + value, 0);
  const recent = activities.slice().sort((first, second) => second.date.localeCompare(first.date)).slice(0, 5);

  return <>
    <Card tone="accent">
      <SectionTitle>Activity · Last 7 days</SectionTitle>
      <Text style={[styles.display, { color: colors.text }]}>{minutes.toLocaleString()} min</Text>
      {minutes > 0 ? dates.map(day => <StatRow key={day.date} title={day.weekday} detail={day.date}
        metric={`${byDate.get(day.date)} min`} />) : <Notice>Record an activity to track your movement outside workouts.</Notice>}
      <Action title="Log activity" subtle onPress={onOpen} />
    </Card>
    {recent.length > 0 && <Card>
      <SectionTitle>Recent activities</SectionTitle>
      {recent.map(activity => <StatRow key={activity.id} title={activity.name} detail={activity.date}
        metric={`${activity.minutes} min`} />)}
    </Card>}
  </>;
}

function StatRow({ title, detail, metric, warning = false }: { title: string; detail: string; metric: string; warning?: boolean }) {
  const colors = useTheme();
  return <View style={[styles.row, { borderColor: colors.border }]}>
    <View style={styles.entry}>
      <Text style={[styles.label, { color: colors.text }]}>{title}</Text>
      <Text style={{ color: colors.muted }}>{detail}</Text>
    </View>
    <Text style={[styles.metric, { color: warning ? colors.error : colors.muted }]}>{metric}</Text>
  </View>;
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  display: { fontSize: 34, fontWeight: '900', letterSpacing: -1.3 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, minHeight: 76 },
  bar: { flex: 1, borderRadius: 8 },
  chartLabels: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 4 },
  label: { fontSize: 16, fontWeight: '800' },
  row: { borderTopWidth: 1, paddingTop: 10, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  entry: { gap: 3, flexShrink: 1 },
  metric: { alignSelf: 'center', flexShrink: 1, fontWeight: '700' },
  calendar: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  day: { flexBasis: '12.8%', flexGrow: 1, aspectRatio: 1, borderRadius: 8 },
});
