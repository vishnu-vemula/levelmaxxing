import { parseSessionResponse } from '@levelmaxing/contracts';
import type { ApiRequester } from '../../platform/api.ts';

export function resolveAccountSession(request: ApiRequester, signal?: AbortSignal) {
  return request('v1/session', parseSessionResponse, signal);
}
