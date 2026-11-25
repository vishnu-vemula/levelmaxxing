import type { LoggedSet, Workout, WorkoutExercise } from '@levelmaxing/contracts';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { dateKey } from '../../shared/local-date.ts';
import { useWorkspace } from '../workspace/index.ts';
import { Action, Card, Field, Notice, Pill, ProgressBar, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';
import {
  changeRest, correctWorkoutDate, displayLoad, emptyTraining, finishWorkout, formatClock, MAX_SETS, parseLoad, parseReps,
  removeWorkoutLog, restRemaining, setWorkoutExercise, setWorkoutLog, updatePastSet, workoutShareContent, workoutShareFields,
  workoutTotals, type WeightUnit, type WorkoutShareField,
} from './model.ts';
import {
  SaveError, SwapExercise, TrainingCopy, TrainingHeading, TrainingHero, TrainingLink, TrainingSyncStatus, trainingStyles,
} from './TrainingComponents.tsx';

const historyPageSize = 20;

export function WorkoutScreen() {
  const { value: snapshot, save, status } = useWorkspace('training');
  const { value: profile } = useWorkspace('profile');
  const value = snapshot ?? emptyTraining;
  const unit = profile?.units ?? 'kg';
  const router = useRouter();
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [tab, setTab] = useState<'live' | 'history'>(view === 'history' ? 'history' : 'live');
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(historyPageSize);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  const workout = value.session;
  const selected = value.history.find(({ id }) => id === selectedHistoryId);

  async function perform(operation: () => Promise<void>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this workout.');
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  if (status === 'loading' || status === 'unavailable' || status === 'conflict') {
    return <Screen title="Workout"><TrainingSyncStatus /></Screen>;
  }

  function showHistory() {
    setSelectedHistoryId(null);
    setTab('history');
    setError('');
  }

  if (selected) return <WorkoutSummary key={selected.id} workout={selected} unit={unit} disabled={busy} error={error} onBack={showHistory}
    onCorrect={(exerciseId, set) => perform(() => save(updatePastSet(value, selected.id, exerciseId, set)))}
    onDateChange={(expectedFinish, date) => perform(() => save(correctWorkoutDate(value, selected.id, expectedFinish, date, new Date())))}
    onDelete={() => {
      void perform(async () => {
        await save({ ...value, history: value.history.filter(({ id }) => id !== selected.id) });
        showHistory();
      });
    }} />;

  return <Screen title={tab === 'live' ? 'Workout' : 'Workout history'} onBack={router.canGoBack() ? () => router.back() : undefined}>
    <TrainingSyncStatus />
    <View style={trainingStyles.wrap}>
      <Pill label="Session" selected={tab === 'live'} onPress={() => { setError(''); setTab('live'); }} disabled={busy} />
      <Pill label="History" selected={tab === 'history'} onPress={() => { setError(''); setTab('history'); }} disabled={busy} />
    </View>
    {error ? <SaveError message={error} /> : null}
    {tab === 'live' && workout && <LiveWorkout key={workout.id} workout={workout} history={value.history} disabled={busy} unit={unit}
      onLog={(exerciseId, set) => perform(() => save(setWorkoutLog(value, exerciseId, set, Date.now())))}
      onRemove={(exerciseId, setId) => perform(() => save(removeWorkoutLog(value, exerciseId, setId)))}
      onSwap={(exerciseId, name) => perform(() => save(setWorkoutExercise(value, exerciseId, name)))}
      onRest={(operation) => { void perform(() => save(changeRest(value, Date.now(), operation))); }}
      onDiscard={() => { void perform(() => save({ ...value, session: null })); }}
      onFinish={() => {
        void perform(async () => {
          await save(finishWorkout(value, workout.id, Date.now()));
          setSelectedHistoryId(workout.id);
          setTab('history');
        });
      }} />}
    {tab === 'live' && !workout && <Card tone="primary">
      <SectionTitle>Ready to train?</SectionTitle>
      <TrainingCopy>Start a session from a training day. Your logged sets will be here when you return.</TrainingCopy>
      <Action title="Go to Training" onPress={() => router.replace('/program')} />
    </Card>}
    {tab === 'history' && <>
      <Action title="Workout archive" subtle onPress={() => router.push({ pathname: '/history', params: { kind: 'workouts' } })} />
      {value.history.length ? value.history.slice(0, historyLimit).map((item) => {
        const totals = workoutTotals(item, Date.now());
        return <WorkoutHistoryRow key={item.id} workout={item} sets={totals.sets}
          onPress={() => setSelectedHistoryId(item.id)} />;
      }) : <Card>
        <SectionTitle>No workouts yet</SectionTitle>
        <TrainingCopy>Finished sessions and logged sets appear here.</TrainingCopy>
      </Card>}
      {value.history.length > historyLimit && <Action title="Show more workouts" subtle
        onPress={() => setHistoryLimit((limit) => limit + historyPageSize)} />}
    </>}
  </Screen>;
}

type LiveWorkoutProps = {
  workout: Workout; history: Workout[]; disabled: boolean; unit: WeightUnit;
  onLog: (exerciseId: string, set: LoggedSet) => Promise<boolean>;
  onRemove: (exerciseId: string, setId: string) => Promise<boolean>;
  onSwap: (exerciseId: string, name: string) => Promise<boolean>;
  onRest: (operation: 'extend' | 'skip') => void;
  onDiscard: () => void; onFinish: () => void;
};

function LiveWorkout({ workout, history, disabled, unit, onLog, onRemove, onSwap, onRest, onDiscard, onFinish }: LiveWorkoutProps) {
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(() => (
    workout.exercises.find((item) => item.logged.length < item.sets)?.id ?? workout.exercises[0]?.id ?? null
  ));
  const [confirmation, setConfirmation] = useState<'finish' | 'discard' | null>(null);
  const total = workoutTotals(workout, Date.now());
  const complete = workout.exercises.reduce((sum, exercise) => sum + Math.min(exercise.sets, exercise.logged.length), 0);

  return <>
    <TrainingHero label="In session" title={workout.name} detail={`${total.sets} logged · ${total.planned} planned`}>
      <ElapsedTimer startedAt={workout.startedAt} />
    </TrainingHero>
    <ProgressBar value={total.planned ? complete / total.planned * 100 : 0} label="Planned sets completed" />
    <RestTimer deadline={workout.restEndsAt} disabled={disabled} onRest={onRest} />
    <SectionTitle>Exercises</SectionTitle>
    {workout.exercises.map((exercise, index) => (
      <ExerciseCard key={exercise.id} exercise={exercise} number={index + 1} expanded={exercise.id === activeExerciseId}
        disabled={disabled} unit={unit} onToggle={() => setActiveExerciseId(exercise.id === activeExerciseId ? null : exercise.id)}
        previous={exercise.id === activeExerciseId ? previousSets(history, exercise) : []}
        onLog={(set) => onLog(exercise.id, set)} onRemove={(id) => onRemove(exercise.id, id)}
        onSwap={(name) => onSwap(exercise.id, name)} />
    ))}
    {confirmation === 'finish' && <Card tone="accent">
      <SectionTitle>Finish this workout?</SectionTitle>
      {complete < total.planned && <TrainingCopy>{total.planned - complete} planned sets are still unlogged.</TrainingCopy>}
      <Action title="Finish and save" disabled={disabled} tone="accent" onPress={onFinish} />
      <Action title="Keep training" disabled={disabled} subtle onPress={() => setConfirmation(null)} />
    </Card>}
    {confirmation === 'discard' && <Card tone="accent">
      <SectionTitle>Discard this workout?</SectionTitle>
      <TrainingCopy>Logged sets from this session will be removed.</TrainingCopy>
      <Action title="Discard session" disabled={disabled} tone="accent" onPress={onDiscard} />
      <Action title="Keep training" disabled={disabled} subtle onPress={() => setConfirmation(null)} />
    </Card>}
    {!confirmation && <>
      {total.sets > 0 && <Action title="Finish workout" tone="accent" disabled={disabled} onPress={() => setConfirmation('finish')} />}
      <TrainingLink title="Discard workout" disabled={disabled} onPress={() => setConfirmation('discard')} />
    </>}
  </>;
}

function ExerciseCard({ exercise, number, expanded, disabled, unit, onToggle, previous, onLog, onRemove, onSwap }: {
  exercise: WorkoutExercise; number: number; expanded: boolean; disabled: boolean; unit: WeightUnit; onToggle: () => void;
  previous: readonly LoggedSet[]; onLog: (set: LoggedSet) => Promise<boolean>; onRemove: (id: string) => Promise<boolean>;
  onSwap: (name: string) => Promise<boolean>;
}) {
  const [swap, setSwap] = useState(false);
  const [addingExtra, setAddingExtra] = useState(false);
  const colors = useTheme();
  const full = exercise.logged.length >= exercise.sets;
  return <>
    <Card tone={full ? 'success' : 'neutral'}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded, disabled }} disabled={disabled} onPress={onToggle}
        style={({ pressed }) => [styles.exerciseTitle, { opacity: pressed ? 0.7 : 1 }]}>
        <View style={trainingStyles.grow}>
          <TrainingHeading>{number}. {exercise.name}</TrainingHeading>
          <TrainingCopy>{exercise.sets} × {exercise.reps} reps · {exercise.restSeconds} s rest</TrainingCopy>
        </View>
        <Text style={[styles.badge, { color: colors.text, backgroundColor: colors.canvas }]}>
          {exercise.logged.length}/{exercise.sets}
        </Text>
      </Pressable>
      {expanded && <>
        {exercise.logged.length === 0 && <TrainingLink title="Swap for this workout" disabled={disabled}
          onPress={() => setSwap((current) => !current)} />}
        {exercise.logged.map((set, index) => <SetEditor key={`${set.id}:${unit}`} index={index} plannedReps={exercise.reps} disabled={disabled} unit={unit}
          existing={set} previous={previous[index]} onCommit={onLog} onRemove={() => onRemove(set.id)} />)}
        {exercise.logged.length < MAX_SETS && (full && !addingExtra
          ? <TrainingLink title="Add extra set" disabled={disabled} onPress={() => setAddingExtra(true)} />
          : <SetEditor key={`new:${exercise.name}:${exercise.logged.length}:${unit}`} index={exercise.logged.length}
            plannedReps={exercise.reps} disabled={disabled} unit={unit} previous={previous[exercise.logged.length]}
            defaultLoad={exercise.logged.at(-1)?.grams}
            onCommit={async (set) => {
              const saved = await onLog(set);
              if (saved) setAddingExtra(false);
              return saved;
            }} />
        )}
      </>}
    </Card>
    {expanded && swap && exercise.logged.length === 0 && <SwapExercise name={exercise.name} disabled={disabled}
      onCancel={() => setSwap(false)} onSave={(name) => {
        if (name === exercise.name) {
          setSwap(false);
          return;
        }
        void onSwap(name).then((saved) => { if (saved) setSwap(false); });
      }} />}
  </>;
}

function SetEditor({ index, plannedReps, disabled, existing, previous, unit, defaultLoad, onCommit, onRemove }: {
  index: number; plannedReps: number; disabled: boolean; existing?: LoggedSet; previous?: LoggedSet;
  unit: WeightUnit; defaultLoad?: number;
  onCommit: (set: LoggedSet) => Promise<boolean>; onRemove?: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(!existing);
  const [baseline, setBaseline] = useState<LoggedSet>();
  const [reps, setReps] = useState(String(existing?.reps ?? plannedReps));
  const [weight, setWeight] = useState(String(displayLoad(existing?.grams ?? previous?.grams ?? defaultLoad ?? 0, unit)));
  const [error, setError] = useState('');
  const colors = useTheme();
  const changed = Boolean(baseline && existing &&
    (baseline.id !== existing.id || baseline.reps !== existing.reps || baseline.grams !== existing.grams));
  function load(set: LoggedSet) {
    setWeight(String(displayLoad(set.grams, unit)));
    setReps(String(set.reps));
    setBaseline(set);
    setError('');
  }
  return <View style={[styles.setRow, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
    <TrainingHeading>Set {index + 1}</TrainingHeading>
    {editing ? <>
      {previous && <TrainingCopy>Previous: {displayLoad(previous.grams, unit)} {unit} × {previous.reps}</TrainingCopy>}
      <View style={trainingStyles.wrap}>
        <View style={trainingStyles.numeric}>
          <Field label={`Weight (${unit})`} accessibilityLabel={`Set ${index + 1} weight in ${unit === 'kg' ? 'kilograms' : 'pounds'}`}
            keyboardType="decimal-pad" value={weight} onChangeText={setWeight} maxLength={8} editable={!disabled} />
        </View>
        <View style={trainingStyles.numeric}>
          <Field label="Reps" accessibilityLabel={`Set ${index + 1} reps`}
            keyboardType="number-pad" value={reps} onChangeText={setReps} maxLength={4} editable={!disabled} />
        </View>
      </View>
      {error ? <SaveError message={error} /> : null}
      {changed && existing && <>
        <Notice kind="error">This set changed on another device. Load the latest values before saving.</Notice>
        <Action title="Load latest set" subtle disabled={disabled} onPress={() => load(existing)} />
      </>}
      <Action title={existing ? 'Update set' : 'Log set'} disabled={disabled || changed} onPress={() => {
        try {
          const set = { id: existing?.id ?? randomUUID(), reps: parseReps(reps), grams: parseLoad(weight, unit) };
          setError('');
          void onCommit(set).then((saved) => {
            if (!saved) setError('Your changes are still entered. Try saving this set again.');
            else if (existing) setEditing(false);
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Enter a valid weight and number of reps.');
        }
      }} />
      {existing && <Action title="Cancel set edit" subtle disabled={disabled} onPress={() => { setEditing(false); setError(''); }} />}
    </> : existing && <>
      <TrainingCopy>{displayLoad(existing.grams, unit)} {unit} × {existing.reps} reps · Logged</TrainingCopy>
      <View style={trainingStyles.wrap}>
        <TrainingLink title="Edit set" hint={`Change set ${index + 1}`} disabled={disabled} onPress={() => {
          load(existing);
          setEditing(true);
        }} />
        {onRemove && <TrainingLink title="Remove set" hint={`Remove set ${index + 1}`}
          disabled={disabled} onPress={() => { void onRemove(); }} />}
      </View>
    </>}
  </View>;
}

function useClock(running: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const update = () => setNow(Date.now());
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') update(); });
    update();
    const timer = setInterval(update, 1_000);
    return () => { clearInterval(timer); listener.remove(); };
  }, [running]);
  return now;
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const colors = useTheme();
  const now = useClock(true);
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1_000));
  return <Text style={[styles.elapsed, { color: colors.onPrimary }]}>Elapsed {formatClock(seconds)}</Text>;
}

function RestTimer({ deadline, disabled, onRest }: {
  deadline: string | null | undefined; disabled: boolean; onRest: (operation: 'extend' | 'skip') => void;
}) {
  const colors = useTheme();
  const [elapsedDeadline, setElapsedDeadline] = useState<string | null>(null);
  const running = !!deadline && elapsedDeadline !== deadline;
  const now = useClock(running);
  const seconds = restRemaining(deadline, running ? Math.max(Date.now(), now) : now);

  useEffect(() => {
    if (deadline && seconds === 0) setElapsedDeadline(deadline);
  }, [deadline, seconds]);

  if (!running) {
    return deadline && elapsedDeadline === deadline ? <Notice kind="success">Rest complete</Notice> : null;
  }
  return <Card tone="primary">
    <View style={trainingStyles.line}>
      <View style={trainingStyles.grow}>
        <TrainingHeading>Rest</TrainingHeading>
        <Text style={[styles.timer, { color: colors.text }]} accessibilityLabel={`${seconds} seconds of rest remaining`}>
          {formatClock(seconds)}
        </Text>
      </View>
      <View style={trainingStyles.wrap}>
        <Pill label="+15 s" onPress={() => onRest('extend')} disabled={disabled || seconds === 0} />
        <Pill label="Skip" onPress={() => onRest('skip')} disabled={disabled || seconds === 0} />
      </View>
    </View>
  </Card>;
}

function WorkoutHistoryRow({ workout, sets, onPress }: { workout: Workout; sets: number; onPress: () => void }) {
  return <Card>
    <TrainingHeading>{workout.name}</TrainingHeading>
    <TrainingCopy>{displayDate(workout.finishedAt ?? workout.startedAt)} · {sets} {sets === 1 ? 'set' : 'sets'}</TrainingCopy>
    <TrainingLink title="View workout" hint={`View ${workout.name} details`} onPress={onPress} />
  </Card>;
}

const workoutShareLabels = { name: 'Workout name', date: 'Date', duration: 'Duration', sets: 'Sets', volume: 'Volume' };

function WorkoutSummary({ workout, unit, disabled, error, onBack, onCorrect, onDateChange, onDelete }: {
  workout: Workout; unit: WeightUnit; disabled: boolean; error: string; onBack: () => void;
  onCorrect: (exerciseId: string, set: LoggedSet) => Promise<boolean>;
  onDateChange: (expectedFinish: string, date: string) => Promise<boolean>; onDelete: () => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [dateEdit, setDateEdit] = useState<{ date: string; expectedFinish: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareFields, setShareFields] = useState<Set<WorkoutShareField> | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const openingShare = useRef(false);
  const totals = workoutTotals(workout, Date.now());
  const date = displayDate(workout.finishedAt ?? workout.startedAt);
  const details = {
    name: workout.name, date, duration: formatClock(totals.seconds), sets: `${totals.sets} ${totals.sets === 1 ? 'set' : 'sets'}`,
    volume: `${displayLoad(totals.volume, unit).toLocaleString()} ${unit} lifted`,
  };
  const stats = `${details.duration} · ${details.sets} · ${details.volume}`;
  const shareContent = shareFields && workoutShareContent(details, shareFields);

  async function share() {
    if (!shareContent || openingShare.current) return;
    openingShare.current = true;
    setSharing(true);
    setShareError('');
    try {
      await Share.share(shareContent);
      setShareFields(null);
    } catch {
      setShareError('The workout could not be shared. Try again.');
    } finally {
      openingShare.current = false;
      setSharing(false);
    }
  }

  return <Screen title="Workout recap" detail={date}>
    <TrainingSyncStatus />
    {error && <SaveError message={error} />}
    <TrainingHero label="Workout saved" title={workout.name} detail={stats} />
    <SectionTitle>Logged exercises</SectionTitle>
    {workout.exercises.filter((exercise) => exercise.logged.length > 0).map((exercise) => <Card key={exercise.id}>
      <TrainingHeading>{exercise.name}</TrainingHeading>
      {exercise.logged.map((set, index) => correcting
        ? <SetEditor key={`${set.id}:${unit}`} index={index} plannedReps={exercise.reps} disabled={disabled}
          unit={unit} existing={set} onCommit={(logged) => onCorrect(exercise.id, logged)} />
        : <TrainingCopy key={set.id}>Set {index + 1}: {displayLoad(set.grams, unit)} {unit} × {set.reps}</TrainingCopy>)}
    </Card>)}
    {confirmDelete ? <Card tone="accent">
      <SectionTitle>Delete this workout?</SectionTitle>
      <TrainingCopy>It will be removed from your history and synced devices.</TrainingCopy>
      <Action title="Delete workout" tone="accent" disabled={disabled} onPress={onDelete} />
      <Action title="Keep workout" subtle disabled={disabled} onPress={() => setConfirmDelete(false)} />
    </Card> : dateEdit ? <Card>
      <SectionTitle>Correct workout date</SectionTitle>
      <TrainingCopy>Originally logged on {displayDate(dateEdit.expectedFinish)}. Saving moves this workout and its sets to the selected date in History and Progress.</TrainingCopy>
      <Field label="Workout date (YYYY-MM-DD)" value={dateEdit.date} maxLength={10} editable={!disabled}
        onChangeText={(date) => setDateEdit({ ...dateEdit, date })} />
      <Action title="Save workout date" disabled={disabled || !dateEdit.date.trim()} onPress={() => {
        void onDateChange(dateEdit.expectedFinish, dateEdit.date).then((saved) => { if (saved) setDateEdit(null); });
      }} />
      <Action title="Cancel date change" subtle disabled={disabled} onPress={() => setDateEdit(null)} />
    </Card> : shareFields ? <Card>
      <SectionTitle>Choose what to share</SectionTitle>
      <View style={trainingStyles.wrap}>
        {workoutShareFields.map((field) => <Pill key={field} label={workoutShareLabels[field]}
          selected={shareFields.has(field)} disabled={sharing} onPress={() => setShareFields((previous) => {
            if (!previous) return null;
            const next = new Set(previous);
            if (next.has(field)) next.delete(field);
            else next.add(field);
            return next;
          })} />)}
      </View>
      {shareContent && <TrainingCopy>{shareContent.message}</TrainingCopy>}
      {shareError && <SaveError message={shareError} />}
      <Action title="Open share sheet" onPress={() => { void share(); }} disabled={disabled || sharing || !shareContent} />
      <Action title="Cancel sharing" onPress={() => { setShareError(''); setShareFields(null); }} subtle disabled={sharing} />
    </Card> : <>
      <Action title={correcting ? 'Done editing' : 'Correct logged sets'} onPress={() => setCorrecting(!correcting)} subtle disabled={disabled} />
      {workout.finishedAt && <Action title="Correct workout date" subtle disabled={disabled || correcting} onPress={() => {
        if (workout.finishedAt) setDateEdit({ date: dateKey(new Date(workout.finishedAt)), expectedFinish: workout.finishedAt });
      }} />}
      <Action title="Share workout summary" onPress={() => setShareFields(new Set())} subtle disabled={disabled || correcting} />
      <TrainingLink title="Delete workout" disabled={disabled} onPress={() => setConfirmDelete(true)} />
    </>}
    <Action title="Back to workout history" onPress={onBack} subtle disabled={disabled || sharing} />
  </Screen>;
}

function previousSets(history: Workout[], exercise: WorkoutExercise): readonly LoggedSet[] {
  for (const workout of history) {
    const previous = workout.exercises.find((item) => item.id === exercise.id && item.name === exercise.name && item.logged.length);
    if (previous) return previous.logged;
  }
  return [];
}

function displayDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

const styles = StyleSheet.create({
  exerciseTitle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { borderRadius: 20, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5, fontWeight: '800' },
  setRow: { padding: 12, borderWidth: 1, borderRadius: 18, gap: 10 },
  elapsed: { fontWeight: '800', fontSize: 15, fontVariant: ['tabular-nums'] },
  timer: { fontWeight: '900', fontSize: 34, fontVariant: ['tabular-nums'] },
});
