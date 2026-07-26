/**
 * @module effects
 *
 * Card effects subsystem for the game engine.
 * Provides the resolver that evaluates card effects in context,
 * and the expression evaluator for MathJS value expressions.
 */

export { evaluateExpr } from './expression-eval.js';
export {
  buildBearerContext,
  buildInfluenceTargetContext,
  collectCharacterEffects,
  collectCompanyAllyEffects,
  collectGlobalEffects,
  collectPlayerInPlayEffects,
  resolveStatModifiers,
  resolveCheckModifier,
  resolveAutoInfluenceFaction,
  resolveDrawModifier,
  resolveAttackProwess,
  resolveAttackStrikes,
  resolveAttackBody,
  resolveCombatProwessBonus,
  resolveEnemyBody,
  resolveHandSize,
  normalizeCreatureRace,
  factionRaceToAttackType,
  resolveDef,
  getItemGrantedSkills,
  getEffectiveSkills,
} from './resolver.js';
export type { ResolverContext, CollectedEffect, CreatureSelfContext, CreatureAttackBoostContext } from './resolver.js';
export { applyWardToBearer, collectBearerWardFilters, isWardedAgainst } from './ward.js';
