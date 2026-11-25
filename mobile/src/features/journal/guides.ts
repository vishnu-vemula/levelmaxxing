import {
  listBundledGuides, parseLibraryDetail, parseLibraryPage, readBundledGuide,
  type LibraryDetail, type LibraryPage, type LibraryQuery,
} from '@levelmaxing/contracts';
import { ApiFailure, type ApiRequester } from '../../platform/api.ts';

export function createLibraryTransport(request: ApiRequester) {
  return {
    list(query: LibraryQuery, signal: AbortSignal) {
      const params = new URLSearchParams();
      if (query.q) params.set('q', query.q);
      if (query.category) params.set('category', query.category);
      if (query.after) params.set('after', query.after);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const serialized = params.toString();
      const suffix = serialized ? '?' + serialized : '';
      return request('v1/library' + suffix, parseLibraryPage, signal);
    },
    detail(id: string, signal: AbortSignal) {
      return request('v1/library/guide?id=' + encodeURIComponent(id), (value) => {
        const data = parseLibraryDetail(value);
        if (data?.guide.id === id) return data;
      }, signal);
    },
  };
}
export type LibraryTransport = ReturnType<typeof createLibraryTransport>;

export type CatalogResult<T> = { data: T; source: 'server' | 'bundle' };

function verifyActive(signal: AbortSignal) {
  if (signal.aborted) {
    const interruption = new Error('Library request cancelled');
    interruption.name = 'AbortError';
    throw interruption;
  }
}

export async function loadLibraryPage(
  transport: LibraryTransport | null,
  query: LibraryQuery,
  signal: AbortSignal,
): Promise<CatalogResult<LibraryPage>> {
  verifyActive(signal);
  if (transport) {
    try {
      const data = await transport.list(query, signal);
      verifyActive(signal);
      return { data, source: 'server' };
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return { data: listBundledGuides(query), source: 'bundle' };
}

export async function loadLibraryDetail(
  transport: LibraryTransport | null,
  id: string,
  signal: AbortSignal,
): Promise<CatalogResult<LibraryDetail | undefined>> {
  verifyActive(signal);
  if (transport) {
    try {
      const data = await transport.detail(id, signal);
      verifyActive(signal);
      return { data, source: 'server' };
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof ApiFailure && error.status === 404 && error.code === 'library_guide_not_found') {
        return { data: undefined, source: 'server' };
      }
    }
  }
  return { data: readBundledGuide(id), source: 'bundle' };
}
