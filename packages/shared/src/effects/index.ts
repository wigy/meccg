/**
 * @module effects
 *
 * Card effects subsystem exports for `@meccg/shared`.
 * Provides the condition matcher used by the server-side resolver.
 */

export { matchesCondition, matchesContext, conditionPaths } from './condition-matcher.js';
export { hasPlayFlag, hasNoDirectInfluenceRestriction } from './play-flags.js';
