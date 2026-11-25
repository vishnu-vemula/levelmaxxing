import {isUuid, MAX_BODY_BYTES, MAX_PULL_GROUPS, objectValue, parsePushRequest} from '@levelmaxing/contracts';
import type {Actor} from '../access/index.ts';
import {HttpProblem, json, readJson, unavailable} from '../../platform/http.ts';
import type {SyncStore} from './store.ts';
import type {CursorCodec} from './cursor.ts';

export function createSyncHandlers(store: SyncStore, codec: CursorCodec) {
  return {
    async register(request: Request, actor: Actor): Promise<Response> {
      const device = objectValue(await readJson(request, 1_024));
      if (!isUuid(device?.deviceId)) throw new HttpProblem(400, 'invalid_device', 'A device UUID is required');
      return json(await store.registerDevice(actor, device.deviceId));
    },
    async push(request: Request, actor: Actor): Promise<Response> {
      const payload = parsePushRequest(await readJson(request, MAX_BODY_BYTES));
      if (!payload) throw new HttpProblem(400, 'invalid_sync_command', 'The sync command is invalid');
      return json(await store.push(actor, payload));
    },
    async pull(request: Request, actor: Actor): Promise<Response> {
      const params = new URL(request.url).searchParams;
      const cursor = params.get('cursor');
      const state = cursor === null ? {after: '0'} : await codec.decode(actor.accountId, cursor);
      const limitValue = params.get('limit');
      const limit = limitValue === null ? MAX_PULL_GROUPS : Number(limitValue);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PULL_GROUPS) {
        throw new HttpProblem(400, 'invalid_page_size', 'The sync page size is invalid');
      }
      const page = await store.pull(actor, {...state, limit});
      const watermark = BigInt(page.highWater);
      let after = BigInt(state.after);
      if (after > watermark || ('epoch' in state && state.epoch !== page.epoch)
          || ('highWater' in state && state.highWater !== undefined && state.highWater !== page.highWater)
          || page.groups.length > limit) throw unavailable();
      for (const group of page.groups) {
        if (BigInt(group.revision) !== after + 1n) throw unavailable();
        after += 1n;
      }
      if (after > watermark || (after < watermark && page.groups.length === 0)) throw unavailable();
      const hasMore = after < watermark;
      const nextCursor = await codec.encode(actor.accountId, {
        epoch: page.epoch, after: after.toString(), ...(hasMore ? {highWater: page.highWater} : {}),
      });
      return json({epoch: page.epoch, groups: page.groups, nextCursor, hasMore});
    },
  };
}
