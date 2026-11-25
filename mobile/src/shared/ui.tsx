import { levelmaxingBrand as brand, mobilePalette } from '@levelmaxing/design-tokens';
import { useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme, type TextInputProps, type ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function useTheme() {
  return mobilePalette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

type Tone = 'neutral' | 'primary' | 'accent' | 'success';

export function Screen({ title, detail, children, accessory, hideHeader, onBack }: PropsWithChildren<{
  title: string; detail?: string; accessory?: ReactNode; hideHeader?: boolean; onBack?: () => void;
}>) {
  const colors = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        {onBack && <View style={styles.back}><Pill label="Back" onPress={onBack} /></View>}
        {!hideHeader && (
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              {detail && <Text style={[styles.detail, { color: colors.muted }]}>{detail}</Text>}
              <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">{title}</Text>
            </View>
            {accessory}
          </View>
        )}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, tone = 'neutral', style, ...props }: PropsWithChildren<ViewProps & { tone?: Tone }>) {
  const colors = useTheme();
  const backgroundColor = {
    neutral: colors.surface, primary: colors.primarySoft, accent: colors.accentSoft, success: colors.successSoft,
  }[tone];
  return <View {...props} style={[styles.card, { backgroundColor }, style]}>{children}</View>;
}

export function Action({ title, onPress, disabled, subtle, tone = 'primary' }: {
  title: string; onPress: () => void; disabled?: boolean; subtle?: boolean; tone?: 'primary' | 'accent';
}) {
  const colors = useTheme();
  const backgroundColor = subtle ? colors.canvas : tone === 'accent' ? colors.accent : colors.primary;
  const foreground = subtle ? colors.text : tone === 'accent' ? colors.onAccent : colors.onPrimary;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.action, {
        backgroundColor,
        borderColor: subtle ? colors.border : backgroundColor,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      }]}>
      <Text style={[styles.actionLabel, { color: foreground }]}>{title}</Text>
    </Pressable>
  );
}

export function SectionTitle({ children }: PropsWithChildren) {
  const colors = useTheme();
  return <Text style={[styles.section, { color: colors.text }]} accessibilityRole="header">{children}</Text>;
}

export function Field({ label, style, onFocus, onBlur, ...props }: TextInputProps & { label: string }) {
  const colors = useTheme();
  const [focused, setFocused] = useState(false);
  return <View style={[styles.field, {
    backgroundColor: colors.canvas,
    borderColor: focused ? colors.focus : colors.inputBorder,
  }]}>
    <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no" style={[styles.fieldLabel, { color: colors.muted }]}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={colors.muted}
      {...props}
      onFocus={event => { setFocused(true); onFocus?.(event); }}
      onBlur={event => { setFocused(false); onBlur?.(event); }}
      style={[styles.input, { color: colors.text }, style]}
    />
  </View>;
}

export function Pill({ label, selected = false, onPress, disabled, role = 'button', accessibilityLabel }: {
  label: string; selected?: boolean; onPress: () => void; disabled?: boolean; role?: 'button' | 'tab'; accessibilityLabel?: string;
}) {
  const colors = useTheme();
  return <Pressable accessibilityRole={role} accessibilityLabel={accessibilityLabel} accessibilityState={{ selected, disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.pill, {
      backgroundColor: selected ? colors.primary : colors.surface,
      opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
    }]}>
    <Text style={[styles.pillLabel, { color: selected ? colors.onPrimary : colors.text }]}>{label}</Text>
  </Pressable>;
}

export function Notice({ children, kind = 'info' }: PropsWithChildren<{ kind?: 'info' | 'success' | 'error' }>) {
  const colors = useTheme();
  return <Text accessibilityRole={kind === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite"
    style={[styles.notice, { color: kind === 'error' ? colors.error : kind === 'success' ? colors.success : colors.muted }]}>
    {children}
  </Text>;
}

export function Mascot({ size = 56, tone = 'blue' }: { size?: number; tone?: 'blue' | 'sun' }) {
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.mascot, { width: size, height: size * 0.94, gap: size * 0.08, borderRadius: size * 0.44,
      backgroundColor: tone === 'sun' ? brand.sun : brand.blue }]}>
    <View style={[styles.band, { height: size * 0.12, top: size * 0.15, transform: [{ rotate: '-7deg' }] }]} />
    {[0, 1].map(eye => <View key={eye} style={[styles.eye, { width: size * 0.25, height: size * 0.25,
      borderRadius: size * 0.125, padding: size * 0.03 }]}>
      <View style={{ width: size * 0.12, height: size * 0.12, borderRadius: size * 0.06, backgroundColor: brand.ink }} />
    </View>)}
    <View style={[styles.smile, { width: size * 0.2, height: size * 0.095, bottom: size * 0.16, borderRadius: size * 0.08 }]} />
  </View>;
}

export function BrandLockup() {
  const colors = useTheme();
  return <View style={styles.lockup}>
    <Mascot size={34} />
    <Text style={[styles.lockupText, { color: colors.text }]}>Levelmaxing</Text>
  </View>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const colors = useTheme();
  const progress = Math.min(100, Math.max(0, value));
  return <View accessibilityRole="progressbar" accessibilityLabel={label}
    accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }}
    style={[styles.track, { backgroundColor: colors.border }]}>
    <View style={[styles.bar, { width: `${progress}%`, backgroundColor: colors.primary }]} />
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { alignSelf: 'center', width: '100%', maxWidth: 680, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 16 },
  back: { alignSelf: 'flex-start' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  headerCopy: { flex: 1, gap: 5 },
  title: { fontSize: 39, fontWeight: '900', letterSpacing: -1.6 },
  detail: { fontSize: 15, fontWeight: '600' },
  card: { borderRadius: 26, padding: 17, gap: 12 },
  action: { minHeight: 52, borderWidth: 1, borderRadius: 28, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 11 },
  actionLabel: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  section: { fontSize: 22, fontWeight: '900', letterSpacing: -0.45 },
  field: { minHeight: 60, borderWidth: 1.5, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 7, justifyContent: 'center' },
  fieldLabel: { fontSize: 13, fontWeight: '700' },
  input: { minHeight: 44, fontSize: 17, fontWeight: '600', padding: 0 },
  pill: { minWidth: 44, minHeight: 44, borderRadius: 22, paddingHorizontal: 15, paddingVertical: 8, justifyContent: 'center', alignItems: 'center' },
  pillLabel: { fontWeight: '800', fontSize: 14, textAlign: 'center' },
  notice: { fontSize: 15, lineHeight: 21 },
  lockup: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  lockupText: { fontSize: 19, fontWeight: '900', letterSpacing: -0.6, flexShrink: 1 },
  mascot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  band: { left: -3, right: -3, position: 'absolute', backgroundColor: brand.white },
  eye: { backgroundColor: brand.white, alignItems: 'flex-end' },
  smile: { position: 'absolute', backgroundColor: brand.ink },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
});
