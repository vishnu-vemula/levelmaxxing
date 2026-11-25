export class RequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('Admin API request failed');
    this.status = status;
  }
}

export async function request(
  url: string,
  signal: AbortSignal,
  token?: string,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const headers = new Headers({ Accept: 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetcher(url, {
    headers,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
  });
  if (!response.ok) throw new RequestError(response.status);
  return await response.json() as unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
