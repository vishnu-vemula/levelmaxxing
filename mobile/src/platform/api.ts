import { parseProblemDetails } from '@levelmaxing/contracts';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function createApiRequester(base: string, accessToken: string, publishableKey?: string) {
  async function request<T>(
    route: string,
    decode: (data: unknown) => T | undefined,
    signal?: AbortSignal,
    payload?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const stop = () => controller.abort();
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, 8_000);
    const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${accessToken}` };
    if (publishableKey) headers.apikey = publishableKey;
    if (payload !== undefined) headers['content-type'] = 'application/json';
    try {
      const response = await fetch(new URL(route, base).toString(), {
        method: payload === undefined ? 'GET' : 'POST',
        headers,
        signal: controller.signal,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      let json: unknown;
      try { json = await response.json(); } catch { json = null; }
      if (!response.ok) throw new ApiFailure(response.status, parseProblemDetails(json)?.code ?? 'request_failed');
      const result = decode(json);
      if (!result) throw new ApiFailure(502, 'response_invalid');
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  }

  return request;
}

export type ApiRequester = ReturnType<typeof createApiRequester>;
