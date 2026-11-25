export type Factor = { id: string; label: string };
export type IdentityResult =
  | { kind: 'token'; value: string }
  | { kind: 'challenge'; factors: Factor[] }
  | { kind: 'enrollment-required' }
  | { kind: 'failed'; message: string };

type Credentials = { email: string; password: string };
type IdentityChange = { kind: 'refreshed'; token: string } | { kind: 'signed-out' };

export type OperatorIdentity = {
  signIn(credentials: Credentials): Promise<IdentityResult>;
  verify(factorId: string, code: string): Promise<IdentityResult>;
  signOut(): Promise<void>;
  listen(listener: (change: IdentityChange) => void): () => void;
};

type IdentitySession = {
  getIdTokenResult(): Promise<{ token: string; signInSecondFactor: string | null }>;
};

type TotpChallenge = {
  kind: 'challenge';
  factors: Factor[];
  resolve(factorId: string, code: string): Promise<IdentitySession>;
};

type IdentityGateway = {
  signIn(credentials: Credentials): Promise<{ kind: 'session'; session: IdentitySession } | TotpChallenge>;
  signOut(): Promise<void>;
  observe(listener: (session: IdentitySession | null) => void): () => void;
};

const unsuccessfulSignIn = 'Sign-in failed. Check your credentials and try again.';
const unsuccessfulVerification = 'Verification failed. Enter a current authenticator code.';

function failed(message: string): IdentityResult {
  return { kind: 'failed', message };
}

export function createOperatorIdentity(gateway: IdentityGateway): OperatorIdentity {
  let challenge: TotpChallenge | null = null;
  let activeToken: string | null = null;
  let pending: Promise<IdentityResult> | null = null;
  let generation = 0;

  function run(task: (epoch: number) => Promise<IdentityResult>, message: string): Promise<IdentityResult> {
    if (pending) return Promise.resolve(failed(message));
    const epoch = generation;
    const result = task(epoch).catch(() => failed(message)).finally(() => { pending = null; });
    pending = result;
    return result;
  }

  async function assess(session: IdentitySession, epoch: number): Promise<IdentityResult> {
    const id = await session.getIdTokenResult();
    if (epoch !== generation) return failed('Sign-in was cancelled.');
    if (id.signInSecondFactor !== 'totp') return { kind: 'enrollment-required' };
    activeToken = id.token;
    challenge = null;
    return { kind: 'token', value: id.token };
  }

  return {
    signIn: (credentials) => run(async (epoch) => {
      challenge = null;
      activeToken = null;
      const result = await gateway.signIn(credentials);
      if (epoch !== generation) return failed('Sign-in was cancelled.');
      if (result.kind === 'session') return assess(result.session, epoch);
      if (result.factors.length === 0) return { kind: 'enrollment-required' };
      challenge = result;
      return { kind: 'challenge', factors: result.factors };
    }, unsuccessfulSignIn),

    verify: (factorId, code) => run(async (epoch) => {
      const current = challenge;
      if (!current?.factors.some((factor) => factor.id === factorId) || !/^\d{6}$/.test(code)) {
        return failed(unsuccessfulVerification);
      }
      return assess(await current.resolve(factorId, code), epoch);
    }, unsuccessfulVerification),

    async signOut() {
      generation += 1;
      challenge = null;
      activeToken = null;
      // The SDK cannot cancel an in-flight assertion. Clear its session after that assertion settles.
      await pending;
      await gateway.signOut();
    },

    listen(listener) {
      let observation = 0;
      const stop = gateway.observe((session) => {
        const current = ++observation;
        if (!activeToken) return;
        if (!session) {
          activeToken = null;
          listener({ kind: 'signed-out' });
          return;
        }
        const epoch = generation;
        void session.getIdTokenResult().then((id) => {
          if (current !== observation || epoch !== generation || !activeToken) return;
          if (id.signInSecondFactor !== 'totp') {
            activeToken = null;
            listener({ kind: 'signed-out' });
          } else if (id.token !== activeToken) {
            activeToken = id.token;
            listener({ kind: 'refreshed', token: id.token });
          }
        }, () => {
          if (current !== observation || epoch !== generation || !activeToken) return;
          activeToken = null;
          listener({ kind: 'signed-out' });
        });
      });
      return () => { observation += 1; stop(); };
    },
  };
}
