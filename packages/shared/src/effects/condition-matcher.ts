/**
 * @module condition-matcher
 *
 * Evaluates DSL conditions against a context object to determine whether
 * a card effect should apply in the current game situation.
 *
 * The condition language uses MongoDB-style operators:
 * - Plain objects with dot-path keys → implicit AND (all must match)
 * - `$and` → all sub-conditions must match
 * - `$or` → at least one sub-condition must match
 * - `$not` → the sub-condition must NOT match
 * - `$includes` → the context value (an array) must contain the element
 *
 * This module is pure TypeScript with no dependencies — the MathJS expression
 * evaluator lives in `@meccg/server` and is only needed for value expressions,
 * not conditions.
 */

import type {
  Condition,
  ConditionAnd,
  ConditionNot,
  ConditionOr,
  ConditionMatch,
  ConditionOperator,
} from '../types/effects.js';

/**
 * Resolves a dot-separated path (e.g. "bearer.race") against a nested object.
 * Returns `undefined` if any segment along the path is missing.
 */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/** Type guard: is this condition a `$and` node? */
function isAnd(c: Condition): c is ConditionAnd {
  return '$and' in c;
}

/** Type guard: is this condition a `$or` node? */
function isOr(c: Condition): c is ConditionOr {
  return '$or' in c;
}

/** Type guard: is this condition a `$not` node? */
function isNot(c: Condition): c is ConditionNot {
  return '$not' in c;
}

/** All recognized operator keys in a ConditionOperator. */
const OPERATOR_KEYS = ['$includes', '$gt', '$gte', '$lt', '$lte', '$ne', '$in'] as const;

/** Type guard: is a match value an operator object like `{ $includes: "warrior" }`? */
function isOperator(v: unknown): v is ConditionOperator {
  if (typeof v !== 'object' || v === null) return false;
  return OPERATOR_KEYS.some(key => key in v);
}

/**
 * Evaluates a single key-value pair from a {@link ConditionMatch} against the context.
 *
 * If the expected value is a plain literal (string/number/boolean), checks equality.
 * If it's an operator object (e.g. `{ $includes: "warrior" }`), applies the operator.
 */
function matchesEntry(
  contextValue: unknown,
  expected: string | number | boolean | null | ConditionOperator,
): boolean {
  if (isOperator(expected)) {
    if (expected.$includes !== undefined) {
      return Array.isArray(contextValue) && contextValue.includes(expected.$includes);
    }
    if (expected.$gt !== undefined) {
      return typeof contextValue === 'number' && contextValue > expected.$gt;
    }
    if (expected.$gte !== undefined) {
      return typeof contextValue === 'number' && contextValue >= expected.$gte;
    }
    if (expected.$lt !== undefined) {
      return typeof contextValue === 'number' && contextValue < expected.$lt;
    }
    if (expected.$lte !== undefined) {
      return typeof contextValue === 'number' && contextValue <= expected.$lte;
    }
    if (expected.$ne !== undefined) {
      return contextValue !== expected.$ne;
    }
    if (expected.$in !== undefined) {
      return expected.$in.includes(contextValue as string | number);
    }
    return false;
  }
  return contextValue === expected;
}

/**
 * Evaluates a {@link ConditionMatch} (plain object with dot-path keys) against the context.
 * All key-value pairs must match (implicit AND).
 */
function matchesPlainCondition(
  condition: ConditionMatch,
  context: Record<string, unknown>,
): boolean {
  for (const [key, expected] of Object.entries(condition)) {
    const contextValue = resolvePath(context, key);
    if (!matchesEntry(contextValue, expected)) {
      return false;
    }
  }
  return true;
}

/**
 * Evaluates a DSL {@link Condition} against a context object.
 *
 * @param condition - The condition to evaluate.
 * @param context - A flat or nested object with the current game situation
 *   (e.g. `{ reason: "combat", bearer: { race: "hobbit" }, enemy: { race: "orc" } }`).
 * @returns `true` if the condition is satisfied.
 */
export function matchesCondition(
  condition: Condition,
  context: Record<string, unknown>,
): boolean {
  if (isAnd(condition)) {
    return condition.$and.every(sub => matchesCondition(sub, context));
  }
  if (isOr(condition)) {
    return condition.$or.some(sub => matchesCondition(sub, context));
  }
  if (isNot(condition)) {
    return !matchesCondition(condition.$not, context);
  }
  // ConditionMatch — implicit AND over all keys
  return matchesPlainCondition(condition, context);
}
