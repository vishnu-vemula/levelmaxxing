import { initializeApp } from 'firebase/app';
import {
  getMultiFactorResolver,
  initializeAuth,
  inMemoryPersistence,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
  type MultiFactorError,
} from 'firebase/auth';
import type { AdminConfiguration } from '../../shared/config.ts';
import { createOperatorIdentity } from './operatorIdentity.ts';

type FirebaseSettings = Extract<AdminConfiguration['identity'], { kind: 'firebase' }>;

function isMultiFactorRequired(error: unknown): error is MultiFactorError {
  return typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'auth/multi-factor-auth-required';
}

export function createFirebaseIdentity({ projectId, apiKey, authDomain, appId }: FirebaseSettings) {
  const app = initializeApp({ projectId, apiKey, authDomain, appId }, 'levelmaxing-admin');
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });

  return createOperatorIdentity({
    async signIn({ email, password }) {
      try {
        const credentials = await signInWithEmailAndPassword(auth, email, password);
        return { kind: 'session', session: credentials.user };
      } catch (error) {
        if (!isMultiFactorRequired(error)) throw error;
        const resolver = getMultiFactorResolver(auth, error);
        const factors = resolver.hints
          .filter((factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID)
          .map((factor, index) => ({ id: factor.uid, label: factor.displayName || `Authenticator ${index + 1}` }));
        return {
          kind: 'challenge',
          factors,
          async resolve(factorId, code) {
            const assertion = TotpMultiFactorGenerator.assertionForSignIn(factorId, code);
            const credentials = await resolver.resolveSignIn(assertion);
            return credentials.user;
          },
        };
      }
    },
    signOut: () => signOut(auth),
    observe: (listener) => onIdTokenChanged(auth, listener),
  });
}
