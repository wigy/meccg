/**
 * @module phases
 *
 * Phase ordering and legal action lookup tables for the MECCG engine.
 *
 * This module defines two key constants:
 *
 * - `PHASE_ORDER` -- The fixed sequence of phases within a single turn.
 *   After each phase completes, the engine advances to the next phase
 *   in this array. The CharacterDraft, FreeCouncil, and GameOver phases
 *   are intentionally excluded as they are not part of the normal turn cycle.
 *
 * - `LEGAL_ACTIONS_BY_PHASE` -- A lookup table mapping each phase to the
 *   action types that can legally be submitted during that phase. The engine
 *   uses this as a first-pass validation before checking action-specific
 *   preconditions (e.g. having the card in hand, legal target, etc.).
 */

import { Phase } from './state.js';
import type { GameAction } from './actions.js';

/**
 * The fixed sequence of phases within a single player turn.
 *
 * Each turn follows this order:
 * 1. **Untap** -- Refresh tapped cards, heal inverted (wounded) characters at havens.
 * 2. **Organization** -- Reorganize companies, recruit characters, plan movement.
 * 3. **Long-event** -- Remove old long events; new ones may take effect.
 * 4. **Movement/Hazard** -- Companies travel; opponent plays hazards.
 * 5. **Site** -- Resolve automatic attacks, play resources.
 * 6. **End-of-Turn** -- Draw/discard to hand size, optionally call Free Council.
 *
 * After End-of-Turn, the active player switches and the sequence repeats.
 * This array excludes Setup (pre-game), FreeCouncil, and GameOver
 * (endgame) since they are outside the normal turn loop.
 */
export const PHASE_ORDER: readonly Phase[] = [
  Phase.Untap,
  Phase.Organization,
  Phase.LongEvent,
  Phase.MovementHazard,
  Phase.Site,
  Phase.EndOfTurn,
];

/**
 * Maps each game phase to the action types that are legally submittable during it.
 *
 * This serves as the first validation gate: if an action type is not listed
 * for the current phase, the engine rejects it immediately. Further
 * context-specific validation (sufficient influence, card in hand, legal
 * target, etc.) is performed by the individual action handlers.
 *
 * Notable design decisions:
 * - **Untap and Long-event** only allow `'pass'` because the engine handles
 *   their effects automatically; the player just confirms advancement.
 * - **Movement/Hazard** includes both combat actions (`assign-strike`,
 *   `resolve-strike`, `support-strike`) and `corruption-check` since
 *   corruption checks can be called after defeating certain creatures.
 * - **Free Council** only allows `corruption-check` and `pass` because
 *   the endgame consists solely of final corruption checks before scoring.
 * - **GameOver** has no legal actions -- the game is finished.
 */
export const LEGAL_ACTIONS_BY_PHASE: Readonly<Record<Phase, readonly GameAction['type'][]>> = {
  [Phase.Setup]: [
    'draft-pick',
    'draft-stop',
    'assign-starting-item',
    'add-character-to-deck',
    'shuffle-play-deck',
    'select-starting-site',
    'place-character',
    'draw-cards',
    'roll-initiative',
    'pass',
  ],

  [Phase.Untap]: ['pass'],

  [Phase.Organization]: [
    'play-character',
    'play-permanent-event',
    'split-company',
    'merge-companies',
    'transfer-item',
    'plan-movement',
    'cancel-movement',
    'pass',
  ],

  [Phase.LongEvent]: ['pass'],

  [Phase.MovementHazard]: [
    'play-hazard',
    'assign-strike',
    'resolve-strike',
    'support-strike',
    'corruption-check',
    'pass',
  ],

  [Phase.Site]: [
    'play-hero-resource',
    'influence-attempt',
    'play-minor-item',
    'corruption-check',
    'pass',
  ],

  [Phase.EndOfTurn]: [
    'draw-cards',
    'discard-card',
    'call-free-council',
    'pass',
  ],

  [Phase.FreeCouncil]: [
    'corruption-check',
    'pass',
  ],

  [Phase.GameOver]: [],
};
