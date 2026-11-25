import type { ProblemDetails } from '@levelmaxing/contracts';

export class HttpProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;

  constructor(status: number, code: string, title: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.title = title;
  }
}

export const unauthorized = () => new HttpProblem(401, 'unauthenticated', 'A valid session is required');
export const unavailable = () => new HttpProblem(503, 'dependency_unavailable', 'The service is temporarily unavailable');
export const contextChanged = () => new HttpProblem(409, 'sync_context_changed', 'The sync context changed');
export const cursorExpired = () => new HttpProblem(410, 'cursor_expired', 'Start a new sync pull');

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {status, headers: {'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}});
}

export function problemResponse(error: HttpProblem, requestId: string): Response {
  const body: ProblemDetails = {
    type: 'about:blank',
    title: error.title,
    status: error.status,
    code: error.code,
    instance: 'urn:uuid:' + requestId,
  };
  const response = json(body, error.status);
  response.headers.set('content-type', 'application/problem+json; charset=utf-8');
  if (error.status === 401) response.headers.set('www-authenticate', 'Bearer realm="levelmaxing"');
  if (error.status === 503) response.headers.set('retry-after', '2');
  return response;
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new HttpProblem(415, 'invalid_content_type', 'Send application/json');
  }
  if (Number(request.headers.get('content-length')) > maxBytes) {
    throw new HttpProblem(413, 'body_too_large', 'The request exceeds the byte limit');
  }
  if (!request.body) throw new HttpProblem(400, 'invalid_json', 'A JSON request body is required');

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let total = 0;
  let text = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new HttpProblem(413, 'body_too_large', 'The request exceeds the byte limit');
      }
      text += decoder.decode(value, {stream: true});
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof HttpProblem) throw error;
    throw new HttpProblem(400, 'invalid_json', 'The request body is not valid UTF-8 JSON');
  } finally {
    reader.releaseLock();
  }
}
