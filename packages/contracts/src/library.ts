import { isPositiveInt, objectValue } from './index.ts';

export const libraryCategories = ['Training', 'Nutrition', 'Progress'] as const;
export const MAX_LIBRARY_QUERY_CHARS = 80;
export const MAX_LIBRARY_PAGE_SIZE = 25;
export const DEFAULT_LIBRARY_PAGE_SIZE = 12;

export type LibraryCategory = typeof libraryCategories[number];
export type LibraryCard = {
  id: string;
  category: LibraryCategory;
  title: string;
  summary: string;
};
export type LibraryGuide = LibraryCard & { steps: readonly string[] };
export type LibraryQuery = { q?: string; category?: LibraryCategory; after?: string; limit?: number };
export type LibraryPage = { catalogVersion: number; cards: readonly LibraryCard[]; nextAfter: string | null };
export type LibraryDetail = { catalogVersion: number; guide: LibraryGuide };

export function isLibraryId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function parseLibraryCategory(value: unknown): LibraryCategory | undefined {
  return libraryCategories.find((category) => category === value);
}

export function normalizeLibrarySearch(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseLibraryCard(input: unknown): LibraryCard | undefined {
  const raw = objectValue(input);
  const category = parseLibraryCategory(raw?.category);
  if (!raw || !isLibraryId(raw.id) || !category || !isText(raw.title, 120) || !isText(raw.summary, 400)) return;
  return { id: raw.id, category, title: raw.title, summary: raw.summary };
}

export function parseLibraryPage(input: unknown): LibraryPage | undefined {
  const raw = objectValue(input);
  if (!raw || !isPositiveInt(raw.catalogVersion) || !Array.isArray(raw.cards) || raw.cards.length > MAX_LIBRARY_PAGE_SIZE ||
      !(raw.nextAfter === null || isLibraryId(raw.nextAfter))) return;
  const cards: LibraryCard[] = [];
  for (const item of raw.cards) {
    const card = parseLibraryCard(item);
    const last = cards.at(-1);
    if (!card || (last && card.id <= last.id)) return;
    cards.push(card);
  }
  if (raw.nextAfter !== null && raw.nextAfter !== cards.at(-1)?.id) return;
  return { catalogVersion: raw.catalogVersion, cards, nextAfter: raw.nextAfter };
}

export function parseLibraryDetail(input: unknown): LibraryDetail | undefined {
  const raw = objectValue(input);
  const item = objectValue(raw?.guide);
  const card = parseLibraryCard(item);
  if (!raw || !isPositiveInt(raw.catalogVersion) || !item || !card || !Array.isArray(item.steps) ||
      item.steps.length < 1 || item.steps.length > 20 || !item.steps.every((step) => isText(step, 600))) return;
  return { catalogVersion: raw.catalogVersion, guide: { ...card, steps: item.steps } };
}

export { listBundledGuides, readBundledGuide } from './library-guides.ts';
