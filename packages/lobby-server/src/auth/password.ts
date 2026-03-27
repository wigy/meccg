/**
 * @module auth/password
 *
 * Password hashing using Node's built-in crypto module with scrypt.
 * No external dependencies required — scrypt is a memory-hard KDF
 * suitable for password storage.
 */

import * as crypto from 'crypto';

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS: crypto.ScryptOptions = { N: 16384, r: 8, p: 1 };

/** Hash a plaintext password. Returns a string of the form "salt:hash" (hex-encoded). */
export function hashPassword(plain: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LENGTH);
    crypto.scrypt(plain, salt, KEY_LENGTH, SCRYPT_OPTIONS, (err, derived) => {
      if (err) return reject(err);
      resolve(salt.toString('hex') + ':' + derived.toString('hex'));
    });
  });
}

/** Verify a plaintext password against a stored "salt:hash" string. */
export function verifyPassword(plain: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [saltHex, hashHex] = stored.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    crypto.scrypt(plain, salt, KEY_LENGTH, SCRYPT_OPTIONS, (err, derived) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(expected, derived));
    });
  });
}
