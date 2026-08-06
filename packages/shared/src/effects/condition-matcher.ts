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
import { resolvePath } from '../path-resolver.js';

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
const OPERATOR_KEYS = ['$includes', '$gt', '$gte', '$lt', '$lte', '$ne', '$in', '$exists', '$noConsecutiveOtherThan'] as const;

/** Type guard: is a match value an operator object like `{ $includes: "warrior" }`? */
function isOperator(v: unknown): v is ConditionOperator {
  if (typeof v !== 'object' || v === null) return false;
  return OPERATOR_KEYS.some(key => key in v);
}

/**
 * Resolves a comparison-operator operand. A number literal is used as-is; a
 * string is a context path resolved against the same context (e.g.
 * `{ "target.prowess": { "$lt": "bearer.prowess" } }` for Whip le-348
 * "prowess less than the bearer's"). Returns `undefined` when a path operand
 * does not resolve to a number — the comparison then fails.
 */
function resolveComparisonOperand(
  operand: number | string,
  context: Record<string, unknown>,
): number | undefined {
  if (typeof operand === 'number') return operand;
  const resolved = resolvePath(context, operand);
  return typeof resolved === 'number' ? resolved : undefined;
}

/**
 * Evaluates a single key-value pair from a {@link ConditionMatch} against the context.
 *
 * If the expected value is a plain literal (string/number/boolean), checks equality.
 * If it's an operator object (e.g. `{ $includes: "warrior" }`), applies the operator.
 * Comparison operands may themselves be context paths (see
 * {@link resolveComparisonOperand}), which is why the context is threaded in.
 */
function matchesEntry(
  contextValue: unknown,
  expected: string | number | boolean | null | ConditionOperator,
  context: Record<string, unknown>,
): boolean {
  if (isOperator(expected)) {
    if (expected.$includes !== undefined) {
      return Array.isArray(contextValue) && contextValue.includes(expected.$includes);
    }
    if (expected.$gt !== undefined) {
      const bound = resolveComparisonOperand(expected.$gt, context);
      return typeof contextValue === 'number' && bound !== undefined && contextValue > bound;
    }
    if (expected.$gte !== undefined) {
      const bound = resolveComparisonOperand(expected.$gte, context);
      return typeof contextValue === 'number' && bound !== undefined && contextValue >= bound;
    }
    if (expected.$lt !== undefined) {
      const bound = resolveComparisonOperand(expected.$lt, context);
      return typeof contextValue === 'number' && bound !== undefined && contextValue < bound;
    }
    if (expected.$lte !== undefined) {
      const bound = resolveComparisonOperand(expected.$lte, context);
      return typeof contextValue === 'number' && bound !== undefined && contextValue <= bound;
    }
    if (expected.$ne !== undefined) {
      if (Array.isArray(contextValue)) return !contextValue.includes(expected.$ne);
      return contextValue !== expected.$ne;
    }
    if (expected.$in !== undefined) {
      const allowed = expected.$in;
      if (Array.isArray(contextValue)) {
        return contextValue.some(v => allowed.includes(v as string | number));
      }
      return allowed.includes(contextValue as string | number);
    }
    if (expected.$exists !== undefined) {
      const present = contextValue !== undefined && contextValue !== null;
      return expected.$exists ? present : !present;
    }
    if (expected.$noConsecutiveOtherThan !== undefined) {
      if (!Array.isArray(contextValue)) return false;
      const target = expected.$noConsecutiveOtherThan;
      let prevOther = false;
      for (const el of contextValue) {
        if (el === target) {
          prevOther = false;
        } else {
          if (prevOther) return false;
          prevOther = true;
        }
      }
      return true;
    }
    return false;
  }
  // MongoDB-style: if the context value is an array and the expected value is
  // a scalar, check whether the array includes that value. This lets conditions
  // like `{ "inPlay": "Gates of Morning" }` match against an array of card names.
  if (Array.isArray(contextValue)) {
    return contextValue.includes(expected);
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
    if (!matchesEntry(contextValue, expected, context)) {
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

/**
 * Evaluates a DSL {@link Condition} against a strongly-typed context object.
 *
 * The condition language resolves dot-paths against a plain
 * `Record<string, unknown>`, but callers throughout the engine hold typed
 * context objects (resolver contexts, bearer contexts, attack contexts, …).
 * This helper accepts any such object and performs the structural cast at a
 * single boundary, so call sites don't repeat
 * `matchesCondition(cond, ctx as unknown as Record<string, unknown>)`.
 */
export function matchesContext(condition: Condition, context: object): boolean {
  return matchesCondition(condition, context as unknown as Record<string, unknown>);
}

/**
 * Collects every context path a condition tree reads, walking through
 * `$and`/`$or`/`$not` nodes.
 *
 * Comparison operands that are themselves paths (Whip le-348:
 * `{ "target.prowess": { "$lt": "bearer.prowess" } }`) are *not* included —
 * only the keys being tested. Callers use this to reason about *what a
 * condition depends on* rather than whether it currently matches; see
 * `conditionReadsAnyPath` in `engine/effects/resolver.ts`, which decides
 * whether an influence modifier is conditional on the check context or only on
 * its bearer.
 */
export function conditionPaths(condition: Condition): string[] {
  if (isAnd(condition)) return condition.$and.flatMap(conditionPaths);
  if (isOr(condition)) return condition.$or.flatMap(conditionPaths);
  if (isNot(condition)) return conditionPaths(condition.$not);
  return Object.keys(condition);
}
