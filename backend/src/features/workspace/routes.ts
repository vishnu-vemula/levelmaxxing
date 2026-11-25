import {
  parseWorkspaceBatchRequest, parseWorkspaceCheckedSaveRequest, parseWorkspaceSave, parseWorkspaceSection,
  WORKSPACE_BATCH_MAX_BYTES, WORKSPACE_CHECKED_SAVE_MAX_BYTES, WORKSPACE_MAX_BYTES,
} from '@levelmaxing/contracts';
import {HttpProblem, json, readJson, unavailable} from '../../platform/http.ts';
import type {Actor} from '../access/index.ts';
import {readWorkspaceBatchIndividually} from './batch.ts';
import {workspaceCheckedUnavailable, type WorkspaceStore} from './store.ts';

export function createWorkspaceHandlers(store: WorkspaceStore | undefined) {
  return {
    async batch(request: Request, actor: Actor): Promise<Response> {
      const query = parseWorkspaceBatchRequest(await readJson(request, WORKSPACE_BATCH_MAX_BYTES));
      if (!query) throw new HttpProblem(400, 'invalid_workspace_batch', 'Select up to four different workspace sections');
      if (!store) throw unavailable();
      return json(await (store.readBatch?.(actor, query) ?? readWorkspaceBatchIndividually(store, actor, query)));
    },
    async read(request: Request, actor: Actor): Promise<Response> {
      const query = new URL(request.url).searchParams;
      const sections = query.getAll('section');
      const section = sections.length === 1 ? parseWorkspaceSection(sections[0]) : undefined;
      if (!section) throw new HttpProblem(400, 'invalid_workspace_section', 'Select one workspace section');
      if (!store) throw unavailable();
      return json(await store.read(actor, section));
    },
    async saveChecked(request: Request, actor: Actor): Promise<Response> {
      const input = parseWorkspaceCheckedSaveRequest(await readJson(request, WORKSPACE_CHECKED_SAVE_MAX_BYTES));
      if (!input) throw new HttpProblem(400, 'invalid_workspace_command', 'The checked workspace change is invalid');
      if (!store) throw unavailable();
      if (!store.saveChecked) throw workspaceCheckedUnavailable();
      return json(await store.saveChecked(actor, input));
    },
    async save(request: Request, actor: Actor): Promise<Response> {
      const command = parseWorkspaceSave(await readJson(request, WORKSPACE_MAX_BYTES));
      if (!command) throw new HttpProblem(400, 'invalid_workspace_command', 'The workspace change is invalid');
      if (!store) throw unavailable();
      return json(await store.save(actor, command));
    },
  };
}
