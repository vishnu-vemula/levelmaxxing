import { type WorkspaceSection, type WorkspaceValues } from '@levelmaxing/contracts';
import { createContext, type PropsWithChildren, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { WorkspaceController, type ResolutionChoice, type WorkspaceStore, type WorkspaceTransport } from './model.ts';

import { combineWorkspaceChanges } from './merge.ts';

const Workspace = createContext<WorkspaceController | null>(null);

type Props = PropsWithChildren<{
  scope: string;
  transport: WorkspaceTransport | null;
  openStore: (scope: string) => Promise<WorkspaceStore>;
  createId: () => string;
}>;

export function WorkspaceBoundary({ scope, openStore, createId, transport, children }: Props) {
  return <AccountWorkspace key={scope} scope={scope} openStore={openStore} createId={createId} transport={transport}>{children}</AccountWorkspace>;
}

function AccountWorkspace({ scope, openStore, createId, transport, children }: Props) {
  const [controller, setController] = useState<WorkspaceController | null>(null);
  useEffect(() => {
    const next = new WorkspaceController(createId);
    setController(next);
    void next.start(() => openStore(scope));
    const changes = AppState.addEventListener('change', (state) => { if (state === 'active') next.syncAll(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') next.syncAll(); }, 60_000);
    return () => {
      clearInterval(timer);
      changes.remove();
      void next.close().catch(() => {
        // An unmounted account cannot recover a native close failure.
      });
    };
  }, [scope, openStore, createId]);
  useEffect(() => { controller?.connect(transport); }, [controller, transport]);
  return <Workspace.Provider value={controller}>{controller && children}</Workspace.Provider>;
}

export function useWorkspace<K extends WorkspaceSection>(section: K) {
  const controller = useContext(Workspace);
  if (!controller) throw new Error('Workspace access requires an active account.');
  const current = useSyncExternalStore(controller.subscribe, () => controller.view(section));
  const value = current.replica.local as WorkspaceValues[K] | null;
  return {
    value,
    version: current.replica.base.version,
    status: current.status,
    save: (next: WorkspaceValues[K], options?: { requireNoConflict: boolean }) => controller.save(section, next, value, options),
    canCombine: () => current.status === 'conflict' && Boolean(combineWorkspaceChanges(section, current.replica.base, value, current.replica.conflict)),
    resolve: (choice: ResolutionChoice) => controller.resolve(section, choice),
    retry: controller.syncAll,
  };
}
