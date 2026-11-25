import { randomUUID } from 'expo-crypto';
import { createProgressTransport, openProgressStore } from './features/progress/index.ts';
import { createAuth, readEnvironment, type AuthEnvironment } from './features/session/index.ts';
import { createWorkspaceTransport, openWorkspaceStore } from './features/workspace/index.ts';
import { createApiRequester } from './platform/api.ts';

export function createMobileServices() {
  const environment = readEnvironment();

  return {
    account: environment && { environment, gateway: createAuth(environment) },
    openProgressStore,
    openWorkspaceStore,
    createMeasurementId: randomUUID,
    connectWorkspace(environment: AuthEnvironment, accessToken: string) {
      const publishableKey = environment.mode === 'cloud' ? environment.publishableKey : undefined;
      return createWorkspaceTransport(createApiRequester(environment.api, accessToken, publishableKey));
    },
    connectProgress(environment: AuthEnvironment, accessToken: string) {
      const publishableKey = environment.mode === 'cloud' ? environment.publishableKey : undefined;
      return createProgressTransport(createApiRequester(environment.api, accessToken, publishableKey));
    },
  };
}
