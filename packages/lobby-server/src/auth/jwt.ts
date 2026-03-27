/**
 * @module auth/jwt
 *
 * JWT signing and verification for lobby sessions and game tokens.
 * Uses Node's built-in crypto module with HMAC-SHA256 — no external
 * JWT library needed for this simple use case.
 */

import * as crypto from 'crypto';
import { JWT_SECRET, LOBBY_TOKEN_EXPIRY, GAME_TOKEN_EXPIRY } from '../config.js';

/** Lobby session token payload. */
export interface LobbyTokenPayload {
  readonly sub: string;  // player name
  readonly iat: number;
  readonly exp: number;
}

/** Game join token payload. */
export interface GameTokenPayload {
  readonly sub: string;  // player name
  readonly gid: string;  // game ID
  readonly iat: number;
  readonly exp: number;
}

/** Parse a duration string like "7d" or "5m" into seconds. */
function parseDuration(s: string): number {
  const match = s.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration: ${s}`);
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default: throw new Error(`Invalid duration unit: ${match[2]}`);
  }
}

/** Base64url encode a buffer or string. */
function b64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

/** Sign a JWT with HMAC-SHA256. */
function sign(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

/** Verify and decode a JWT. Returns null if invalid or expired. */
function verify<T>(token: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/** Sign a lobby session token for the given player name. */
export function signLobbyToken(playerName: string): string {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: playerName, iat: now, exp: now + parseDuration(LOBBY_TOKEN_EXPIRY) });
}

/** Verify a lobby session token. Returns the payload or null. */
export function verifyLobbyToken(token: string): LobbyTokenPayload | null {
  return verify<LobbyTokenPayload>(token);
}

/** Sign a short-lived game join token. */
export function signGameToken(playerName: string, gameId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: playerName, gid: gameId, iat: now, exp: now + parseDuration(GAME_TOKEN_EXPIRY) });
}

/** Verify a game join token. Returns the payload or null. */
export function verifyGameToken(token: string): GameTokenPayload | null {
  return verify<GameTokenPayload>(token);
}
