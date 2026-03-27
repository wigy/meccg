/**
 * @module auth/session
 *
 * Cookie-based session management. The lobby session token is stored
 * in an HttpOnly cookie named "meccg-session". This module provides
 * helpers to read the token from incoming requests and set it on responses.
 */

import type * as http from 'http';
import { verifyLobbyToken, type LobbyTokenPayload } from './jwt.js';

const COOKIE_NAME = 'meccg-session';

/** Extract the session token from the request's cookies. Returns null if absent. */
export function getSessionToken(req: http.IncomingMessage): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const match = cookie.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : null;
}

/** Verify the session cookie and return the player name, or null if invalid. */
export function getSessionPlayer(req: http.IncomingMessage): string | null {
  const token = getSessionToken(req);
  if (!token) return null;
  const payload = verifyLobbyToken(token);
  return payload?.sub ?? null;
}

/** Set the session cookie on the response. */
export function setSessionCookie(res: http.ServerResponse, token: string): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${7 * 86400}`);
}

/** Clear the session cookie. */
export function clearSessionCookie(res: http.ServerResponse): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
}

/** Extract the lobby token payload from a cookie string (for WS upgrade). */
export function getPayloadFromCookie(cookie: string | undefined): LobbyTokenPayload | null {
  if (!cookie) return null;
  const match = cookie.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  return verifyLobbyToken(match.slice(COOKIE_NAME.length + 1));
}
