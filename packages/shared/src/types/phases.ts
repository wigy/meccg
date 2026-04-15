/**
 * @module phases
 *
 * Phase ordering for the MECCG engine.
 *
 * `PHASE_ORDER` is the fixed sequence of phases within a single turn.
 * After each phase completes, the engine advances to the next phase in
 * this array. The CharacterDraft, FreeCouncil, and GameOver phases are
 * intentionally excluded as they are not part of the normal turn cycle.
 */

import { Phase } from './state.js';

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

