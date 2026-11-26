import { useRouter } from '../../shared/navigation.tsx';
import { type PropsWithChildren, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Action, Card, Field, Notice, Pill, SectionTitle, useTheme } from '../../shared/ui.tsx';
import { useWorkspace } from '../workspace/index.ts';
import { alternativesFor, MAX_NAME_LENGTH } from './model.ts';

export function TrainingCopy({ children }: PropsWithChildren) {
  const colors = useTheme();
  return <Text style={[styles.copy, { color: colors.muted }]}>{children}</Text>;
}

export function TrainingHeading({ children }: PropsWithChildren) {
  const colors = useTheme();
  return <Text style={[styles.heading, { color: colors.text }]}>{children}</Text>;
}

export function TrainingHero({ label, title, detail, children }: PropsWithChildren<{
  label: string; title: string; detail: string;
}>) {
  const colors = useTheme();
  return <Card style={{ backgroundColor: colors.primary }}>
    <Text style={[styles.heroLabel, { color: colors.onPrimary }]}>{label}</Text>
    <Text style={[styles.heroTitle, { color: colors.onPrimary }]} accessibilityRole="header">{title}</Text>
    <Text style={[styles.copy, { color: colors.onPrimary }]}>{detail}</Text>
    {children}
  </Card>;
}

export function TrainingLink({ title, onPress, disabled, hint }: {
  title: string; onPress: () => void; disabled?: boolean; hint?: string;
}) {
  const colors = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} accessibilityHint={hint} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.link, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
    <Text style={[styles.linkText, { color: colors.primary }]}>{title}</Text>
  </Pressable>;
}

export function SwapExercise({ name, onSave, onCancel, disabled }: {
  name: string; onSave: (name: string) => void; onCancel: () => void; disabled?: boolean;
}) {
  const [replacement, setReplacement] = useState('');
  const choices = alternativesFor(name);
  return <Card tone="primary">
    <SectionTitle>Swap {name}</SectionTitle>
    {choices.length > 0 && <View style={trainingStyles.wrap}>
      {choices.map((option) => <Pill key={option} label={option} selected={option === replacement}
        onPress={() => setReplacement(option)} disabled={disabled} />)}
    </View>}
    <Field label="Replacement exercise" value={replacement} onChangeText={setReplacement}
      maxLength={MAX_NAME_LENGTH} editable={!disabled} autoCapitalize="sentences" />
    <Action title="Use replacement" onPress={() => onSave(replacement.trim())}
      disabled={disabled || !replacement.trim()} />
    <Action title="Keep current exercise" onPress={onCancel} subtle disabled={disabled} />
  </Card>;
}

export function SaveError({ message }: { message: string }) {
  return <Notice kind="error">{message}</Notice>;
}

export function TrainingSyncStatus() {
  const { status } = useWorkspace('training');
  const router = useRouter();
  if (status === 'loading') return <Notice>Opening training data…</Notice>;
  if (status === 'unavailable') return <SaveError message="Training storage is unavailable. Reopen the app to try again." />;
  if (status === 'syncing') return <Notice>Syncing training…</Notice>;
  if (status === 'offline') return <Notice>Training is available on this device.</Notice>;
  if (status === 'conflict') return <Card tone="accent">
    <SectionTitle>Training changed on another device</SectionTitle>
    <Action title="Review sync conflict" onPress={() => router.push('/more')} />
  </Card>;
  return null;
}

export const trainingStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  stacked: { gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  numeric: { flex: 1, minWidth: '29%' },
  dayPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});

const styles = StyleSheet.create({
  copy: { fontSize: 15, lineHeight: 21, flexShrink: 1 },
  heading: { fontSize: 18, fontWeight: '800', flexShrink: 1 },
  heroLabel: { fontSize: 14, fontWeight: '700' },
  heroTitle: { fontSize: 31, fontWeight: '900', lineHeight: 35, letterSpacing: -1, flexShrink: 1 },
  link: { minHeight: 44, paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
});
