import { HttpProblem, unauthorized } from '../../platform/http.ts';

export type AccountIdentity = {
  accountId: string;
  role: 'participant' | 'operator';
  assurance: 'aal1' | 'aal2';
  authenticatedAt?: number;
};

export type Actor = AccountIdentity & {token: string; signal: AbortSignal};

export type IdentityVerifier = (token: string, signal: AbortSignal) => Promise<AccountIdentity | undefined>;
export const participantRequired = () => new HttpProblem(403, 'participant_required', 'A participant session is required');

export async function authenticate(request: Request, verifier: IdentityVerifier): Promise<Actor> {
  const value = request.headers.get('authorization') ?? '';
  const token = value.length <= 8192 ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(value)?.[1] : undefined;
  if (!token) throw unauthorized();
  const identity = await verifier(token, request.signal);
  if (!identity) throw unauthorized();
  return {...identity, token, signal: request.signal};
}

export function requireParticipant(actor: Actor): void {
  if (actor.role !== 'participant') throw participantRequired();
}

export function requireOperator(actor: Actor): void {
  if (actor.role !== 'operator' || actor.assurance !== 'aal2') {
    throw new HttpProblem(403, 'operator_step_up_required', 'Operator access requires multi-factor authentication');
  }
}

// ID token renewal does not count as a new sign-in.
export function requireRecentAuthentication(actor: Actor, now = Math.floor(Date.now() / 1_000)): void {
  if (actor.authenticatedAt === undefined || !Number.isSafeInteger(actor.authenticatedAt) ||
      actor.authenticatedAt <= 0 || actor.authenticatedAt > now || now - actor.authenticatedAt >= 300) {
    throw new HttpProblem(403, 'recent_authentication_required', 'Confirm your identity again to continue');
  }
}
