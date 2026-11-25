import { isRecord, request } from '../../shared/http.ts';

export async function getServiceStatus(
  base: string,
  signal: AbortSignal,
  fetcher?: typeof fetch,
): Promise<boolean> {
  if (!base) return false;
  const value = await request(base + '/healthz', signal, undefined, fetcher);
  return isRecord(value) && value.status === 'ok';
}
