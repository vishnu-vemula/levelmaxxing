import { DEFAULT_LIBRARY_PAGE_SIZE, normalizeLibrarySearch, type LibraryDetail, type LibraryGuide, type LibraryPage, type LibraryQuery } from './library.ts';

// Retain IDs across content revisions for account bookmarks. Increment the version when content changes.
const catalogVersion = 1;

const guides = [
  {
    id: 'training-log', category: 'Training', title: 'Build a reliable training log',
    summary: 'Record sets consistently so you can compare similar sessions.',
    steps: [
      'Keep a recognizable name for the exercise and the same weight convention each time. Note whether a dumbbell weight is per hand.',
      'Record the reps and load you actually used. If you replace an exercise, log the replacement so it stays recognizable in history.',
      'Review the last session when setting up the next one. A missed set is information you can use the next time you train.',
    ],
  },
  {
    id: 'food-label', category: 'Nutrition', title: 'Log a serving from a food label',
    summary: 'Use the serving amount printed on the package.',
    steps: [
      'Check whether the label lists values per serving or per 100 grams. Use the matching unit when you enter the food.',
      'If you ate two of the listed servings, enter a quantity of two. Review the diary entry before saving.',
      'For a frequent meal with several ingredients, save it as a recipe with a serving count. Log only the portion you ate.',
    ],
  },
  {
    id: 'check-in', category: 'Progress', title: 'Find a check-in rhythm',
    summary: 'Track the context around a training week.',
    steps: [
      'Pick a consistent time to record sleep, energy, and hunger. The same scale each day makes the journal easier to read.',
      'Use the note for anything you want to remember. Keeping it to a sentence can make the check-in easier to repeat.',
      'Look across several entries when you review your week. Record actual activity alongside your planned sessions.',
    ],
  },
] as const satisfies readonly LibraryGuide[];

// The same curated English content ships in the API and in the native offline fallback.
const ordered = [...guides].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export function listBundledGuides({ q, category, after, limit = DEFAULT_LIBRARY_PAGE_SIZE }: LibraryQuery = {}): LibraryPage {
  const words = q ? normalizeLibrarySearch(q).split(' ').filter(Boolean) : [];
  const matching = ordered.filter((guide) => {
    if ((after && guide.id <= after) || (category && guide.category !== category)) return false;
    if (!words.length) return true;
    const text = normalizeLibrarySearch([guide.title, guide.summary, guide.category].join(' '));
    return words.every((word) => text.includes(word));
  });
  const cards = matching.slice(0, limit).map(({ id, title, summary, category }) => ({ id, title, summary, category }));
  const nextAfter = matching.length > cards.length ? cards.at(-1)?.id ?? null : null;
  return { catalogVersion, cards, nextAfter };
}

export function readBundledGuide(id: string): LibraryDetail | undefined {
  const guide = guides.find((entry) => entry.id === id);
  if (guide) return { catalogVersion, guide };
}
