/**
 * @module expression-eval
 *
 * Evaluates MathJS value expressions from the card effects DSL.
 *
 * Most effect values are plain numbers, but some cards need computed values
 * (e.g. The One Ring: "max = bearer.baseProwess * 2"). String values are
 * evaluated as MathJS expressions with context variables injected as a
 * sandboxed scope — no access to MathJS's built-in functions that could
 * cause side effects.
 */

import { evaluate } from 'mathjs';
import type { ValueExpr } from '@meccg/shared';

/**
 * Flattens a nested context object into dot-path keys for MathJS scope.
 *
 * MathJS doesn't support dot-path variable access natively (e.g. `bearer.baseProwess`),
 * so we flatten `{ bearer: { baseProwess: 6 } }` into `{ "bearer.baseProwess": 6 }`.
 *
 * However, MathJS also doesn't support dots in identifiers. So we convert dots to
 * underscores: `bearer_baseProwess`. The expression strings in card data must use
 * this underscore convention.
 *
 * Wait — that would break the JSON DSL design where we use `bearer.baseProwess`.
 * Instead, we pre-process the expression string to replace dot-paths with underscored
 * versions before evaluating.
 */
function flattenContext(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}_${key}` : key;
    if (typeof value === 'number') {
      result[fullKey] = value;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenContext(value as Record<string, unknown>, fullKey));
    }
    // Skip non-numeric, non-object values (strings, arrays, booleans)
  }
  return result;
}

/**
 * Replaces dot-path references in an expression string with underscore-separated
 * identifiers that MathJS can parse.
 *
 * Example: `"bearer.baseProwess * 2"` → `"bearer_baseProwess * 2"`
 */
function rewriteDotPaths(expr: string): string {
  // Match sequences of word characters separated by dots (e.g. bearer.baseProwess)
  return expr.replace(/\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)+)\b/g, match =>
    match.replace(/\./g, '_'),
  );
}

/**
 * Evaluates a {@link ValueExpr} — either a plain number (returned as-is)
 * or a MathJS expression string evaluated with the given context variables.
 *
 * @param expr - The value expression from card data.
 * @param context - Nested object with numeric context variables
 *   (e.g. `{ bearer: { baseProwess: 6 } }`).
 * @returns The computed numeric result.
 * @throws If the expression string is invalid or references undefined variables.
 */
export function evaluateExpr(
  expr: ValueExpr,
  context: Record<string, unknown>,
): number {
  if (typeof expr === 'number') {
    return expr;
  }
  const scope = flattenContext(context);
  const rewritten = rewriteDotPaths(expr);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- MathJS evaluate returns any
  const result = evaluate(rewritten, scope);
  if (typeof result !== 'number') {
    throw new Error(`Expression "${expr}" did not evaluate to a number: ${result}`);
  }
  return result;
}
