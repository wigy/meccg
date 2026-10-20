/**
 * @module auth/password-reset-token.test
 *
 * Password-reset tokens: they carry the player name and a fingerprint of the
 * password hash they were issued against, and are never accepted as a lobby
 * session token.
 */

import { describe, test, expect } from 'vitest';
import { signPasswordResetToken, verifyPasswordResetToken, passwordFingerprint, signLobbyToken, verifyLobbyToken } from './jwt.js';

describe('password-reset tokens', () => {
  test('a reset token round-trips with the fingerprint of the hash it was issued for', () => {
    const payload = verifyPasswordResetToken(signPasswordResetToken('alice', 'salt:hash-1'));
    expect(payload?.sub).toBe('alice');
    expect(payload?.pwd).toBe(passwordFingerprint('salt:hash-1'));
  });

  // The route rejects a token whose fingerprint differs from the current
  // hash, which is what makes each link single-use.
  test('a changed password hash has a different fingerprint', () => {
    const payload = verifyPasswordResetToken(signPasswordResetToken('alice', 'salt:hash-1'));
    expect(payload?.pwd).not.toBe(passwordFingerprint('salt:hash-2'));
  });

  test('a reset token is not a valid lobby session token', () => {
    expect(verifyLobbyToken(signPasswordResetToken('alice', 'salt:hash-1'))).toBeNull();
  });

  test('a lobby session token is not a valid reset token', () => {
    expect(verifyPasswordResetToken(signLobbyToken('alice'))).toBeNull();
  });
});
