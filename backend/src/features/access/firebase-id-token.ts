import {objectValue} from '@levelmaxing/contracts';
import {createRemoteJWKSet, customFetch, decodeProtectedHeader, errors, jwtVerify} from 'jose';
import {unavailable} from '../../platform/http.ts';
import type {AccountIdentity} from './access.ts';

const secureTokenKeys = new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
const projectIdPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const maxKeyCacheSeconds = 5 * 60;

type VerifiedFirebaseIdentity = {
  uid: string;
  assurance: AccountIdentity['assurance'];
  authenticatedAt: number;
};

function invalidCredential(error: unknown): boolean {
  return error instanceof errors.JWTClaimValidationFailed ||
    error instanceof errors.JWTExpired ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JOSEAlgNotAllowed ||
    error instanceof errors.JOSENotSupported ||
    error instanceof errors.JWKSNoMatchingKey;
}

export function createFirebaseTokenVerifier(projectId: string, fetchKeys: typeof fetch) {
  if (!projectIdPattern.test(projectId)) throw new Error('Set a valid FIREBASE_PROJECT_ID.');
  const issuer = 'https://securetoken.google.com/' + projectId;
  let upstreamExpiresAt = 0;
  const keys = createRemoteJWKSet(secureTokenKeys, {
    [customFetch]: async (input, init) => {
      const response = await fetchKeys(input, {...init, redirect: 'error'});
      if (response.status === 200) {
        const directives = response.headers.get('cache-control')?.split(',').map(value => value.trim().toLowerCase()) ?? [];
        const revalidate = directives.some(directive => directive.split('=', 1)[0]?.trim() === 'no-cache' || directive === 'no-store');
        const cacheSeconds = directives.map(directive => /^max-age\s*=\s*"?(\d+)"?$/.exec(directive))
          .find(match => match !== null)?.[1];
        const age = Number(response.headers.get('age') ?? 0);
        const maxAge = Number(cacheSeconds ?? maxKeyCacheSeconds);
        const ageSeconds = Number.isFinite(age) && age >= 0 ? age : 0;
        const seconds = revalidate ? 0 : Math.max(0, Math.min(maxKeyCacheSeconds, maxAge - ageSeconds));
        upstreamExpiresAt = Date.now() + seconds * 1_000;
      }
      return response;
    },
    timeoutDuration: 2_500,
    cooldownDuration: 30_000,
    cacheMaxAge: maxKeyCacheSeconds * 1_000,
  });

  return async function verify(token: string, signal: AbortSignal): Promise<VerifiedFirebaseIdentity | undefined> {
    if (signal.aborted) throw unavailable();
    let header;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      return;
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length === 0 || header.kid.length > 256) return;

    try {
      const {payload} = await jwtVerify(token, async (header, jws) => {
        if (keys.fresh && Date.now() >= upstreamExpiresAt) await keys.reload();
        return keys(header, jws);
      }, {
        algorithms: ['RS256'],
        audience: projectId,
        issuer,
        requiredClaims: ['sub', 'iat', 'exp', 'auth_time', 'firebase', 'role'],
        maxTokenAge: '1h',
      });
      if (signal.aborted) throw unavailable();
      const {sub: uid, aud, auth_time: authenticatedAt, iat: issuedAt, exp: expiresAt} = payload;
      const firebase = objectValue(payload.firebase);
      const provider = firebase?.sign_in_provider;
      const now = Math.floor(Date.now() / 1_000);
      if (!firebase || firebase.tenant !== undefined ||
          typeof provider !== 'string' || provider.length === 0 || provider === 'anonymous' || provider === 'custom' ||
          typeof uid !== 'string' || uid.length === 0 || [...uid].length > 128 || uid.includes('\u0000') ||
          aud !== projectId || payload.role !== 'authenticated' ||
          typeof authenticatedAt !== 'number' || !Number.isSafeInteger(authenticatedAt) || authenticatedAt <= 0 ||
          typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) || issuedAt <= 0 || issuedAt > now ||
          typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt ||
          authenticatedAt > issuedAt) return;
      return {uid, authenticatedAt, assurance: firebase.sign_in_second_factor === 'totp' ? 'aal2' : 'aal1'};
    } catch (error) {
      if (invalidCredential(error)) return;
      throw unavailable();
    }
  };
}
