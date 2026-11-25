import { listBundledGuides, readBundledGuide, type LibraryDetail, type LibraryPage, type LibraryQuery } from '@levelmaxing/contracts';

export interface LibraryCatalog {
  list(query: LibraryQuery): LibraryPage;
  read(id: string): LibraryDetail | undefined;
}

export const bundledLibraryCatalog: LibraryCatalog = {
  list: listBundledGuides,
  read: readBundledGuide,
};

export function createBundledLibraryCatalog(): LibraryCatalog {
  return bundledLibraryCatalog;
}
