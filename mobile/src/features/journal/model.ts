import type { CheckIn, FoodLog, JournalData, TrainingData } from '@levelmaxing/contracts';

export const emptyJournal: JournalData = { checkIns: [], activities: [], bookmarks: [] };

export function localDay(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function updateCheckIn(journal: JournalData, entry: CheckIn): JournalData {
  return {
    ...journal,
    checkIns: [entry, ...journal.checkIns.filter(({ date }) => date !== entry.date)],
  };
}

export function coachSummary({
  date, meals, training, journal,
}: { date: string; meals: FoodLog[]; training: TrainingData | null; journal: JournalData }) {
  const dayMeals = meals.filter((meal) => meal.date === date);
  const today = journal.checkIns.find((entry) => entry.date === date);
  const latest = training?.history.reduce<TrainingData['session']>((current, next) =>
    next.finishedAt && (!current?.finishedAt || next.finishedAt > current.finishedAt) ? next : current, null);
  return {
    food: dayMeals.length ? `${dayMeals.length} food ${dayMeals.length === 1 ? 'entry' : 'entries'} today.` : 'Your food diary has no entries today.',
    training: training?.session
      ? `${training.session.name} is in progress.`
      : latest ? `Your last completed workout was ${latest.name}.` : 'You have no completed workouts yet.',
    recovery: today ? `Energy ${today.energy}/5, hunger ${today.hunger}/5, sleep ${today.sleep} h.` : 'Your check-in is open for today.',
  };
}
