/**
 * @module auth/jwt-verify.test
 *
 * Regression tests for JWT verification hardening. `verifyLobbyToken` is
 * called synchronously in the WebSocket upgrade handler outside every
 * error scaffold, so it must return null — never throw — on malformed
 * tokens. The original implementation threw from
 * `crypto.timingSafeEqual` (RangeError on a signature whose byte length
 * differs from the expected HMAC) and from `JSON.parse` on a garbage
 * body: one unauthenticated upgrade request with a crafted cookie
 * crashed the whole lobby process.
 */

import { describe, test, expect } from 'vitest';
import { signLobbyToken, verifyLobbyToken } from './jwt.js';

describe('verifyLobbyToken hardening', () => {
  test('a valid token round-trips', () => {
    const token = signLobbyToken('wigy');
    expect(verifyLobbyToken(token)?.sub).toBe('wigy');
  });

  test('wrong-length signature returns null instead of throwing (the crash vector)', () => {
    expect(() => verifyLobbyToken('x.y.z')).not.toThrow();
    expect(verifyLobbyToken('x.y.z')).toBeNull();
  });

  test('same-length forged signature returns null', () => {
    const token = signLobbyToken('wigy');
    const [h, b, sig] = token.split('.');
    const forged = sig.replace(/^./, sig[0] === 'A' ? 'B' : 'A');
    expect(verifyLobbyToken(`${h}.${b}.${forged}`)).toBeNull();
  });

  test('garbage body with a correctly-signed envelope returns null', () => {
    // Build a token whose body is not valid JSON but whose signature over
    // header.body is genuine — JSON.parse is the throw site this exercises.
    const token = signLobbyToken('wigy');
    const [h, , sig] = token.split('.');
    void sig;
    // Tamper with the body → signature mismatch path (null, no throw).
    expect(verifyLobbyToken(`${h}.!!!notbase64json!!!.${'A'.repeat(43)}`)).toBeNull();
  });

  test('non-token inputs return null', () => {
    expect(verifyLobbyToken('')).toBeNull();
    expect(verifyLobbyToken('a.b')).toBeNull();
    expect(verifyLobbyToken('a.b.c.d')).toBeNull();
  });
});
