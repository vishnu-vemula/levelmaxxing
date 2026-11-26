import type { PlanExercise, Program, TrainingDay } from '@levelmaxing/contracts';
import { randomUUID } from '../../platform/native-storage.ts';
import { useRouter } from '../../shared/navigation.tsx';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useWorkspace } from '../workspace/index.ts';
import { Action, Card, Field, Pill, Screen, SectionTitle } from '../../shared/ui.tsx';
import {
  dayForToday, deleteProgram, duplicateProgram, emptyTraining, makeDay, makeExercise, makeProgram, MAX_DAYS, MAX_EXERCISES, MAX_NAME_LENGTH,
  MAX_PROGRAMS, saveProgram, starterRoutines, startWorkout,
} from './model.ts';
import {
  SaveError, SwapExercise, TrainingCopy, TrainingHeading, TrainingHero, TrainingLink, TrainingSyncStatus, trainingStyles,
} from './TrainingComponents.tsx';

const daysOfWeek = Array.from({ length: 7 }, (_, index) => {
  const day = new Date(Date.UTC(2024, 0, 7 + index));
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(day);
});

export function ProgramScreen() {
  const { value: snapshot, save, status } = useWorkspace('training');
  const value = snapshot ?? emptyTraining;
  const router = useRouter();
  const [tab, setTab] = useState<'active' | 'programs'>('active');
  const [draft, setDraft] = useState<Program | null>(null);
  const [draftOriginal, setDraftOriginal] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [swapId, setSwapId] = useState<string | null>(null);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = value.programs.find(({ id }) => id === value.activeProgramId);
  const today = active ? dayForToday(active, new Date()) : undefined;
  const day = active?.days.find(({ id }) => id === selectedDay) ?? today ?? active?.days[0];

  async function perform(operation: () => Promise<void>) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save training.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  function openDraft(program: Program) {
    setError('');
    setDraft(program);
    const original = value.programs.find(({ id }) => id === program.id);
    setDraftOriginal(original ? JSON.stringify(original) : null);
    setSwapId(null);
  }

  if (status === 'loading' || status === 'unavailable' || status === 'conflict') {
    return <Screen title="Training"><TrainingSyncStatus /></Screen>;
  }

  if (draft) return <Screen title={value.programs.some(({ id }) => id === draft.id) ? 'Edit program' : 'New program'}>
    <ProgramEditor
      program={draft}
      onChange={setDraft}
      disabled={busy}
      onCancel={() => { setError(''); setDraft(null); }}
      onSave={() => {
        void perform(async () => {
          const latest = value.programs.find(({ id }) => id === draft.id);
          if ((latest ? JSON.stringify(latest) : null) !== draftOriginal) {
            throw new Error('This program changed while you were editing. Reopen it to use the latest version.');
          }
          const next = saveProgram(value, draft);
          await save(next);
          setDraft(null);
          setTab(next.activeProgramId === draft.id ? 'active' : 'programs');
        });
      }}
    />
    {error ? <SaveError message={error} /> : null}
  </Screen>;

  return <Screen title="Training">
    <TrainingSyncStatus />
    <View style={trainingStyles.wrap}>
      <Pill label="Active" selected={tab === 'active'} onPress={() => setTab('active')} disabled={busy} />
      <Pill label="Programs" selected={tab === 'programs'} onPress={() => setTab('programs')} disabled={busy} />
    </View>
    {error ? <SaveError message={error} /> : null}
    {value.session && <Card tone="accent">
      <TrainingHeading>{value.session.name} in progress</TrainingHeading>
      <Action title="Resume workout" tone="accent" onPress={() => router.push('/workout')} />
    </Card>}
    {tab === 'active' && active && day && <>
      <TrainingHero label="Active program" title={active.name}
        detail={`${active.days.length} ${active.days.length === 1 ? 'training day' : 'training days'}`}>
        <Action title="Edit program" subtle onPress={() => openDraft(active)} disabled={busy} />
      </TrainingHero>
      <SectionTitle>Schedule</SectionTitle>
      <View style={trainingStyles.dayPicker}>
        {active.days.map((item) => <Pill key={item.id}
          label={item.weekday === undefined ? item.name : `${daysOfWeek[item.weekday]} · ${item.name}`}
          selected={item.id === day.id} disabled={busy} onPress={() => { setSwapId(null); setSelectedDay(item.id); }} />)}
      </View>
      <View style={trainingStyles.stacked}>
        <SectionTitle>{today?.id === day.id ? `${day.name} · today` : day.name}</SectionTitle>
        <TrainingCopy>{day.exercises.length} exercises · {day.exercises.reduce((sum, item) => sum + item.sets, 0)} sets</TrainingCopy>
      </View>
      {day.exercises.map((exercise, index) => swapId === exercise.id
        ? <SwapExercise key={exercise.id} name={exercise.name} disabled={busy} onCancel={() => setSwapId(null)}
          onSave={(name) => {
            void perform(async () => {
              const next = updateDay(active, day.id, (item) => ({
                ...item, exercises: item.exercises.map((entry) => entry.id === exercise.id ? { ...entry, name } : entry),
              }));
              await save(saveProgram(value, next));
              setSwapId(null);
            });
          }} />
        : <Card key={exercise.id}>
          <View style={trainingStyles.line}>
            <View style={trainingStyles.grow}>
              <TrainingHeading>{index + 1}. {exercise.name}</TrainingHeading>
              <TrainingCopy>{exercise.sets} × {exercise.reps} reps · {exercise.restSeconds} s rest</TrainingCopy>
            </View>
            <TrainingLink title="Swap" hint={`Replace ${exercise.name} in this training day`}
              onPress={() => setSwapId(exercise.id)} disabled={busy} />
          </View>
        </Card>
      )}
      {!value.session && <Action title={busy ? 'Saving…' : 'Start workout'} tone="accent" disabled={busy} onPress={() => {
        void perform(async () => {
          await save(startWorkout(value, active.id, day.id, randomUUID(), Date.now()));
          router.push('/workout');
        });
      }} />}
    </>}
    {tab === 'active' && !active && <TrainingHero label="Training plan" title="Build your first program"
      detail="Choose a routine to edit or create your own schedule.">
      <Action title="Explore programs" tone="accent" onPress={() => setTab('programs')} />
    </TrainingHero>}
    {tab === 'programs' && <>
      {value.programs.length > 0 && <SectionTitle>Your programs</SectionTitle>}
      {value.programs.map((program) => {
        const isActive = program.id === value.activeProgramId;
        return <Card key={program.id} tone={isActive ? 'primary' : 'neutral'}>
          <TrainingHeading>{program.name}</TrainingHeading>
          <TrainingCopy>{program.days.length} {program.days.length === 1 ? 'day' : 'days'}{isActive ? ' · Active' : ''}</TrainingCopy>
          {!isActive && <Action title="Activate program" onPress={() => {
            void perform(async () => {
              await save({ ...value, activeProgramId: program.id });
              setSelectedDay(null);
              setTab('active');
            });
          }} disabled={busy} />}
          <View style={trainingStyles.wrap}>
            <TrainingLink title="Edit" hint={`Edit ${program.name}`} onPress={() => openDraft(program)} disabled={busy} />
            <TrainingLink title="Duplicate" hint={`Make a copy of ${program.name}`} disabled={busy || value.programs.length >= MAX_PROGRAMS}
              onPress={() => openDraft(duplicateProgram(program, randomUUID))} />
            {value.session?.programId !== program.id && confirmDelete !== program.id && <TrainingLink
              title="Delete" hint={`Delete ${program.name} from your programs`} onPress={() => setConfirmDelete(program.id)} disabled={busy} />}
          </View>
          {confirmDelete === program.id && <>
            <TrainingCopy>Delete this program? Your completed workouts will stay in history.</TrainingCopy>
            <Action title="Delete program" tone="accent" disabled={busy} onPress={() => {
              void perform(async () => {
                await save(deleteProgram(value, program.id));
                setConfirmDelete(null);
              });
            }} />
            <Action title="Keep program" subtle disabled={busy} onPress={() => setConfirmDelete(null)} />
          </>}
        </Card>;
      })}
      {value.programs.length < MAX_PROGRAMS && <>
        <SectionTitle>Starter routines</SectionTitle>
        {starterRoutines.map((template) => <Card key={template.name}>
          <TrainingHeading>{template.name}</TrainingHeading>
          <TrainingCopy>{template.days.length} days a week</TrainingCopy>
          <Action title="Customize routine" subtle disabled={busy} onPress={() => openDraft(makeProgram(randomUUID, template))} />
        </Card>)}
        <Action title="New program from scratch" tone="accent" onPress={() => openDraft(makeProgram(randomUUID))} disabled={busy} />
      </>}
    </>}
    <Action title="Workout history" subtle onPress={() => router.push({ pathname: '/workout', params: { view: 'history' } })} />
  </Screen>;
}

function ProgramEditor({ program, onChange, onSave, onCancel, disabled }: {
  program: Program; onChange: (program: Program) => void; onSave: () => void; onCancel: () => void; disabled: boolean;
}) {
  const [selectedDay, setSelectedDay] = useState(program.days[0]?.id);
  const day = program.days.find(({ id }) => id === selectedDay) ?? program.days[0];
  function editDay(transform: (day: TrainingDay) => TrainingDay) {
    if (day) onChange(updateDay(program, day.id, transform));
  }

  return <>
    <Field label="Program name" value={program.name} maxLength={MAX_NAME_LENGTH} editable={!disabled}
      onChangeText={(name) => onChange({ ...program, name })} />
    <SectionTitle>Training days</SectionTitle>
    <View style={trainingStyles.wrap}>
      {program.days.map((item) => <Pill key={item.id} label={item.name.trim() || 'Untitled day'} selected={item.id === day?.id}
        onPress={() => setSelectedDay(item.id)} disabled={disabled} />)}
      {program.days.length < MAX_DAYS && <Pill label="Add day" disabled={disabled} onPress={() => {
        const next = makeDay(randomUUID, program.days.length + 1);
        onChange({ ...program, days: [...program.days, next] });
        setSelectedDay(next.id);
      }} />}
    </View>
    {day && <>
      <Card tone="primary">
        <Field label="Day name" value={day.name} maxLength={MAX_NAME_LENGTH} editable={!disabled}
          onChangeText={(name) => editDay((item) => ({ ...item, name }))} />
        <TrainingHeading>Scheduled weekday</TrainingHeading>
        <View style={trainingStyles.dayPicker}>
          <Pill label="Any day" selected={day.weekday === undefined} disabled={disabled} onPress={() => {
            editDay((item) => {
              const { weekday: _weekday, ...unscheduled } = item;
              return unscheduled;
            });
          }} />
          {daysOfWeek.map((label, weekday) => <Pill key={weekday} label={label} selected={day.weekday === weekday}
            disabled={disabled} onPress={() => editDay((item) => ({ ...item, weekday }))} />)}
        </View>
        {program.days.length > 1 && <TrainingLink title="Remove day" disabled={disabled} onPress={() => {
          onChange({ ...program, days: program.days.filter(({ id }) => id !== day.id) });
        }} />}
      </Card>
      <SectionTitle>Exercises</SectionTitle>
      {day.exercises.map((exercise, index) => <Card key={exercise.id}>
        <ExerciseForm exercise={exercise} index={index} disabled={disabled} onChange={(patch) => {
          editDay((item) => ({
            ...item, exercises: item.exercises.map((plan) => plan.id === exercise.id ? { ...plan, ...patch } : plan),
          }));
        }} />
        <View style={trainingStyles.wrap}>
          {index > 0 && <TrainingLink title="Move earlier" hint={`Move exercise ${index + 1} up`} disabled={disabled} onPress={() => {
            editDay((item) => {
              const exercises = [...item.exercises];
              exercises.splice(index, 1);
              exercises.splice(index - 1, 0, exercise);
              return { ...item, exercises };
            });
          }} />}
          {day.exercises.length > 1 && <TrainingLink title="Remove exercise" hint={`Remove exercise ${index + 1}`}
            disabled={disabled} onPress={() => editDay((item) => ({
              ...item, exercises: item.exercises.filter(({ id }) => id !== exercise.id),
            }))} />}
        </View>
      </Card>)}
      {day.exercises.length < MAX_EXERCISES && <Action title="Add exercise" subtle disabled={disabled} onPress={() => {
        editDay((item) => ({ ...item, exercises: [...item.exercises, makeExercise(randomUUID)] }));
      }} />}
    </>}
    <Action title={disabled ? 'Saving…' : 'Save program'} tone="accent" disabled={disabled} onPress={onSave} />
    <Action title="Cancel editing" subtle disabled={disabled} onPress={onCancel} />
  </>;
}

function ExerciseForm({ exercise, index, onChange, disabled }: {
  exercise: PlanExercise; index: number; onChange: (patch: Partial<PlanExercise>) => void; disabled: boolean;
}) {
  return <>
    <Field label={`Exercise ${index + 1} name`} value={exercise.name} maxLength={MAX_NAME_LENGTH} editable={!disabled}
      onChangeText={(name) => onChange({ name })} />
    <View style={trainingStyles.wrap}>
      <View style={trainingStyles.numeric}>
        <Field label="Sets" accessibilityLabel={`Exercise ${index + 1} sets`} value={numberText(exercise.sets)} maxLength={3}
          onChangeText={(text) => onChange({ sets: readInteger(text) })} keyboardType="number-pad" editable={!disabled} />
      </View>
      <View style={trainingStyles.numeric}>
        <Field label="Reps" accessibilityLabel={`Exercise ${index + 1} reps`} value={numberText(exercise.reps)} maxLength={4}
          onChangeText={(text) => onChange({ reps: readInteger(text) })} keyboardType="number-pad" editable={!disabled} />
      </View>
      <View style={trainingStyles.numeric}>
        <Field label="Rest (s)" accessibilityLabel={`Exercise ${index + 1} rest in seconds`}
          value={numberText(exercise.restSeconds)} maxLength={4} onChangeText={(text) => onChange({ restSeconds: readInteger(text) })}
          keyboardType="number-pad" editable={!disabled} />
      </View>
    </View>
  </>;
}

function updateDay(program: Program, dayId: string, transform: (day: TrainingDay) => TrainingDay): Program {
  return { ...program, days: program.days.map((day) => day.id === dayId ? transform(day) : day) };
}

function readInteger(text: string): number {
  return /^\d+$/.test(text) ? Number(text) : NaN;
}

function numberText(value: number): string {
  return Number.isNaN(value) ? '' : String(value);
}
