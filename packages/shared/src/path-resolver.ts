/**
 * @module path-resolver
 *
 * Shared dot-path resolution used by the condition matcher (to read values
 * out of a resolver context) and the rule-message template renderer (to fill
 * `{{path}}` placeholders). Centralizing it keeps the two subsystems using
 * exactly the same path semantics.
 */

/**
 * Resolves a dot-separated path (e.g. `"bearer.race"`) against a nested
 * object. Returns `undefined` if any segment along the path is missing.
 *
 * Supports `.length` on arrays so conditions can check collection size, e.g.
 * `{ "automaticAttacks.length": { "$gt": 0 } }`.
 */
export function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current) && seg === 'length') {
      current = current.length;
      continue;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}
