import { objectValue } from './index.ts';
import {
  parseWorkspaceSave, parseWorkspaceSaveResult, parseWorkspaceSection, parseWorkspaceSnapshot, WORKSPACE_MAX_BYTES, workspaceSections,
  type WorkspaceSave, type WorkspaceSaveResult, type WorkspaceSection, type WorkspaceSnapshot,
} from './workspace.ts';

export const WORKSPACE_BATCH_MAX_BYTES = 1024;
export const WORKSPACE_EMPTY_TAG = '0'.repeat(64);
export const WORKSPACE_CHECKED_SAVE_MAX_BYTES =
  WORKSPACE_MAX_BYTES + JSON.stringify({ command: null, known: WORKSPACE_EMPTY_TAG }).length - 'null'.length;
export type WorkspaceCheckedSaveRequest = { command: WorkspaceSave; known: string };
export type WorkspaceCheckedSaveResult<K extends WorkspaceSection = WorkspaceSection> = WorkspaceSaveResult<K> & { tag?: string };
export type WorkspaceBatchRequest = { sections: { section: WorkspaceSection; known: string | null }[] };
export type WorkspaceBatchResponse = {
  sections: { section: WorkspaceSection; tag: string; snapshot: WorkspaceSnapshot | null }[];
};

function isTag(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
}

export function parseWorkspaceCheckedSaveRequest(input: unknown): WorkspaceCheckedSaveRequest | undefined {
  const raw = objectValue(input);
  if (!raw || Object.keys(raw).length !== 2 || !isTag(raw.known)) return;
  const command = parseWorkspaceSave(raw.command);
  if (!command || (command.expect === 0) !== (raw.known === WORKSPACE_EMPTY_TAG)) return;
  return { command, known: raw.known };
}

export function parseWorkspaceCheckedSaveResult<K extends WorkspaceSection>(
  section: K, input: unknown,
): WorkspaceCheckedSaveResult<K> | undefined {
  const raw = objectValue(input);
  const result = parseWorkspaceSaveResult(section, raw);
  if (!raw || !result || (result.outcome === 'applied' && result.snapshot.version === 0)) return;
  if (raw.tag === undefined) return result;
  if (result.outcome === 'applied' && isTag(raw.tag) && raw.tag !== WORKSPACE_EMPTY_TAG) {
    return { ...result, tag: raw.tag };
  }
}

export function parseWorkspaceBatchRequest(input: unknown): WorkspaceBatchRequest | undefined {
  const raw = objectValue(input);
  const entries = raw?.sections;
  if (!raw || Object.keys(raw).length !== 1 || !Array.isArray(entries) || entries.length === 0 ||
      entries.length > workspaceSections.length) return;
  const sections: WorkspaceBatchRequest['sections'] = [];
  const used = new Set<WorkspaceSection>();
  for (const item of entries) {
    const entry = objectValue(item);
    const section = parseWorkspaceSection(entry?.section);
    if (!entry || !section || used.has(section) || Object.keys(entry).length !== 2 ||
        !(entry.known === null || isTag(entry.known))) return;
    used.add(section);
    sections.push({ section, known: entry.known });
  }
  return { sections };
}

export function parseWorkspaceBatchResponse(request: WorkspaceBatchRequest, input: unknown): WorkspaceBatchResponse | undefined {
  const entries = objectValue(input)?.sections;
  if (!Array.isArray(entries) || entries.length !== request.sections.length) return;
  const sections: WorkspaceBatchResponse['sections'] = [];
  for (const [index, { section, known }] of request.sections.entries()) {
    const entry = objectValue(entries[index]);
    if (!entry || entry.section !== section || !isTag(entry.tag)) return;
    if (entry.tag === known) {
      if (entry.snapshot !== null) return;
      sections.push({ section, tag: entry.tag, snapshot: null });
    } else {
      const snapshot = parseWorkspaceSnapshot(section, entry.snapshot);
      if (!snapshot || (snapshot.version === 0) !== (entry.tag === WORKSPACE_EMPTY_TAG)) return;
      sections.push({ section, tag: entry.tag, snapshot });
    }
  }
  return { sections };
}
