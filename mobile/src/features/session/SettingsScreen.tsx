import { nativeStorage } from '../../platform/native-storage.ts';
import { useRouter } from '../../shared/navigation.tsx';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Action, Card, Mascot, Notice, Pill, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';
import { formatWeight, useProgress } from '../progress/index.ts';
import { useWorkspace } from '../workspace/index.ts';
import { useAccount } from './SessionBoundary.tsx';

const workspaceMessages = {
  loading: 'Opening secure workspace',
  saved: 'Up to date',
  syncing: 'Syncing',
  offline: 'Offline',
  conflict: 'Review changes from another device',
  unavailable: 'Secure workspace unavailable',
};

const weightMessages = {
  idle: 'Ready',
  running: 'Syncing',
  current: 'Up to date',
  offline: 'Saved on this device',
  reconnect: 'Sign in to sync',
  review: 'Needs review',
};

export function SettingsScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { environment, session, signOut } = useAccount();
  const profile = useWorkspace('profile');
  const training = useWorkspace('training');
  const nutrition = useWorkspace('nutrition');
  const journal = useWorkspace('journal');
  const progress = useProgress();
  const [busy, setBusy] = useState<'units' | 'signout' | null>(null);
  const [error, setError] = useState<'units' | 'signout' | null>(null);
  const pending = useRef(false);
  const value = profile.value;
  const latest = progress.entries[0];
  const units = value?.units ?? 'kg';
  const version = nativeStorage().appVersion;
  const sections = [
    { label: 'Profile', status: profile.status },
    { label: 'Training', status: training.status },
    { label: 'Nutrition', status: nutrition.status },
    { label: 'Check-ins and activity', status: journal.status },
  ];
  const conflict = sections.some(section => section.status === 'conflict');

  async function updateUnits(next: typeof units) {
    if (!value || pending.current || value.units === next) return;
    pending.current = true;
    setBusy('units');
    setError(null);
    try {
      await profile.save({ ...value, units: next });
    } catch {
      setError('units');
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function submit() {
    if (pending.current) return;
    pending.current = true;
    setBusy('signout');
    setError(null);
    try {
      await signOut();
    } catch {
      setError('signout');
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return <Screen title="Account" detail="Settings" onBack={router.canGoBack() ? () => router.back() : undefined}>
    <Card tone="primary">
      <View style={styles.account}>
        <Mascot tone="sun" size={72} />
        <View style={styles.accountCopy}>
          <SectionTitle>{value?.name || 'Your account'}</SectionTitle>
          <Notice>{environment.mode === 'local' ? 'Development account' : session.accessToken ? 'Firebase account' : 'Firebase account · offline'}</Notice>
        </View>
      </View>
      {value?.goal && <Notice>{[value.goal, value.experience, latest && formatWeight(latest.grams, units)].filter(Boolean).join(' · ')}</Notice>}
      <Action title={value?.onboarded ? 'Edit goals and schedule' : 'Finish profile setup'} subtle
        disabled={busy !== null || profile.status === 'loading' || profile.status === 'unavailable'} onPress={() => router.push('/onboarding')} />
    </Card>

    <Card>
      <SectionTitle>Preferences</SectionTitle>
      <Text style={[styles.label, { color: colors.text }]}>Weight units</Text>
      <View style={styles.options}>
        <Pill label="Kilograms" selected={units === 'kg'} disabled={busy !== null || !value || profile.status === 'unavailable'}
          onPress={() => { void updateUnits('kg'); }} />
        <Pill label="Pounds" selected={units === 'lb'} disabled={busy !== null || !value || profile.status === 'unavailable'}
          onPress={() => { void updateUnits('lb'); }} />
      </View>
      {busy === 'units' && <Notice>Saving your preference…</Notice>}
      {error === 'units' && <Notice kind="error">Units could not be saved. Try again.</Notice>}
    </Card>

    <Card tone="success">
      <SectionTitle>Sync status</SectionTitle>
      {sections.map(section => <View key={section.label} style={styles.status}>
        <Text style={[styles.label, { color: colors.text }]}>{section.label}</Text>
        <Notice>{workspaceMessages[section.status]}</Notice>
      </View>)}
      <View style={styles.status}>
        <Text style={[styles.label, { color: colors.text }]}>Weight history</Text>
        <Notice>{progress.availability === 'failed' ? 'Storage unavailable'
          : progress.availability === 'opening' ? 'Opening secure storage' : weightMessages[progress.syncState]}</Notice>
      </View>
      {conflict && <Action title="Review sync conflicts" subtle onPress={() => router.push('/more')} />}
      <Action title="Sync now" subtle disabled={sections.every(section => section.status === 'loading' || section.status === 'syncing') && progress.syncState === 'running'}
        onPress={() => { profile.retry(); if (progress.availability === 'ready') progress.refresh(); }} />
    </Card>

    <Card tone="accent">
      <SectionTitle>On this device</SectionTitle>
      <Action title="Export active records and weight" subtle onPress={() => router.push('/export-data')} />
      <Action title="Export archived meals" subtle
        onPress={() => router.push({ pathname: '/export-data', params: { archive: 'meals' } })} />
      <Action title="Export archived workouts" subtle
        onPress={() => router.push({ pathname: '/export-data', params: { archive: 'workouts' } })} />
      <Notice>Sign out to lock your account records on this device. Sign in to the same account to continue syncing entries saved here.</Notice>
      {error === 'signout' && <Notice kind="error">Sign-out did not finish. Try again.</Notice>}
      <Action title={busy === 'signout' ? 'Signing out…' : 'Sign out'} disabled={busy !== null}
        onPress={() => { void submit(); }} subtle />
    </Card>
    <Card>
      <SectionTitle>About Levelmaxing</SectionTitle>
      {version && <Notice>Version {version}</Notice>}
      <Action title="Exercise and training guides" subtle onPress={() => router.push('/library')} />
    </Card>
  </Screen>;
}

const styles = StyleSheet.create({
  account: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  accountCopy: { flex: 1, gap: 4 },
  label: { fontSize: 16, fontWeight: '800' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  status: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
});
