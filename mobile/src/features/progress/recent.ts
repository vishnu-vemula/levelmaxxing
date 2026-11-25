import type { Entry, ProgressStore } from './sync.ts';

type Observer = {
  publish(entries: Entry[]): void;
  unavailable(): void;
};

export async function publishRecent(
  store: Pick<ProgressStore, 'recent'>,
  isCurrent: () => boolean,
  observer: Observer,
): Promise<void> {
  if (!isCurrent()) return;
  let entries: Entry[];
  try {
    entries = await store.recent();
  } catch {
    if (isCurrent()) observer.unavailable();
    return;
  }
  if (isCurrent()) observer.publish(entries);
}
