/**
 * @module action-id
 *
 * Stable canonical identifier for game actions. The server uses these ids
 * to store the set of currently-legal actions per player and validates
 * incoming actions by membership lookup rather than structural checks.
 *
 * The canonical form sorts object keys recursively and drops `undefined`
 * fields so two semantically identical actions produce identical ids
 * regardless of field construction order.
 */

import type { GameAction } from '../types/actions.js';
import type { EvaluatedAction } from '../rules/types.js';

function canonicalize(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    const val = (v as Record<string, unknown>)[k];
    if (val === undefined) continue;
    out[k] = canonicalize(val);
  }
  return out;
}

/**
 * Returns a stable canonical id for the given action. Two actions with
 * identical semantics produce the same id regardless of field ordering.
 * The id is a canonical JSON string — deterministic on any JS runtime,
 * so both server and client can derive it independently.
 */
export function canonicalActionKey(action: GameAction): string {
  return JSON.stringify(canonicalize(action));
}

/**
 * Stamps each evaluated action with its canonical actionId so clients
 * can echo the id back when submitting the action.
 */
export function stampActionIds(evaluated: readonly EvaluatedAction[]): EvaluatedAction[] {
  return evaluated.map(ea => ({ ...ea, actionId: canonicalActionKey(ea.action) }));
}
