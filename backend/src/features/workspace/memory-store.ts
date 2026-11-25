import {
  WORKSPACE_EMPTY_TAG, workspaceHistorySection, type WorkspaceHistoryKind, type WorkspaceHistoryMoveResult,
  type WorkspaceSave, type WorkspaceSaveResult, type WorkspaceSection, type WorkspaceSnapshot,
} from '@levelmaxing/contracts';
import {conditionalWorkspaceSection, digestTag, workspaceDigest} from './batch.ts';
import type {Actor} from '../access/index.ts';
import {
  archivePage, hasArchivedWorkspaceRecords, historyOperationChanged, planHistoryMove, type ArchivedHistoryRow, type HistoryStore,
} from '../history/index.ts';
import {emptyWorkspace, workspaceOperationChanged, type WorkspaceStore} from './store.ts';

type Receipt<T> = {digest: Uint8Array; result: T};
type StoredSection = {snapshot: WorkspaceSnapshot; tag: string};
type Account = {
  sections: Map<WorkspaceSection, StoredSection>;
  receipts: Map<string, Receipt<WorkspaceSaveResult>>;
  archive: Record<WorkspaceHistoryKind, Map<string, ArchivedHistoryRow>>;
  historyReceipts: Map<string, Receipt<WorkspaceHistoryMoveResult>>;
};

function matchesDigest(expected: Uint8Array, prior: Uint8Array): boolean {
  return expected.every((byte, index) => byte === prior[index]);
}

function historyOutcome(
  outcome: WorkspaceHistoryMoveResult['outcome'], current: StoredSection | undefined, moved = 0,
): WorkspaceHistoryMoveResult {
  return {outcome, moved, version: current?.snapshot.version ?? 0, tag: current?.tag ?? WORKSPACE_EMPTY_TAG};
}

/** The local harness stores fictional data for the lifetime of the listener. */
export function createMemoryWorkspaceStore(): WorkspaceStore & HistoryStore {
  const accounts = new Map<string, Account>();

  function getAccount(id: string): Account {
    let account = accounts.get(id);
    if (!account) {
      account = {
        sections: new Map(),
        receipts: new Map(),
        archive: {meals: new Map(), workouts: new Map()},
        historyReceipts: new Map(),
      };
      accounts.set(id, account);
    }
    return account;
  }

  async function apply(actor: Actor, command: WorkspaceSave, known?: string): Promise<Receipt<WorkspaceSaveResult>> {
    const {operationId, expect, section, value} = command;
    const digest = await workspaceDigest([actor.accountId, section, expect, value]);
    const account = getAccount(actor.accountId);
    const receipt = account.receipts.get(operationId);
    if (receipt) {
      if (!matchesDigest(digest, receipt.digest)) throw workspaceOperationChanged();
      return receipt;
    }
    // CAS and receipt commit together, without a suspension point.
    const stored = account.sections.get(section);
    const current = stored?.snapshot ?? emptyWorkspace;
    const matchesBase = known === undefined || known === (stored?.tag ?? WORKSPACE_EMPTY_TAG);
    let result: WorkspaceSaveResult;
    if (expect === current.version && matchesBase && !hasArchivedWorkspaceRecords(command, account.archive.meals, account.archive.workouts)) {
      const snapshot = {version: current.version + 1, value: structuredClone(value)};
      account.sections.set(section, {snapshot, tag: digestTag(digest)});
      result = {outcome: 'applied', snapshot};
    } else {
      result = {outcome: 'conflict', snapshot: current};
    }
    const committed = {digest, result};
    account.receipts.set(operationId, committed);
    return committed;
  }

  return {
    async read(actor, section) {
      return structuredClone(accounts.get(actor.accountId)?.sections.get(section)?.snapshot ?? emptyWorkspace);
    },
    async readBatch(actor, request) {
      const account = accounts.get(actor.accountId);
      return {sections: request.sections.map((entry) => {
        const stored = account?.sections.get(entry.section);
        const result = conditionalWorkspaceSection(entry, stored?.tag ?? WORKSPACE_EMPTY_TAG, stored?.snapshot ?? emptyWorkspace);
        return structuredClone(result);
      })};
    },
    async save(actor, command) {
      return structuredClone((await apply(actor, command)).result);
    },
    async saveChecked(actor, {command, known}) {
      const receipt = await apply(actor, command, known);
      const result = structuredClone(receipt.result);
      return result.outcome === 'applied' ? {...result, tag: digestTag(receipt.digest)} : result;
    },
    async historyPage(actor, query) {
      return archivePage(accounts.get(actor.accountId)?.archive[query.kind], query);
    },
    async moveHistory(actor, command) {
      const {action, kind, ids, operationId, expectVersion, known, recordTags} = command;
      const digest = await workspaceDigest([action, kind, ids, expectVersion, known, recordTags ?? null]);
      const account = getAccount(actor.accountId);
      const archive = account.archive[kind];
      const section = workspaceHistorySection(kind);

      function replay(): WorkspaceHistoryMoveResult | undefined {
        const receipt = account.historyReceipts.get(operationId);
        if (!receipt) return;
        if (!matchesDigest(digest, receipt.digest)) throw historyOperationChanged();
        return {...receipt.result};
      }

      function finish(result: WorkspaceHistoryMoveResult): WorkspaceHistoryMoveResult {
        account.historyReceipts.set(operationId, {digest, result});
        return {...result};
      }

      const previous = replay();
      if (previous) return previous;
      const head = account.sections.get(section);
      if (!head || head.snapshot.version !== expectVersion || head.tag !== known) return finish(historyOutcome('conflict', head));
      if (expectVersion === Number.MAX_SAFE_INTEGER) return finish(historyOutcome('capacity', head));

      const plan = planHistoryMove(head.snapshot, command, archive);
      if (plan.outcome !== 'ready') return finish(historyOutcome(plan.outcome, head));

      const value = plan.workspace.value;
      const archiveRows = action === 'archive' ? Promise.all(plan.recordChanges.map(async (record) => ({
        ...record,
        tag: digestTag(await workspaceDigest([actor.accountId, kind, record.date, record.id, record.value])),
      }))) : [];
      const [sectionDigest, additions] = await Promise.all([
        workspaceDigest([actor.accountId, section, expectVersion, value]), archiveRows,
      ]);
      const concurrentReplay = replay();
      if (concurrentReplay) return concurrentReplay;
      const current = account.sections.get(section);
      if (current !== head) return finish(historyOutcome('conflict', current));

      // No suspension between moving the rows, advancing the head and writing the receipt.
      if (action === 'archive') for (const row of additions) archive.set(row.id, row);
      else for (const id of ids) archive.delete(id);
      const next = {snapshot: {version: expectVersion + 1, value}, tag: digestTag(sectionDigest)};
      account.sections.set(section, next);
      return finish(historyOutcome('applied', next, plan.recordChanges.length));
    },
  };
}
