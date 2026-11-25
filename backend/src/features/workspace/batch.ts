import {
  WORKSPACE_EMPTY_TAG, type WorkspaceBatchRequest, type WorkspaceBatchResponse, type WorkspaceSnapshot,
} from '@levelmaxing/contracts';
import type {Actor} from '../access/index.ts';
import type {WorkspaceStore} from './store.ts';

export async function workspaceDigest(value: unknown): Promise<Uint8Array> {
  const canonical = JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : Number(left > right)));
  });
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
}

export function digestTag(digest: Uint8Array): string {
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function conditionalWorkspaceSection(
  entry: WorkspaceBatchRequest['sections'][number],
  tag: string,
  snapshot: WorkspaceSnapshot,
): WorkspaceBatchResponse['sections'][number] {
  return {section: entry.section, tag, snapshot: tag === entry.known ? null : snapshot};
}

export async function readWorkspaceBatchIndividually(
  store: Pick<WorkspaceStore, 'read'>, actor: Actor, request: WorkspaceBatchRequest,
): Promise<WorkspaceBatchResponse> {
  const sections = await Promise.all(request.sections.map(async (entry) => {
    const snapshot = await store.read(actor, entry.section);
    const tag = snapshot.version === 0 ? WORKSPACE_EMPTY_TAG :
      digestTag(await workspaceDigest([actor.accountId, entry.section, snapshot.version, snapshot.value]));
    return conditionalWorkspaceSection(entry, tag, snapshot);
  }));
  return {sections};
}
