import {
  ACCOUNT_EXPORT_WEIGHT_PAGE_GROUPS, parseAccountExportPage, workspaceSections,
} from '@levelmaxing/contracts';
import type {Actor} from '../access/index.ts';
import type {CursorCodec, SyncStore} from '../sync/index.ts';
import type {WorkspaceStore} from '../workspace/index.ts';
import {cursorExpired, HttpProblem, json, unavailable} from '../../platform/http.ts';

export function createAccountExportHandlers(
  syncStore: SyncStore,
  workspaceStore: WorkspaceStore | undefined,
  codec: CursorCodec,
  requireRecentAuthentication: (actor: Actor) => void,
) {
  return {
    async read(request: Request, actor: Actor): Promise<Response> {
      requireRecentAuthentication(actor);
      if (!workspaceStore) throw unavailable();
      const query = new URL(request.url).searchParams;
      const cursors = query.getAll('cursor');
      if (cursors.length > 1 || [...query.keys()].some((key) => key !== 'cursor')) {
        throw new HttpProblem(400, 'invalid_export_query', 'Provide at most one export cursor');
      }
      // The same cursor primitive is purpose-bound, even for a cursor from this account's legacy weight-sync flow.
      const scope = `account-export-v1:${actor.accountId}`;
      const cursor = cursors[0];
      const state = cursor === undefined ? {after: '0'} : await codec.decode(scope, cursor);
      if (cursor !== undefined && (!('highWater' in state) || state.highWater === undefined || state.after === '0')) {
        throw cursorExpired();
      }

      const [weight, workspace] = await Promise.all([
        syncStore.pull(actor, {...state, limit: ACCOUNT_EXPORT_WEIGHT_PAGE_GROUPS}),
        cursor === undefined ? readWorkspace(workspaceStore, actor) : Promise.resolve(null),
      ]);
      if (('epoch' in state && state.epoch !== weight.epoch) ||
          ('highWater' in state && state.highWater !== weight.highWater)) throw unavailable();
      let after = BigInt(state.after);
      for (const group of weight.groups) {
        after += 1n;
        if (BigInt(group.revision) !== after) throw unavailable();
      }
      const nextCursor = after < BigInt(weight.highWater) ? await codec.encode(scope, {
        epoch: weight.epoch, after: after.toString(), highWater: weight.highWater,
      }) : null;
      const validated = parseAccountExportPage({
        schemaVersion: 1, workspace, weight: {highWater: weight.highWater, groups: weight.groups, nextCursor},
      });
      if (!validated) throw unavailable();
      return json(validated);
    },
  };
}

async function readWorkspace(store: WorkspaceStore, actor: Actor): Promise<unknown> {
  if (store.readBatch) {
    const page = await store.readBatch(actor, {sections: workspaceSections.map(section => ({section, known: null}))});
    return Object.fromEntries(page.sections.map(({section, snapshot}) => [section, snapshot]));
  }
  const [profile, training, nutrition, journal] = await Promise.all([
    store.read(actor, 'profile'), store.read(actor, 'training'), store.read(actor, 'nutrition'), store.read(actor, 'journal'),
  ]);
  return {profile, training, nutrition, journal};
}
