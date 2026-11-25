import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { dateKey, fromDateKey } from '../../shared/local-date.ts';
import { Action, Card, Notice, Pill, SectionTitle } from '../../shared/ui.tsx';
import { calendarDates, calendarLogDays, moveCalendar, type CalendarPeriod } from './calendar.ts';

const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' });
const fullLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function TodayCalendar({ training, nutrition, journal, weights, loading, incomplete, onDiary }: Parameters<typeof calendarLogDays>[0] & {
  loading: boolean; incomplete: boolean; onDiary: (date: string) => void;
}) {
  const [period, setPeriod] = useState<CalendarPeriod | null>(null);
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const today = dateKey();
  const active = chosenDate ?? today;
  const logs = useMemo(() => period ? calendarLogDays({ training, nutrition, journal, weights }) : null,
    [training, nutrition, journal, weights, period]);
  const activeLog = logs?.get(active);

  return <Card>
    <Action title={period ? 'Close calendar' : 'Open calendar'} subtle onPress={() => {
      setPeriod(period ? null : 'week');
      setChosenDate(null);
    }} />
    {period && <>
      <View style={styles.row} accessibilityRole="tablist">
        <Pill label="Week" role="tab" selected={period === 'week'} onPress={() => setPeriod('week')} />
        <Pill label="Month" role="tab" selected={period === 'month'} onPress={() => setPeriod('month')} />
      </View>
      <View style={styles.row}>
        <Pill label={`Previous ${period}`} onPress={() => setChosenDate(moveCalendar(active, period, -1))} />
        <Pill label={`Next ${period}`} onPress={() => setChosenDate(moveCalendar(active, period, 1))} />
        <Pill label="Return to today" disabled={active === today} onPress={() => setChosenDate(null)} />
      </View>
      <View style={styles.row}>
        {calendarDates(active, period).map((date) => {
          const day = fromDateKey(date);
          const logged = logs?.has(date);
          return <Pill key={date} label={`${dayLabel.format(day)}${logged ? ' ·' : ''}`} selected={date === active}
            accessibilityLabel={`${fullLabel.format(day)}${logged ? ', entries logged' : ''}`} onPress={() => setChosenDate(date)} />;
        })}
      </View>
      <SectionTitle>{fullLabel.format(fromDateKey(active))}</SectionTitle>
      {loading && <Notice>Opening saved activity.</Notice>}
      {incomplete && <Notice>Some sections are unavailable. The calendar may be incomplete.</Notice>}
      {activeLog ? <Notice>{activeLog.workouts} workouts · {activeLog.food} food entries · {activeLog.checkIns} check-ins · {activeLog.weights} weigh-ins</Notice>
        : !loading && !incomplete && <Notice>No entries for this date.</Notice>}
      <Notice>Includes active records and recent weigh-ins.</Notice>
      <Action title="Open food diary for this date" subtle onPress={() => onDiary(active)} />
    </>}
  </Card>;
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
