import { parseDeviceRegistration, parsePullResponse, parsePushResponse } from '@levelmaxing/contracts';
import { ApiFailure, type ApiRequester } from '../../platform/api.ts';
import { SyncContextChanged, SyncCursorExpired, SyncSignInRequired, type SyncTransport } from './sync.ts';

const contextErrors = new Set(['sync_context_changed', 'cursor_expired', 'device_context_changed', 'registration_required']);

export function createProgressTransport(request: ApiRequester): SyncTransport {
  async function send<T>(call: Promise<T>, retryCursor = false): Promise<T> {
    try {
      return await call;
    } catch (error) {
      if (error instanceof ApiFailure) {
        if (error.status === 401 || error.status === 403) throw new SyncSignInRequired();
        if (retryCursor && error.status === 410 && error.code === 'cursor_expired') throw new SyncCursorExpired();
        if (contextErrors.has(error.code)) throw new SyncContextChanged();
      }
      throw error;
    }
  }
  return {
    register: (deviceId, signal) => send(request('v1/devices', parseDeviceRegistration, signal, { deviceId })),
    push: (payload, signal) => send(request('v1/sync/push', parsePushResponse, signal, payload)),
    pull: (cursor, signal) => send(request(
      cursor ? `v1/sync/pull?cursor=${encodeURIComponent(cursor)}` : 'v1/sync/pull',
      parsePullResponse,
      signal,
    ), true),
  };
}
