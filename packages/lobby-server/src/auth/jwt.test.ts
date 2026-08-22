/**
 * @module auth/jwt.test
 *
 * Regression tests for JWT verification, focused on the documented contract
 * "Returns null if invalid or expired" — a malformed token must never throw.
 */

import { describe, test, expect } from 'vitest';
import { signLobbyToken, verifyLobbyToken, signGameToken, verifyGameToken } from './jwt.js';

describe('JWT verification', () => {
  test('a valid lobby token round-trips', () => {
    const token = signLobbyToken('alice');
    const payload = verifyLobbyToken(token);
    expect(payload?.sub).toBe('alice');
  });

  test('a valid game token round-trips', () => {
    const token = signGameToken('bob', 'game-1');
    const payload = verifyGameToken(token);
    expect(payload?.sub).toBe('bob');
    expect(payload?.gid).toBe('game-1');
  });

  // Regression: crypto.timingSafeEqual throws RangeError when the two buffers
  // differ in length, and the signature segment is fully attacker-controlled.
  // An unguarded throw crashed the WS-upgrade handler and took down the lobby
  // process; verify() must return null instead.
  test('a token with a wrong-length signature segment returns null, not a throw', () => {
    expect(verifyLobbyToken('a.b.c')).toBeNull();
    expect(verifyGameToken('a.b.c')).toBeNull();
  });

  test('a token with a correct-length but wrong signature returns null', () => {
    const token = signLobbyToken('alice');
    const [header, body] = token.split('.');
    // A 43-char base64url string that is not the real HMAC.
    const wrongSig = 'A'.repeat(43);
    expect(verifyLobbyToken(`${header}.${body}.${wrongSig}`)).toBeNull();
  });

  test('assorted malformed tokens all return null without throwing', () => {
    for (const bad of ['', 'x', 'a.b', 'a.b.c.d', '..', '...', 'not a jwt at all']) {
      expect(verifyLobbyToken(bad)).toBeNull();
    }
  });

  test('a token whose body is not valid base64url JSON returns null', () => {
    const token = signLobbyToken('alice');
    const [header, , sig] = token.split('.');
    expect(verifyLobbyToken(`${header}.!!!notjson!!!.${sig}`)).toBeNull();
  });
});
