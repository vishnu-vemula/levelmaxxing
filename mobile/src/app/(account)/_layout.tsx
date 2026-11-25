import { Link, Redirect, Slot, usePathname } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createMobileServices } from '../../composition.ts';
import { ProgressBoundary } from '../../features/progress/index.ts';
import { SessionBoundary, useAccount } from '../../features/session/index.ts';
import { WorkspaceBoundary, useWorkspace } from '../../features/workspace/index.ts';
import { Card, Mascot, Notice, Screen, useTheme } from '../../shared/ui.tsx';

const destinations = [
  { path: '/', label: 'Today', glyph: '⌂' },
  { path: '/program', label: 'Train', glyph: '↗' },
  { path: '/add', label: 'Add', glyph: '+' },
  { path: '/nutrition', label: 'Food', glyph: '◉' },
  { path: '/progress', label: 'Progress', glyph: '▥' },
] as const;

export default function RootLayout() {
  const services = useMemo(createMobileServices, []);
  return <SessionBoundary configuration={services.account}><AccountFrame services={services} /></SessionBoundary>;
}

function AccountFrame({ services }: { services: ReturnType<typeof createMobileServices> }) {
  const { environment, session } = useAccount();
  const { accessToken, accountId } = session;
  const scope = `${environment.mode}|${environment.api}|${accountId}`;
  const progress = useMemo(
    () => accessToken ? services.connectProgress(environment, accessToken) : null,
    [accessToken, environment, services],
  );
  const workspace = useMemo(
    () => accessToken ? services.connectWorkspace(environment, accessToken) : null,
    [accessToken, environment, services],
  );
  return <ProgressBoundary scope={scope} transport={progress} openStore={services.openProgressStore} createId={services.createMeasurementId}>
    <WorkspaceBoundary scope={scope} transport={workspace} openStore={services.openWorkspaceStore} createId={services.createMeasurementId}>
      <Frame />
    </WorkspaceBoundary>
  </ProgressBoundary>;
}

function Frame() {
  const route = usePathname();
  const colors = useTheme();
  const profile = useWorkspace('profile');
  const training = useWorkspace('training');
  const nutrition = useWorkspace('nutrition');
  const journal = useWorkspace('journal');
  const conflicts = [profile, training, nutrition, journal].some((section) => section.status === 'conflict');
  const onboarded = profile.value?.onboarded === true;
  const opensBeforeProfile = ['/onboarding', '/settings', '/more', '/export-data'].includes(route);
  const opening = !profile.value && (profile.status === 'loading' || profile.status === 'syncing') && !opensBeforeProfile;
  const needsOnboarding = !opening && !onboarded && profile.status !== 'unavailable' && !opensBeforeProfile;
  const showNavigation = !opening && !needsOnboarding && route !== '/onboarding';
  const selectedPath = route === '/workout' ? '/program'
    : ['/food', '/recipes', '/groceries'].includes(route) ? '/nutrition'
    : route === '/check-in' ? '/progress' : route;
  return <View style={[styles.frame, { backgroundColor: colors.canvas }]}>
    <View style={opening || needsOnboarding ? styles.hidden : styles.frame}><Slot /></View>
    {opening && <Screen title="Levelmaxing" detail="Opening your workspace">
      <Card tone="primary"><Mascot size={80} /></Card>
    </Screen>}
    {needsOnboarding && <Redirect href="/onboarding" />}
    {showNavigation && <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.navigation}>
      {conflicts && route !== '/more' && <Link href="/more" style={[styles.conflict, { color: colors.primary }]}>Review a sync conflict</Link>}
      {profile.status === 'unavailable' && route === '/' && <Notice kind="error">Local workspace storage could not be opened. Your progress records use separate storage.</Notice>}
      <View style={styles.links} accessibilityRole="tablist">
        {destinations.map(({ path, label, glyph }) => {
          const selected = selectedPath === path;
          const add = path === '/add';
          return <Link href={path} asChild key={path} replace>
            <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }}
              style={({ pressed }) => [styles.link, add && styles.add, {
                backgroundColor: add ? colors.accent : selected ? '#34363E' : '#101114',
                opacity: pressed ? 0.8 : 1,
              }]}>
              <Text allowFontScaling={false} style={[styles.glyph, { color: add ? colors.onAccent : '#FFFFFF' }]}>{glyph}</Text>
              {!add && <Text style={[styles.label, { color: selected ? '#FFFFFF' : '#E1E4EC' }]}>{label}</Text>}
            </Pressable>
          </Link>;
        })}
      </View>
    </SafeAreaView>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  hidden: { display: 'none' },
  navigation: { paddingHorizontal: 12, paddingTop: 3 },
  links: {
    flexDirection: 'row', width: '100%', alignSelf: 'center', maxWidth: 640,
    padding: 6, borderRadius: 28, backgroundColor: '#101114', alignItems: 'stretch',
  },
  link: { flex: 1, minHeight: 48, borderRadius: 22, justifyContent: 'center', alignItems: 'center', paddingVertical: 3 },
  add: { flexGrow: 0, flexBasis: 48, marginHorizontal: 3 },
  glyph: { fontSize: 22, fontWeight: '700', lineHeight: 24, textAlign: 'center' },
  label: { fontSize: 10, fontWeight: '700', textAlign: 'center' },
  conflict: { alignSelf: 'center', minHeight: 44, textAlignVertical: 'center', paddingTop: 10, fontWeight: '700' },
});
