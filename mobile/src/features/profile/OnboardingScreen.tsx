import type { ProfileData } from '@levelmaxing/contracts';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Action, Card, Field, Mascot, Notice, Pill, ProgressBar, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';
import { useWorkspace } from '../workspace/index.ts';

const titles = ['What are you working toward?', 'What can you train with?', 'Which muscles matter most?', 'Set a starting target'];
const goals = [
  { title: 'Build muscle', detail: 'Focus on gaining size and strength.', tone: 'primary' },
  { title: 'Lose fat', detail: 'Track food and training as you work toward a leaner physique.', tone: 'accent' },
  { title: 'Recomposition', detail: 'Focus on strength while monitoring changes in body weight.', tone: 'success' },
  { title: 'Get stronger', detail: 'Make progress on the lifts you care about.', tone: 'neutral' },
] as const;
const equipment = ['Bodyweight', 'Dumbbells', 'Barbell', 'Bench', 'Cable machine', 'Machines', 'Resistance bands', 'Pull-up bar'];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const muscleGroups = ['Chest', 'Back', 'Shoulders', 'Arms', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'];
const emptyProfile: ProfileData = {
  name: '', goal: '', experience: '', equipment: [], weekdays: [], minutes: 0,
  muscles: [], calories: null, units: 'kg', onboarded: false,
};

function toggle(values: string[], next: string): string[] {
  return values.includes(next) ? values.filter(value => value !== next) : [...values, next];
}

function profileFields(profile: ProfileData): string {
  const { name, goal, experience, equipment, weekdays, minutes, muscles, calories, onboarded } = profile;
  return JSON.stringify([name, goal, experience, equipment, weekdays, minutes, muscles, calories, onboarded]);
}

export function OnboardingScreen() {
  const profile = useWorkspace('profile');
  const router = useRouter();
  const colors = useTheme();
  if (profile.status === 'loading' || (!profile.value && profile.status === 'syncing')) return <Screen title="Preparing your profile">
    <ActivityIndicator color={colors.primary} accessibilityLabel="Preparing your profile" />
  </Screen>;
  if (profile.status === 'unavailable') return <Screen title="Profile unavailable">
    <Notice kind="error">Secure profile storage could not be opened. Reopen Levelmaxing to try again.</Notice>
    <Action title="Account settings" subtle onPress={() => router.replace('/settings')} />
  </Screen>;
  return <ProfileQuestions original={profile.value ?? emptyProfile} save={profile.save} />;
}

function ProfileQuestions({ original, save }: { original: ProfileData; save: (profile: ProfileData) => Promise<void> }) {
  const colors = useTheme();
  const router = useRouter();
  const [profile, setProfile] = useState(original);
  const [baseline, setBaseline] = useState(() => profileFields(original));
  const [calories, setCalories] = useState(original.calories?.toString() ?? '');
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const outdated = baseline !== profileFields(original);

  function patch(update: Partial<ProfileData>) {
    setProfile(current => ({ ...current, ...update }));
    setError('');
  }

  function back() {
    if (step > 0) {
      setStep(current => current - 1);
      setError('');
    } else if (original.onboarded) {
      if (router.canGoBack()) router.back();
      else router.replace('/settings');
    }
  }

  function reload() {
    setProfile(original);
    setBaseline(profileFields(original));
    setCalories(original.calories?.toString() ?? '');
    setStep(0);
    setError('');
  }

  async function next() {
    if (pending.current || outdated) return;
    if (step === 0 && (!profile.name.trim() || !profile.goal || !profile.experience)) {
      setError('Enter a name and choose a goal and experience level.');
      return;
    }
    if (step === 1 && (!profile.equipment.length || !profile.weekdays.length || !profile.minutes)) {
      setError('Choose equipment, at least one training day, and a session length.');
      return;
    }
    setError('');
    if (step < titles.length - 1) {
      setStep(current => current + 1);
      return;
    }
    const target = calories.trim();
    if (target && (!/^\d{1,5}$/.test(target) || Number(target) < 1 || Number(target) > 20_000)) {
      setError('Enter a daily calorie target between 1 and 20,000, or leave it blank.');
      return;
    }
    pending.current = true;
    setSaving(true);
    try {
      await save({
        ...profile, units: original.units, name: profile.name.trim(), calories: target ? Number(target) : null, onboarded: true,
      });
      router.replace('/');
    } catch {
      setError('Your profile could not be saved. Your choices are still here. Try again.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <Screen title={titles[step]!} detail={`Step ${step + 1} of ${titles.length}`} accessory={<Mascot tone="sun" size={58} />}>
    <ProgressBar value={(step + 1) / titles.length * 100} label="Profile setup" />
    {outdated && <Card tone="accent">
      <Notice kind="error">Your saved profile changed while this form was open. Reload it to continue editing.</Notice>
      <Action title="Reload saved profile" onPress={reload} subtle disabled={saving} />
    </Card>}
    {step === 0 && <>
      <Field label="First name" value={profile.name} onChangeText={name => patch({ name })} maxLength={120}
        autoComplete="given-name" autoCapitalize="words" />
      <View accessibilityRole="radiogroup" style={styles.choices}>
        {goals.map(goal => {
          const selected = profile.goal === goal.title;
          return <Pressable key={goal.title} accessibilityRole="radio" accessibilityState={{ checked: selected }}
            onPress={() => patch({ goal: goal.title })} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
            <Card tone={goal.tone} style={[styles.goal, { borderColor: selected ? colors.primary : 'transparent' }]}>
              <View style={styles.goalCopy}>
                <Text style={[styles.goalTitle, { color: colors.text }]}>{goal.title}</Text>
                <Text style={{ color: colors.muted }}>{goal.detail}</Text>
              </View>
              <Text accessible={false} style={[styles.selection, { color: colors.primary }]}>{selected ? '●' : '○'}</Text>
            </Card>
          </Pressable>;
        })}
      </View>
      <SectionTitle>Training experience</SectionTitle>
      <View style={styles.pills}>
        {['Beginner', 'Intermediate', 'Advanced'].map(experience => (
          <Pill key={experience} label={experience} selected={profile.experience === experience} onPress={() => patch({ experience })} />
        ))}
      </View>
    </>}
    {step === 1 && <>
      <SectionTitle>Available equipment</SectionTitle>
      <View style={styles.pills}>
        {equipment.map(item => <Pill key={item} label={item} selected={profile.equipment.includes(item)}
          onPress={() => patch({ equipment: toggle(profile.equipment, item) })} />)}
      </View>
      <SectionTitle>Training days</SectionTitle>
      <View style={styles.pills}>
        {weekdays.map(day => <Pill key={day} label={day} selected={profile.weekdays.includes(day)}
          onPress={() => patch({ weekdays: toggle(profile.weekdays, day) })} />)}
      </View>
      <SectionTitle>Session length</SectionTitle>
      <View style={styles.pills}>
        {[30, 45, 60, 75, 90].map(minutes => <Pill key={minutes} label={`${minutes} min`} selected={profile.minutes === minutes}
          onPress={() => patch({ minutes })} />)}
      </View>
    </>}
    {step === 2 && <>
      <Card tone="primary"><Notice>Choose up to three muscle groups to prioritize. You can also skip this step.</Notice></Card>
      <View style={styles.pills}>
        {muscleGroups.map(muscle => <Pill key={muscle} label={muscle} selected={profile.muscles.includes(muscle)}
          disabled={profile.muscles.length >= 3 && !profile.muscles.includes(muscle)}
          onPress={() => patch({ muscles: toggle(profile.muscles, muscle) })} />)}
      </View>
    </>}
    {step === 3 && <>
      <Card tone="accent">
        <SectionTitle>Daily calories</SectionTitle>
        <Notice>You can log meals with or without a daily calorie target. You can change it later in Settings.</Notice>
        <Field label="Daily calorie target (optional)" value={calories} keyboardType="number-pad" maxLength={5}
          editable={!saving} onChangeText={value => { setCalories(value); setError(''); }} />
      </Card>
      <Card>
        <SectionTitle>Your training setup</SectionTitle>
        <Notice>{[profile.goal, profile.experience, `${profile.minutes} min per session`].filter(Boolean).join(' · ')}</Notice>
        <Notice>{weekdays.filter(day => profile.weekdays.includes(day)).join(', ')}</Notice>
      </Card>
    </>}
    {error && <Notice kind="error">{error}</Notice>}
    <Action title={saving ? 'Saving profile…' : step === titles.length - 1 ? 'Save profile' : 'Continue'}
      disabled={saving || outdated} onPress={() => { void next(); }} />
    {(step > 0 || original.onboarded) && <Action title={step > 0 ? 'Back' : 'Cancel'} subtle disabled={saving} onPress={back} />}
  </Screen>;
}

const styles = StyleSheet.create({
  choices: { gap: 10 },
  goal: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, paddingVertical: 12 },
  goalCopy: { gap: 4, flex: 1 },
  goalTitle: { fontSize: 18, fontWeight: '900' },
  selection: { fontSize: 23 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
