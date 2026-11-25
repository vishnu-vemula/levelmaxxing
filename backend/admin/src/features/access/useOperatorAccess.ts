import { useEffect, useRef, useState } from 'react';
import { checkOperator } from './api.ts';
import type { Factor, IdentityResult, OperatorIdentity } from './operatorIdentity.ts';

export type AccessState =
  | { kind: 'signed-out' }
  | { kind: 'checking' }
  | { kind: 'challenge'; factors: Factor[] }
  | { kind: 'enrollment-required' }
  | { kind: 'operator'; verifiedAt: string }
  | { kind: 'denied' }
  | { kind: 'unavailable' };

export function useOperatorAccess(apiBase: string, identity: OperatorIdentity | undefined) {
  const [state, setState] = useState<AccessState>({ kind: 'signed-out' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operation = useRef(new AbortController());
  const credential = useRef<string | null>(null);
  const signingOut = useRef(false);
  const active = useRef(false);

  function beginOperation(): AbortSignal {
    operation.current.abort();
    operation.current = new AbortController();
    return operation.current.signal;
  }

  async function authorize(token: string, signal: AbortSignal) {
    if (signal.aborted) return;
    credential.current = token;
    setState({ kind: 'checking' });
    const result = await checkOperator(apiBase, token, signal);
    if (signal.aborted) return;
    if (result === 'operator') {
      setState({ kind: 'operator', verifiedAt: new Date().toISOString() });
      return;
    }
    if (result === 'expired' || result === 'denied') {
      credential.current = null;
      if (result === 'expired') setError('Your session has expired. Sign in again.');
    }
    setState({ kind: result === 'expired' ? 'signed-out' : result });
  }

  async function finishIdentity(result: IdentityResult, signal: AbortSignal) {
    if (signal.aborted) return;
    if (result.kind === 'token') await authorize(result.value, signal);
    else if (result.kind === 'failed') setError(result.message);
    else setState(result);
  }

  async function perform(task: (signal: AbortSignal) => Promise<void>) {
    if (active.current || signingOut.current) return;
    active.current = true;
    const signal = beginOperation();
    setBusy(true);
    setError('');
    try {
      await task(signal);
    } catch {
      if (!signal.aborted) setError('The request could not be completed. Try again.');
    } finally {
      if (!signal.aborted) {
        active.current = false;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    const unsubscribe = identity?.listen((change) => {
      if (change.kind === 'signed-out') {
        const expired = credential.current !== null;
        operation.current.abort();
        credential.current = null;
        active.current = false;
        setBusy(false);
        setState({ kind: 'signed-out' });
        if (expired && !signingOut.current) setError('Your session ended. Sign in again.');
      } else if (credential.current && !active.current && !signingOut.current) {
        const signal = beginOperation();
        setError('');
        void authorize(change.token, signal).catch(() => {
          if (!signal.aborted) setState({ kind: 'unavailable' });
        });
      }
    });
    return () => {
      unsubscribe?.();
      operation.current.abort();
    };
  }, [apiBase, identity]);

  async function signOut() {
    if (signingOut.current) return;
    signingOut.current = true;
    operation.current.abort();
    credential.current = null;
    active.current = false;
    setState({ kind: 'signed-out' });
    setError('');
    setBusy(true);
    try {
      await identity?.signOut();
    } catch {
      setError('This console is locked. Identity-service sign-out could not be confirmed.');
    } finally {
      signingOut.current = false;
      setBusy(false);
    }
  }

  return {
    state,
    busy,
    error,
    signIn: (email: string, password: string) => identity
      ? perform(async (signal) => finishIdentity(await identity.signIn({ email, password }), signal))
      : Promise.resolve(),
    signInLocal: (token: string) => perform((signal) => authorize(token, signal)),
    verify: (factor: string, code: string) => identity
      ? perform(async (signal) => finishIdentity(await identity.verify(factor, code), signal))
      : Promise.resolve(),
    retryAccess: () => perform((signal) => credential.current ? authorize(credential.current, signal) : Promise.resolve()),
    signOut,
  };
}
