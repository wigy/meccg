/**
 * @module rules
 *
 * Rules engine exports for `@meccg/shared`.
 * Provides the evaluator, template renderer, and types for declarative
 * constraint evaluation during setup phases and beyond.
 */

export { evaluateRules, evaluateAction } from './evaluator.js';
export { renderTemplate } from './template.js';
export type { Rule, RuleSet, EvaluatedAction } from './types.js';
export { CHARACTER_DRAFT_RULES } from './definitions/character-draft.js';
export { CHARACTER_DECK_DRAFT_RULES } from './definitions/character-deck-draft.js';
export { SITE_SELECTION_RULES } from './definitions/starting-site-selection.js';
export { ITEM_DRAFT_RULES, MAX_STARTING_ITEMS } from './definitions/item-draft.js';
