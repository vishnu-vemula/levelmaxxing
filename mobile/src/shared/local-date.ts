export function dateKey(date = new Date()): string {
  return [date.getFullYear().toString().padStart(4, '0'), (date.getMonth() + 1).toString().padStart(2, '0'),
    date.getDate().toString().padStart(2, '0')].join('-');
}

export function fromDateKey(value: string): Date {
  const date = new Date(2000, 0, 1, 12);
  const [year = 2000, month = 1, day = 1] = value.split('-').map(Number);
  date.setFullYear(year, month - 1, day);
  return date;
}

export function selectedDate(value: unknown, fallback = dateKey()): string {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) return fallback;
  return dateKey(fromDateKey(value)) === value ? value : fallback;
}
