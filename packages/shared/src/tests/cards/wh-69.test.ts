/**
 * @module wh-69.test
 *
 * Card test: Fortress of the Towers (wh-69)
 * Type: minion-resource-event, alignment "stage" (Fallen-wizard stage
 * permanent-event), 3 stage points.
 *
 * Printed text:
 *   "Unique. May not be a starting stage card. Playable if you are Alatar,
 *    Pallando, or Saruman. Playable on The White Towers. The White Towers is
 *    protected. Other Fallen-wizards may not use the Wizardhaven [{H}] card for
 *    The White Towers. Cards that give marshalling points cannot be played at
 *    The White Towers by your opponent in all cases. Discard this card when the
 *    site is discarded or returned to its location deck."
 *
 * Rule-by-rule status (why this card is NOT certified):
 *   1. "Unique."                       — IMPLEMENTED. The org-phase / site-phase
 *      permanent-event play paths reject a second copy while one is in play
 *      (`countCopiesInPlay`, see organization-events.ts / site.ts).
 *   2. "3 stage points."               — IMPLEMENTED. The `stage-points` effect
 *      feeds `PlayerState.stagePoints` via `recomputeDerived` (MEWH §1). Tested
 *      below with real recompute-driven assertions.
 *   3. "The White Towers is protected."— NO MECHANICAL EFFECT. Per CRF-22 and
 *      CoE glossary the "protected" keyword "has no effect by itself" (it only
 *      denies the extra-region Wizardhaven movement bonus, which this site never
 *      grants). Nothing to implement.
 *   4. "Other Fallen-wizards may not use the Wizardhaven card …" — effectively a
 *      no-op in the engine's two-player model (a single Fallen-wizard per side).
 *
 *   The following printed rules are NOT yet supported by the engine, which is
 *   why this card is NOT certified:
 *   A. "May not be a starting stage card." — no starting-stage-card restriction
 *      exists for stage permanent-events.
 *   B. "Playable if you are Alatar, Pallando, or Saruman." — there is no
 *      avatar-restriction play-condition; any Fallen-wizard can currently play
 *      it.
 *   C. "Playable on The White Towers." — stage permanent-events are offered in
 *      the organization phase with no requirement that a specific Wizardhaven
 *      site be in play, so the card is not tied to The White Towers.
 *   D. "Cards that give marshalling points cannot be played at The White Towers
 *      by your opponent in all cases." — no opponent-MP-restriction-at-site
 *      mechanic (nor the CRF-22 influence-reveal interaction) exists.
 *   E. "Discard this card when the site is discarded or returned to its location
 *      deck." — no discard-on-site-removal trigger for stage cards exists.
 *
 * These tests drive the recompute / legal-action pipeline for the implemented
 * behaviour only; the card shape itself is documented above rather than asserted
 * against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import {
  buildTestState, resetMint, addCardInPlay, recomputeDerived,
  viableActions, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  RIVENDELL, MINAS_TIRITH, ARAGORN,
} from '../test-helpers.js';

const FORTRESS_OF_THE_TOWERS = 'wh-69' as CardDefinitionId; // 3-point stage permanent-event

/** Organization-phase state for player 0 with the given alignment. */
function buildOrg(alignment?: Alignment) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        ...(alignment ? { alignment } : {}),
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

describe('Fortress of the Towers (wh-69)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: 3 stage points (MEWH §1) ──────────────────────────────────────

  test('contributes 3 stage points to its Fallen-wizard controller', () => {
    const base = buildOrg(Alignment.FallenWizard);
    // Baseline: nothing in play → 0 stage points.
    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(0);

    // With Fortress of the Towers in play, the derived total rises by exactly 3.
    const withCard = recomputeDerived(
      addCardInPlay(base, RESOURCE_PLAYER, FORTRESS_OF_THE_TOWERS),
    );
    expect(withCard.players[RESOURCE_PLAYER].stagePoints).toBe(3);
  });

  test('stage points only accrue for a Fallen-wizard, not a hero/Wizard player', () => {
    // Default alignment is Wizard (hero). A non-Fallen-wizard never accrues
    // stage points even with a stage card sitting in cardsInPlay.
    const heroState = recomputeDerived(
      addCardInPlay(buildOrg(), RESOURCE_PLAYER, FORTRESS_OF_THE_TOWERS),
    );
    expect(heroState.players[RESOURCE_PLAYER].stagePoints).toBe(0);
  });

  // ─── Rule interaction: MEWH stage-resource discard floor (3-point value) ──

  test('cannot be discarded as a stage resource while it is the only stage card', () => {
    // MEWH "The Player Turn": a Fallen-wizard may discard an in-play stage
    // resource during organization, but not if it would drop the stage-point
    // total below 3. Fortress of the Towers is worth exactly 3, so discarding it
    // alone (3 → 0) is illegal: no discard-stage-resource action is offered.
    const state = recomputeDerived(
      addCardInPlay(buildOrg(Alignment.FallenWizard), RESOURCE_PLAYER, FORTRESS_OF_THE_TOWERS),
    );
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(3);
    expect(viableActions(state, PLAYER_1, 'discard-stage-resource')).toHaveLength(0);
  });
});
