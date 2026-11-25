import { isEpoch, isRevision, isPositiveInt, MAX_CURSOR_CHARS, objectValue } from '@levelmaxing/contracts';
import { cursorExpired } from '../../platform/http.ts';

export type CursorState = {epoch: string; after: string; highWater?: string};

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});
const ttlMs = 30 * 24 * 60 * 60 * 1000;

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
}

export function createCursorCodec(secret: string, now: () => number = Date.now) {
  if (encoder.encode(secret).byteLength < 32) throw new Error('LEVELMAXING_CURSOR_SECRET must be at least 32 bytes.');
  let keyPromise: Promise<CryptoKey> | undefined;
  const key = () => keyPromise ??= crypto.subtle.importKey(
    'raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify'],
  );
  const signedBytes = (accountId: string, body: string) => encoder.encode('levelmaxing-sync-v1\n' + accountId + '\n' + body);

  return {
    async encode(accountId: string, value: CursorState): Promise<string> {
      const body = encode(encoder.encode(JSON.stringify({...value, expiresAt: now() + ttlMs})));
      const sig = await crypto.subtle.sign('HMAC', await key(), signedBytes(accountId, body));
      return body + '.' + encode(new Uint8Array(sig));
    },
    async decode(accountId: string, encoded: string): Promise<CursorState> {
      if (encoded.length > MAX_CURSOR_CHARS || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(encoded)) throw cursorExpired();
      try {
        const [body, signature] = encoded.split('.') as [string, string];
        const bytes = decode(signature);
        if (encode(bytes) !== signature || !await crypto.subtle.verify('HMAC', await key(), bytes, signedBytes(accountId, body))) {
          throw cursorExpired();
        }
        const data = objectValue(JSON.parse(decoder.decode(decode(body))));
        if (!data || !isEpoch(data.epoch) || !isRevision(data.after) || !isPositiveInt(data.expiresAt) || data.expiresAt <= now()) {
          throw cursorExpired();
        }
        if (data.highWater !== undefined && (!isRevision(data.highWater) || BigInt(data.highWater) <= BigInt(data.after))) {
          throw cursorExpired();
        }
        return {epoch: data.epoch, after: data.after, ...(data.highWater === undefined ? {} : {highWater: data.highWater})};
      } catch {
        throw cursorExpired();
      }
    },
  };
}

export type CursorCodec = ReturnType<typeof createCursorCodec>;
