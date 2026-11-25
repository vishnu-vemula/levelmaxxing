import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {createApp, type AppDependencies} from './app.ts';
import type {AccountIdentity} from './features/access/index.ts';
import {createCursorCodec, createMemorySyncStore} from './features/sync/index.ts';
import {createMemoryWorkspaceStore} from './features/workspace/index.ts';

const primary = 'bb9d5323-06ea-4924-81c5-ab2fab6f3a02';
const secondary = 'b4670b4f-55b6-4116-a87e-9cca3d60952e';
const operator = 'babf4584-b528-4080-8119-e9aea5cad647';
const tokenPattern = /^[A-Za-z0-9._~+/-]{32,256}$/;

type LocalConfig = {
  participantToken: string;
  secondParticipantToken?: string;
  operatorToken?: string;
  allowedOrigin?: string;
  log?: AppDependencies['log'];
};
const hash = (value: string) => createHash('sha256').update(value).digest();

export function createLocalApp(config: LocalConfig) {
  const credentials: {token: string; actor: AccountIdentity}[] = [
    {token: config.participantToken, actor: {accountId: primary, role: 'participant', assurance: 'aal1'}},
  ];
  if (config.secondParticipantToken !== undefined) credentials.push({
    token: config.secondParticipantToken, actor: {accountId: secondary, role: 'participant', assurance: 'aal1'},
  });
  if (config.operatorToken !== undefined) credentials.push({
    token: config.operatorToken, actor: {accountId: operator, role: 'operator', assurance: 'aal2'},
  });
  if (credentials.some(({token}) => !tokenPattern.test(token)) || new Set(credentials.map(({token}) => token)).size !== credentials.length) {
    throw new Error('Supply distinct local bearer tokens of at least 32 characters.');
  }
  const identities = credentials.map(({token, actor}) => ({digest: hash(token), actor}));
  const workspaceStore = createMemoryWorkspaceStore();
  return createApp({
    verifyIdentity: async token => {
      const digest = hash(token);
      const identity = identities.find(candidate => timingSafeEqual(candidate.digest, digest))?.actor;
      return identity && {...identity, authenticatedAt: Math.floor(Date.now() / 1_000)};
    },
    syncStore: createMemorySyncStore(),
    workspaceStore,
    historyStore: workspaceStore,
    cursorCodec: createCursorCodec(randomBytes(32).toString('hex')),
    allowedOrigin: config.allowedOrigin ?? 'http://localhost:5173',
    ...(config.log === undefined ? {} : {log: config.log}),
  });
}
