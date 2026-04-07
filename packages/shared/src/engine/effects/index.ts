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
  resolveAttackProwess,
  resolveAttackStrikes,
  resolveCombatProwessBonus,
  resolveEnemyBody,
  normalizeCreatureRace,
  resolveDef,
} from './resolver.js';
export type { ResolverContext } from './resolver.js';
