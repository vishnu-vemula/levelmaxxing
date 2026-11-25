import type {WorkspaceBatchRequest, WorkspaceBatchResponse, WorkspaceCheckedSaveRequest, WorkspaceCheckedSaveResult, WorkspaceSave, WorkspaceSaveResult, WorkspaceSection, WorkspaceSnapshot} from '@levelmaxing/contracts';
import {HttpProblem} from '../../platform/http.ts';
import type {Actor} from '../access/index.ts';

export type WorkspaceStore = {
  readBatch?(actor: Actor, request: WorkspaceBatchRequest): Promise<WorkspaceBatchResponse>;
  read(actor: Actor, section: WorkspaceSection): Promise<WorkspaceSnapshot<WorkspaceSection>>;
  save(actor: Actor, command: WorkspaceSave): Promise<WorkspaceSaveResult>;
  saveChecked?(actor: Actor, request: WorkspaceCheckedSaveRequest): Promise<WorkspaceCheckedSaveResult>;
};

export const emptyWorkspace = {version: 0, value: null} as const;

export const workspaceOperationChanged = () =>
  new HttpProblem(409, 'workspace_operation_changed', 'The operation ID already belongs to another change');

export const workspaceCheckedUnavailable = () =>
  new HttpProblem(501, 'checked_workspace_unavailable', 'Checked workspace saves are unavailable');
