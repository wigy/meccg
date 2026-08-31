/**
 * @module button-classification
 *
 * Centralizes the "which fixed slot does this action's button belong in"
 * rule for the visual game view's action-button stack (`#visual-panel`).
 * Presentation-only concern — deliberately not a field on the shared
 * `GameAction`/`EvaluatedAction` types, since button placement is not a
 * rules concept.
 *
 * Feature request: players kept clicking the wrong button because the same
 * screen slot held a different *kind* of action from one turn to the next.
 * `render-instructions.ts` now renders into three always-present containers
 * (`#tier-special`, `#tier-in-phase-pass`, `#tier-end-of-phase`) so a given
 * tier consistently means the same thing turn over turn.
 */

import type { GameAction } from '@meccg/shared';

/**
 * - `end-of-phase` — advances to the next phase/step (bottom tier, the
 *   primary `#pass-btn`).
 * - `in-phase-pass` — resolves the current decision without advancing the
 *   phase (middle tier).
 * - `special` — optional actions granted by cards in play, reachable today
 *   only via portrait click (top tier).
 */
export type ButtonTier = 'special' | 'in-phase-pass' | 'end-of-phase';

/**
 * Action types that end the current phase/step when taken. Mirrors the
 * whitelist `renderPassButton` uses to pick its primary bottom-tier button.
 * `corruption-check` is included here even though it also requires the
 * caller to additionally check for singularity (several eligible characters
 * must be chosen by portrait click, not auto-picked) — that multiplicity
 * rule is a separate concern from its tier.
 */
const END_OF_PHASE_TYPES: ReadonlySet<GameAction['type']> = new Set([
  'pass', 'draft-stop', 'shuffle-play-deck', 'draw-cards', 'roll-initiative',
  'corruption-check', 'faction-influence-roll', 'under-deeps-roll',
  'pass-chain-priority', 'deck-exhaust', 'finished', 'untap',
  'opponent-influence-defend', 'resolve-dice-check', 'flattery-attempt',
  'seized-by-terror-roll', 'gold-ring-test-roll',
]);

/** Action types offered by granted card abilities, surfaced in the top tier. */
const SPECIAL_TYPES: ReadonlySet<GameAction['type']> = new Set(['activate-granted-action']);

/** Classify an action type into the tier its button belongs in. */
export function classifyActionKind(type: GameAction['type']): ButtonTier {
  if (END_OF_PHASE_TYPES.has(type)) return 'end-of-phase';
  if (SPECIAL_TYPES.has(type)) return 'special';
  return 'in-phase-pass';
}
