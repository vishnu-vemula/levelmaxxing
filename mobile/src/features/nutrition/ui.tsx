import type { MacroAmount } from '@levelmaxing/contracts';
import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInputProps } from 'react-native';
import { Field, ProgressBar, useTheme } from '../../shared/ui.tsx';
import { displayAmount, macroKeys, macroLabels, type MacroForm } from './model.ts';

export function Body({ children }: PropsWithChildren) {
  const colors = useTheme();
  return <Text style={[styles.body, { color: colors.muted }]}>{children}</Text>;
}

export function FoodTitle({ children }: PropsWithChildren) {
  const colors = useTheme();
  return <Text style={[styles.itemTitle, { color: colors.text }]}>{children}</Text>;
}

export function FoodError({ children }: PropsWithChildren) {
  const colors = useTheme();
  return <Text accessibilityRole="alert" style={[styles.body, { color: colors.error }]}>{children}</Text>;
}

export function FoodAction({ title, onPress, disabled, selected, emphasis = false, compact, accessibilityLabel }: {
  title: string; onPress: () => void; disabled?: boolean; selected?: boolean;
  emphasis?: boolean; compact?: boolean; accessibilityLabel?: string;
}) {
  const colors = useTheme();
  const solid = emphasis || selected === true;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, compact && styles.compactAction, {
      backgroundColor: solid ? colors.accent : colors.surface,
      borderColor: solid ? colors.accent : colors.border, opacity: disabled ? 0.6 : pressed ? 0.8 : 1,
    }]}>
    <Text style={[styles.actionLabel, compact && styles.compactLabel, { color: solid ? colors.onAccent : colors.text }]}>{title}</Text>
  </Pressable>;
}

export function FoodField({ label, number, ...props }: Pick<TextInputProps,
  'value' | 'onChangeText' | 'autoCapitalize' | 'multiline' | 'maxLength' | 'placeholder' | 'editable'> & {
  label: string; number?: boolean;
}) {
  return <Field {...props} label={label} keyboardType={number ? 'decimal-pad' : 'default'}
    style={props.multiline ? styles.multiline : undefined} />;
}

export function MacroFields({ value, onChange, energy = 'Calories (kcal)' }: {
  value: MacroForm; onChange(value: MacroForm): void; energy?: string;
}) {
  return <View style={styles.wrap}>
    {macroKeys.map((key) => (
      <View key={key} style={styles.column}>
        <FoodField label={key === 'calories' ? energy : `${macroLabels[key]} (g)`}
          value={value[key]} onChangeText={(text) => onChange({ ...value, [key]: text })} number maxLength={12} />
      </View>
    ))}
  </View>;
}

export function MacroBoard({ title, value, target }: { title: string; value: MacroAmount; target?: number }) {
  const colors = useTheme();
  const remaining = target && target - value.calories;
  return <View style={[styles.board, { backgroundColor: colors.accentSoft }]}>
    <Text style={[styles.boardTitle, { color: colors.text }]} accessibilityRole="header">{title}</Text>
    <View style={styles.energy}>
      <Text style={[styles.boardValue, { color: colors.text }]}>{displayAmount(value.calories)}</Text>
      <Text style={[styles.boardLabel, { color: colors.text }]}>
        {target ? `/ ${displayAmount(target)} kcal` : 'kcal'}
      </Text>
    </View>
    {target !== undefined && remaining !== undefined && <>
      <ProgressBar value={value.calories * 100 / target} label="Energy goal progress" />
      <Text style={[styles.boardLabel, { color: colors.text }]}>
        {Math.abs(remaining) < 0.005 ? 'Energy goal reached' :
          `${displayAmount(Math.abs(remaining))} kcal ${remaining >= 0 ? 'remaining' : 'over your target'}`}
      </Text>
    </>}
    <View style={styles.wrap}>
      {(['protein', 'carbs', 'fat'] as const).map((key) =>
        <View key={key} style={[styles.stat, { backgroundColor: colors.canvas }]}>
          <Text style={[styles.boardLabel, { color: colors.muted }]}>{macroLabels[key]}</Text>
          <Text style={[styles.boardStat, { color: colors.text }]}>{displayAmount(value[key])} g</Text>
        </View>)}
    </View>
  </View>;
}

export function DraftNotice({ message, onReload }: { message: string; onReload?: () => void }) {
  return <View style={foodLayout.group}>
    <FoodError>{message}</FoodError>
    {onReload && <FoodAction title="Discard draft and reload latest" onPress={onReload} />}
  </View>;
}

export const foodLayout = StyleSheet.create({
  group: { gap: 8 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
});

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
  itemTitle: { fontSize: 17, fontWeight: '800' },
  action: { minHeight: 44, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center', maxWidth: '100%' },
  actionLabel: { fontSize: 14, fontWeight: '800', textAlign: 'center' },
  compactAction: { minHeight: 52, paddingHorizontal: 1 },
  compactLabel: { fontSize: 12 },
  multiline: { minHeight: 78, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  column: { flexGrow: 1, flexBasis: '43%', maxWidth: '100%' },
  board: { borderRadius: 28, padding: 18, gap: 10 },
  boardTitle: { fontSize: 16, fontWeight: '800' },
  boardValue: { fontSize: 42, lineHeight: 50, letterSpacing: -1.6, fontWeight: '900' },
  energy: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 },
  boardLabel: { fontSize: 13, fontWeight: '600' },
  stat: { borderRadius: 16, paddingHorizontal: 11, paddingVertical: 8,
    minWidth: 70, flexGrow: 1, gap: 2 },
  boardStat: { fontWeight: '900', fontSize: 17 },
});
