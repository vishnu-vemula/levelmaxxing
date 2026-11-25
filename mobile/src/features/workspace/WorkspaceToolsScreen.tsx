import type { WorkspaceSection } from '@levelmaxing/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Action, Card, Notice, Screen, SectionTitle } from '../../shared/ui.tsx';
import type { ResolutionChoice } from './model.ts';
import { useWorkspace } from './WorkspaceBoundary.tsx';

const sections = [
  { key: 'profile', name: 'Profile' }, { key: 'training', name: 'Training' },
  { key: 'nutrition', name: 'Food' }, { key: 'journal', name: 'Journal' },
] as const;

export function WorkspaceToolsScreen() {
  const router = useRouter();
  return <Screen title="More" onBack={router.canGoBack() ? () => router.back() : undefined}>
    <Card>
      <SectionTitle>Tools and account</SectionTitle>
      <Action title="Check-ins and activity" subtle onPress={() => router.push('/check-in')} />
      <Action title="Coach" subtle onPress={() => router.push('/coach')} />
      <Action title="Learning library" subtle onPress={() => router.push('/library')} />
      <Action title="Recipes and saved meals" subtle onPress={() => router.push('/recipes')} />
      <Action title="Groceries" subtle onPress={() => router.push('/groceries')} />
      <Action title="Settings" subtle onPress={() => router.push('/settings')} />
    </Card>
    {sections.map(({ key, name }) => <SyncSection key={key} section={key} title={name} />)}
  </Screen>;
}

function SyncSection({ section, title }: { section: WorkspaceSection; title: string }) {
  const { status, canCombine: isCombinable, resolve, retry } = useWorkspace(section);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose(choice: ResolutionChoice) {
    setError('');
    setBusy(true);
    try {
      await resolve(choice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected version could not be saved to this device. Try again.');
    } finally {
      setBusy(false);
    }
  }
  function confirm(choice: 'local' | 'remote') {
    const local = choice === 'local';
    Alert.alert(
      local ? 'Keep this device’s version?' : 'Use the synced version?',
      local ? 'The next sync will replace the server’s version of this section.' : 'This replaces the changes currently saved on this device in this section.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: local ? 'Keep this device’s version' : 'Use synced version', onPress: () => { void choose(choice); } },
      ],
    );
  }

  const canCombine = isCombinable();
  if (status !== 'offline' && status !== 'conflict' && status !== 'unavailable') return null;
  return <Card>
    <SectionTitle>{title} sync</SectionTitle>
    {status === 'conflict' ? <>
      <Notice kind="error">{canCombine ? 'You can combine these versions and keep both sets of changes.' :
        'This device and the server have different versions of this section. Choose the version you want to keep.'}</Notice>
      {canCombine && <Action title="Combine independent edits" disabled={busy} onPress={() => { void choose('combine'); }} />}
      <Action title="Keep this device’s version" onPress={() => confirm('local')} disabled={busy} />
      <Action title="Use synced version" subtle onPress={() => confirm('remote')} disabled={busy} />
      {error !== '' && <Notice kind="error">{error}</Notice>}
    </> : status === 'offline' ? <>
      <Notice>The server could not be reached. Saved changes stay on this device and will retry when the app is active.</Notice>
      <Action title="Retry sync" onPress={retry} />
    </> : <Notice kind="error">This section could not open local storage. Reopen the app to retry.</Notice>}
  </Card>;
}
