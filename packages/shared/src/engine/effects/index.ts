/**
 * @module effects
 *
 * Card effects subsystem for the game engine.
 * Provides the resolver that evaluates card effects in context,
 * and the expression evaluator for MathJS value expressions.
 */

export { evaluateExpr } from './expression-eval.js';
export {
  collectEffects,
  collectCharacterEffects,
  collectGlobalEffects,
  resolveStatModifiers,
  resolveCheckModifier,
  resolveCompanyModifier,
  resolveDrawModifier,
  resolveAttackProwess,
  resolveAttackStrikes,
  resolveCombatProwessBonus,
  resolveEnemyBody,
  resolveHandSize,
  normalizeCreatureRace,
  resolveDef,
} from './resolver.js';
export type { ResolverContext, CollectedEffect, CreatureSelfContext } from './resolver.js';
