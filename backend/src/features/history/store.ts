import type {WorkspaceHistoryMove, WorkspaceHistoryMoveResult, WorkspaceHistoryPage, WorkspaceHistoryQuery} from '@levelmaxing/contracts';
import {HttpProblem} from '../../platform/http.ts';
import type {Actor} from '../access/index.ts';

export type HistoryStore = {
  historyPage(actor: Actor, query: WorkspaceHistoryQuery): Promise<WorkspaceHistoryPage>;
  moveHistory(actor: Actor, command: WorkspaceHistoryMove): Promise<WorkspaceHistoryMoveResult>;
};

export const historyUnavailable = () =>
  new HttpProblem(501, 'history_unavailable', 'Record archive is unavailable');

export const historyOperationChanged = () =>
  new HttpProblem(409, 'history_operation_changed', 'The operation ID already belongs to another archive change');
