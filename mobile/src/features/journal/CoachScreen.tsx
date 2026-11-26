import { useRouter } from '../../shared/navigation.tsx';
import { Text } from 'react-native';
import { Action, Card, Mascot, Notice, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';
import { useWorkspace } from '../workspace/index.ts';
import { coachSummary, emptyJournal, localDay } from './model.ts';

export function CoachScreen() {
  const router = useRouter();
  const colors = useTheme();
  const nutrition = useWorkspace('nutrition');
  const training = useWorkspace('training');
  const journal = useWorkspace('journal');
  const sections = [nutrition, training, journal];
  const loading = sections.some(({ status, value }) => !value && (status === 'loading' || status === 'syncing'));
  const unavailable = sections.some(({ status }) => status === 'unavailable');
  const summary = coachSummary({
    date: localDay(), meals: nutrition.value?.meals ?? [], training: training.value, journal: journal.value ?? emptyJournal,
  });

  return <Screen title="Coach" detail="A daily review based on what you log." onBack={router.canGoBack() ? () => router.back() : undefined} accessory={<Mascot />}>
    {loading && <Notice>Opening your logs…</Notice>}
    {unavailable && <Notice kind="error">Some logs are currently unavailable.</Notice>}
    {!loading && <>
      {training.status !== 'unavailable' && <Card tone="primary">
        <SectionTitle>Training</SectionTitle>
        <Text style={{ color: colors.text }}>{summary.training}</Text>
        <Action title={training.value?.session ? 'Resume workout' : 'Open training'} onPress={() => router.push(training.value?.session ? '/workout' : '/program')} />
      </Card>}
      {nutrition.status !== 'unavailable' && <Card tone="accent">
        <SectionTitle>Food</SectionTitle>
        <Text style={{ color: colors.text }}>{summary.food}</Text>
        <Action title="Open food diary" onPress={() => router.push('/nutrition')} />
      </Card>}
      {journal.status !== 'unavailable' && <Card tone="success">
        <SectionTitle>Recovery</SectionTitle>
        <Text style={{ color: colors.text }}>{summary.recovery}</Text>
        <Action title="Open check-ins" onPress={() => router.push('/check-in')} />
      </Card>}
    </>}
  </Screen>;
}
