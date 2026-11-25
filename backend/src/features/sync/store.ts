import type { DeviceRegistration, PushRequest, PushResponse, SyncGroup } from '@levelmaxing/contracts';
import type { Actor } from '../access/index.ts';

export type ReadWindow = {epoch?: string; after: string; highWater?: string; limit: number};
export type SyncPage = {epoch: string; highWater: string; groups: SyncGroup[]};

/** All state changes and terminal dispositions commit under the same account revision. */
export interface SyncStore {
  registerDevice(actor: Actor, deviceId: string): Promise<DeviceRegistration>;
  push(actor: Actor, request: PushRequest): Promise<PushResponse>;
  pull(actor: Actor, window: ReadWindow): Promise<SyncPage>;
}
