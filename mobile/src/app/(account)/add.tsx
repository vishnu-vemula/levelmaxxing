import { useRouter } from '../../shared/navigation.tsx';
import { Action, Card, Mascot, Screen, SectionTitle } from '../../shared/ui.tsx';

export default function Add() {
  const router = useRouter();
  return <Screen title="Quick add" accessory={<Mascot tone="sun" />}>
    <Card tone="accent">
      <SectionTitle>Food</SectionTitle>
      <Action title="Log food" tone="accent" onPress={() => router.push('/food')} />
      <Action title="Open saved meals" subtle onPress={() => router.push('/recipes')} />
    </Card>
    <Card tone="primary">
      <SectionTitle>Training</SectionTitle>
      <Action title="Open training" onPress={() => router.push('/program')} />
    </Card>
    <Card tone="success">
      <SectionTitle>Progress</SectionTitle>
      <Action title="Log weight" onPress={() => router.push('/progress')} />
      <Action title="Check in or log activity" subtle onPress={() => router.push('/check-in')} />
    </Card>
    <Action title="More tools and settings" subtle onPress={() => router.push('/more')} />
  </Screen>;
}
