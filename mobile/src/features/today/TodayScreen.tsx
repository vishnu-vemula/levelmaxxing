import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Action, Card, Mascot, Notice, Pill, ProgressBar, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';
import { formatWeight, todayLocal, useProgress } from '../progress/index.ts';
import { useWorkspace } from '../workspace/index.ts';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function TodayScreen() {
  const colors = useTheme();
  const router = useRouter();
  const profile = useWorkspace('profile').value;
  const training = useWorkspace('training').value;
  const nutrition = useWorkspace('nutrition');
  const journal = useWorkspace('journal').value;
  const { entries } = useProgress();
  const now = new Date();
  const date = todayLocal(now);
  const weekday = now.getDay();
  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  const name = profile?.name.trim().split(/\s+/, 1)[0];
  const planned = training?.programs.find(program => program.id === training.activeProgramId);
  const scheduled = planned?.days.find(day => day.weekday === weekday);
  const lastWorkout = training?.history.find(workout => workout.finishedAt && todayLocal(new Date(workout.finishedAt)) === date);
  const session = training?.session;
  const currentWorkout = session ?? lastWorkout ?? scheduled;
  const latest = entries[0];
  const loggedToday = entries.some(entry => entry.measuredOn === date);
  const checkedToday = journal?.checkIns.some(checkIn => checkIn.date === date);
  const totals = (nutrition.value?.meals ?? []).reduce((total, meal) => {
    if (meal.date !== date) return total;
    total.calories += meal.macros.calories;
    total.protein += meal.macros.protein;
    total.carbs += meal.macros.carbs;
    total.fat += meal.macros.fat;
    return total;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const target = profile?.calories ?? null;
  const remaining = target === null ? null : target - totals.calories;
  const quick = [
    { title: 'Search food', detail: 'Find food you logged before', route: '/food', tone: 'primary' },
    { title: 'Recipes', detail: 'Your saved meals', route: '/recipes', tone: 'accent' },
    { title: 'Enter barcode', detail: 'Find a product you logged before', route: '/food', mode: 'barcode', tone: 'success' },
    { title: 'Learn a lift', detail: 'Exercise library', route: '/library', tone: 'neutral' },
  ] as const;

  return <Screen title={name ? `Hey, ${name}` : 'Today'} detail={today}
    accessory={<Pill label="Ask Max" onPress={() => router.push('/coach')} />}>
    <Text accessibilityRole="header" style={[styles.headline, { color: colors.text }]}>
      {session ? 'Pick up where you left off.' : lastWorkout ? 'Session done.' : scheduled ? `${scheduled.name} is up.` : 'Make today count.'}
      {'\n'}<Text style={{ color: lastWorkout && !session ? colors.success : colors.primary }}>
        {lastWorkout && !session ? 'Now refuel.' : 'Let’s move.'}
      </Text>
    </Text>

    <Card style={{ backgroundColor: colors.primary }}>
      <View style={styles.split}>
        <View style={styles.flex}>
          <Text style={[styles.eyebrow, { color: colors.onPrimary }]}>
            {session ? 'Workout in progress' : lastWorkout ? 'Completed today' : 'Training'}
          </Text>
          <Text style={[styles.heroTitle, { color: colors.onPrimary }]}>
            {currentWorkout?.name ?? planned?.name ?? 'Your training program'}
          </Text>
          <Text style={{ color: colors.onPrimary }}>
            {currentWorkout ? `${currentWorkout.exercises.length} exercises` : planned ? 'Choose a session from your program.' : 'Choose or build a program to get started.'}
          </Text>
        </View>
        <Mascot tone="sun" size={74} />
      </View>
      <Action title={session ? 'Resume workout' : lastWorkout ? 'View workout history' : 'Open training'} subtle
        onPress={() => session ? router.push('/workout') : lastWorkout ?
          router.push({ pathname: '/workout', params: { view: 'history' } }) : router.push('/program')} />
    </Card>

    <Card tone="accent">
      <SectionTitle>Food today</SectionTitle>
      {nutrition.status === 'loading' ? <Notice>Opening your diary…</Notice> : <>
        <Text style={[styles.calories, { color: colors.text }]}>
          {number.format(totals.calories)} <Text style={styles.unit}>kcal logged</Text>
        </Text>
        {target !== null && remaining !== null ? <>
          <ProgressBar value={totals.calories / target * 100} label="Daily calorie target progress" />
          <Notice>{number.format(Math.abs(remaining))} kcal {remaining >= 0 ? 'left' : 'over target'} · {number.format(target)} kcal target</Notice>
        </> : <Notice>No daily calorie target set.</Notice>}
        <View style={styles.macroRow}>
          {[
            { label: 'Protein', grams: totals.protein },
            { label: 'Carbs', grams: totals.carbs },
            { label: 'Fat', grams: totals.fat },
          ].map(macro => <View key={macro.label} style={styles.macro}>
            <Text style={[styles.macroTitle, { color: colors.text }]}>{number.format(macro.grams)} g</Text>
            <Text style={{ color: colors.muted }}>{macro.label}</Text>
          </View>)}
        </View>
      </>}
      <Action title="Open food diary" subtle onPress={() => router.push('/nutrition')} />
    </Card>

    <SectionTitle>Daily check-in</SectionTitle>
    <DailyCard title={checkedToday ? 'Check-in logged' : 'How are you feeling?'} detail="Review energy, hunger, and sleep"
      action={checkedToday ? 'Review' : 'Check in'} tone="primary" onPress={() => router.push('/check-in')} />
    <DailyCard title={loggedToday ? 'Weigh-in logged' : 'Weigh-in'} detail={latest ? `Latest: ${formatWeight(latest.grams, profile?.units)} · ${latest.measuredOn}` : 'Start a weight history'}
      action={loggedToday ? 'Review' : 'Log weight'} tone="success" onPress={() => router.push('/progress')} />

    <SectionTitle>Quick actions</SectionTitle>
    <View style={styles.quickGrid}>
      {quick.map(item => <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={item.title}
        onPress={() => 'mode' in item ? router.push({ pathname: '/food', params: { mode: item.mode } }) : router.push(item.route)} style={({ pressed }) => [styles.quick, { opacity: pressed ? 0.75 : 1 }]}>
        <Card tone={item.tone} style={styles.quickCard}>
          <Text accessible={false} style={[styles.arrow, { color: colors.primary }]}>↗</Text>
          <Text style={[styles.quickTitle, { color: colors.text }]}>{item.title}</Text>
          <Text style={{ color: colors.muted }}>{item.detail}</Text>
        </Card>
      </Pressable>)}
    </View>
    <Action title="Account settings" subtle onPress={() => router.push('/settings')} />
    <Action title="More tools" subtle onPress={() => router.push('/more')} />
  </Screen>;
}

function DailyCard({ title, detail, action, tone, onPress }: {
  title: string; detail: string; action: string; tone: 'primary' | 'success'; onPress: () => void;
}) {
  const colors = useTheme();
  return <Card tone={tone} style={styles.daily}>
    <View style={styles.dailyCopy}>
      <Text style={[styles.quickTitle, { color: colors.text }]}>{title}</Text>
      <Text style={{ color: colors.muted }}>{detail}</Text>
    </View>
    <Action title={action} subtle onPress={onPress} />
  </Card>;
}

const styles = StyleSheet.create({
  headline: { fontSize: 34, fontWeight: '900', letterSpacing: -1.5 },
  split: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, gap: 5 },
  eyebrow: { fontSize: 14, fontWeight: '800' },
  heroTitle: { fontSize: 29, fontWeight: '900', letterSpacing: -1.2 },
  calories: { fontSize: 30, fontWeight: '900', letterSpacing: -1 },
  unit: { fontSize: 16, letterSpacing: 0 },
  macroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  macro: { minWidth: 68, flexGrow: 1, gap: 3 },
  macroTitle: { fontSize: 19, fontWeight: '900' },
  daily: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  dailyCopy: { flexGrow: 1, flexBasis: 130, gap: 4 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  quick: { flexBasis: '46%', flexGrow: 1, minWidth: 140 },
  quickCard: { flex: 1, gap: 5 },
  quickTitle: { fontSize: 17, fontWeight: '900' },
  arrow: { alignSelf: 'flex-end', fontSize: 21, fontWeight: '700' },
});
