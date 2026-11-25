import { isRecord, request, RequestError } from '../../shared/http.ts';

export type AccessResult = 'operator' | 'expired' | 'denied' | 'unavailable';

export async function checkOperator(
  base: string,
  token: string,
  signal: AbortSignal,
  fetcher?: typeof fetch,
): Promise<AccessResult> {
  try {
    const value = await request(base + '/v1/admin/access', signal, token, fetcher);
    return isRecord(value) && value.role === 'operator' ? 'operator' : 'unavailable';
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof RequestError && error.status === 401) return 'expired';
    if (error instanceof RequestError && error.status === 403) return 'denied';
    return 'unavailable';
  }
}
