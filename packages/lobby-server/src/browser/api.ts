/**
 * @module api
 *
 * Minimal JSON helpers for the lobby REST API. They wrap `fetch` with the
 * uniform parse/error scaffolding that was previously repeated at every
 * call site (try/catch, `resp.ok` check, `data.error` extraction).
 */

/**
 * Result of a JSON API call. On failure, `error` is the server-provided
 * message when the response body carried one, `'Connection error'` when the
 * request never completed, and undefined otherwise — callers supply their
 * own context-specific fallback (e.g. `r.error ?? 'Login failed'`).
 *
 * On success, `data` is the parsed JSON body; for endpoints that respond
 * with an empty or non-JSON body it is undefined at runtime, so only read
 * it for JSON endpoints.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; data?: undefined; error?: string };

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const resp = await fetch(url, init);
    if (!resp.ok) {
      const data = await resp.json().catch(() => undefined) as { error?: string } | undefined;
      return { ok: false, error: data?.error };
    }
    const data = await resp.json().catch(() => undefined) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Connection error' };
  }
}

/** GET a JSON endpoint. */
export function apiGet<T>(url: string): Promise<ApiResult<T>> {
  return request<T>(url);
}

/**
 * Send a mutating request. When `body` is given it is JSON-encoded and the
 * Content-Type header is set accordingly.
 */
export function apiSend<T = unknown>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<ApiResult<T>> {
  return request<T>(url, {
    method,
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
}
