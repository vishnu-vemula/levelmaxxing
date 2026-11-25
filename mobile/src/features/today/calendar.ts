import type { JournalData, NutritionData, TrainingData } from '@levelmaxing/contracts';
import { dateKey, fromDateKey, selectedDate } from '../../shared/local-date.ts';

export type CalendarPeriod = 'week' | 'month';

export function calendarDates(active: string, period: CalendarPeriod): string[] {
  const cursor = fromDateKey(active);
  const month = cursor.getMonth();
  const isWeek = period === 'week';
  cursor.setDate(isWeek ? cursor.getDate() - (cursor.getDay() + 6) % 7 : 1);
  const dates: string[] = [];
  while (isWeek ? dates.length < 7 : cursor.getMonth() === month) {
    dates.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates.filter((date) => selectedDate(date, '') === date);
}

export function moveCalendar(active: string, period: CalendarPeriod, step: -1 | 1): string {
  const date = fromDateKey(active);
  if (period === 'week') {
    date.setDate(date.getDate() + step * 7);
  } else {
    const day = date.getDate();
    date.setMonth(date.getMonth() + step, 1);
    const endOfMonth = new Date(date);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0);
    date.setDate(Math.min(day, endOfMonth.getDate()));
  }
  return selectedDate(dateKey(date), active);
}

export function calendarLogDays({ training, nutrition, journal, weights }: {
  training: TrainingData | null; nutrition: NutritionData | null; journal: JournalData | null;
  weights: readonly { measuredOn: string }[];
}) {
  const result = new Map<string, { workouts: number; food: number; checkIns: number; weights: number }>();
  function count(date: string, field: 'workouts' | 'food' | 'checkIns' | 'weights') {
    let item = result.get(date);
    if (!item) {
      item = { workouts: 0, food: 0, checkIns: 0, weights: 0 };
      result.set(date, item);
    }
    item[field] += 1;
  }
  for (const item of training?.history ?? []) {
    if (item.finishedAt) count(dateKey(new Date(item.finishedAt)), 'workouts');
  }
  for (const item of nutrition?.meals ?? []) count(item.date, 'food');
  for (const item of journal?.checkIns ?? []) count(item.date, 'checkIns');
  for (const item of weights) count(item.measuredOn, 'weights');
  return result;
}
