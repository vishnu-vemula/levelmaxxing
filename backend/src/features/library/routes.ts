import { isLibraryId, MAX_LIBRARY_PAGE_SIZE, MAX_LIBRARY_QUERY_CHARS, parseLibraryCategory, type LibraryQuery } from '@levelmaxing/contracts';
import { HttpProblem, json } from '../../platform/http.ts';
import type { LibraryCatalog } from './catalog.ts';

function invalidQuery() {
  return new HttpProblem(400, 'invalid_library_query', 'Supply valid library query parameters');
}

function hasUniqueParameters(params: URLSearchParams, keys: readonly string[]) {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!keys.includes(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function readQuery(params: URLSearchParams): LibraryQuery {
  if (!hasUniqueParameters(params, ['q', 'category', 'after', 'limit'])) throw invalidQuery();
  const q = params.get('q');
  const category = params.get('category');
  const parsedCategory = parseLibraryCategory(category);
  const after = params.get('after');
  const textLimit = params.get('limit');
  const limit = textLimit === null ? undefined : Number(textLimit);
  if ((q !== null && (q.length > MAX_LIBRARY_QUERY_CHARS || /[\u0000-\u001f\u007f]/.test(q))) ||
      (category !== null && !parsedCategory) ||
      (after !== null && !isLibraryId(after)) ||
      (textLimit !== null && (!/^[1-9]\d?$/.test(textLimit) || limit === undefined || limit > MAX_LIBRARY_PAGE_SIZE))) {
    throw invalidQuery();
  }
  return {
    ...(q === null ? {} : { q }),
    ...(parsedCategory === undefined ? {} : { category: parsedCategory }),
    ...(after === null ? {} : { after }),
    ...(limit === undefined ? {} : { limit }),
  };
}

export function createLibraryHandlers(catalog: LibraryCatalog) {
  return {
    list(request: Request) {
      return json(catalog.list(readQuery(new URL(request.url).searchParams)));
    },
    read(request: Request) {
      const query = new URL(request.url).searchParams;
      const id = query.get('id');
      if (!hasUniqueParameters(query, ['id']) || !isLibraryId(id)) throw invalidQuery();
      const found = catalog.read(id);
      if (!found) throw new HttpProblem(404, 'library_guide_not_found', 'This guide is unavailable');
      return json(found);
    },
  };
}
