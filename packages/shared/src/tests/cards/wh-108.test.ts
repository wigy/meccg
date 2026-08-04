/**
 * @module wh-108.test
 *
 * Card test: Truths of Doom (wh-108)
 * Type: minion-resource-event (Fallen-wizard stage resource permanent-event,
 *       Pallando-specific)
 *
 * Printed text:
 *   "Unique. Pallando specific. Your general influence is increased by 6 points.
 *    You may only use 2 of these 6 points to control characters."
 *
 * Card shape (data):
 *   - Unique, `alignment: "stage"`, `eventType: "permanent"`, MP 0 (category
 *     misc); carries the `pallando-specific` keyword.
 *   - effects:
 *     1. stage-points (4) — its printed stage value (MEWH §1).
 *     2. stat-modifier general-influence (value 6, controlLimit 2) — while the
 *        card is in play it adds 6 to the controller's general-influence pool,
 *        but only 2 of those points may control characters. The excess 4 is
 *        tracked as `generalInfluenceControlPenalty`: it still counts toward the
 *        player's *unused* general influence (defensive hazard subtraction) but
 *        can never enlarge the character-control budget (mirrors the
 *        Ringwraith / Balrog +5, CoE 1.12.R1 / 1.12.B1).
 *
 * "Unique" (a second copy cannot be played while one is in play) and "Pallando
 * specific" (playable only by a revealed-Pallando player) are enforced by the
 * generic permanent-event play machinery (the `pallando-specific` keyword +
 * `unique`), exercised below via the play-permanent-event legal action.
 *
 * The general-influence split is a rules change (CoE 9.1.5) that is alignment
 * independent — the same engine gate (`generalInfluenceControlLimit` in
 * `organization-characters.ts`) governs character play for every alignment — so
 * the character-control-cap and defensive-reserve behaviour is driven with a
 * plain hero company (simpler site handling), while the Pallando-specific and
 * derivation facets use the card's real Fallen-wizard (Pallando) fixture.
 *
 * All tests drive the recompute / legal-action pipeline; the card shape is
 * documented above rather than asserted against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  viableActions, viablePlayCharacterActions, addCardInPlay, recomputeDerived, dispatch,
  effectiveGeneralInfluence, generalInfluenceControlLimit,
  ARAGORN, GLORFINDEL_II, HALDIR, BEREGOND, KILI,
  ISENGARD, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Alignment,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const TRUTHS_OF_DOOM = 'wh-108' as CardDefinitionId; // the card under test
const PALLANDO_FW     = 'wh-7'  as CardDefinitionId; // Fallen-wizard avatar Pallando (GI 20)
const SARUMAN_FW      = 'wh-9'  as CardDefinitionId; // a different Fallen-wizard avatar

/** A Fallen-wizard (player 0) at Isengard with `avatar`, plus an idle opponent. */
function fwState(avatar: CardDefinitionId, hand: CardDefinitionId[] = []) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: [avatar] }],
        hand,
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
    ],
  });
}

describe('Truths of Doom (wh-108)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: +6 general influence, only 2 usable to control characters ──────

  test('in play, +6 to the pool but the character-control budget rises by only 2', () => {
    let state = fwState(PALLANDO_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, TRUTHS_OF_DOOM);
    state = recomputeDerived(state);
    const p = state.players[RESOURCE_PLAYER];

    // Full pool (Pallando's white-hand 20 + 6) — this is what the defensive
    // unused-GI subtraction consumes.
    expect(p.generalInfluenceBonus).toBe(6);
    expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(26);
    // Only 2 of the 6 may control characters; the other 4 are the penalty.
    expect(p.generalInfluenceControlPenalty).toBe(4);
    expect(generalInfluenceControlLimit(state, PLAYER_1)).toBe(22);
  });

  test('control: without Truths of Doom the pool and control budget are the base GI', () => {
    const state = fwState(PALLANDO_FW);
    const p = state.players[RESOURCE_PLAYER];

    expect(p.generalInfluenceBonus).toBe(0);
    expect(p.generalInfluenceControlPenalty).toBe(0);
    expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(20);
    expect(generalInfluenceControlLimit(state, PLAYER_1)).toBe(20);
  });

  // ─── Rule: only 2 of the 6 control characters (character-play gate) ───────
  //
  // A hero company already spends the full base pool (mind 9 + 8 + 3 = 20).
  // With Truths of Doom the control budget is 22, so exactly 2 more mind of
  // characters may be added under general influence — a mind-2 character fits,
  // a mind-3 character does not (proving the cap rose by 2, not by the full 6).
  // Meanwhile the *unused* general influence — what defends against an opponent's
  // influence attempt — reflects all 6 (26 − 20 = 6), not 2.

  /** Hero company at Rivendell whose members' mind totals exactly the base 20. */
  function heroMax20(hand: CardDefinitionId[]) {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, GLORFINDEL_II, HALDIR] }],
          hand,
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
  }

  test('with Truths of Doom, a mind-2 character fits under the control limit but a mind-3 overflows it', () => {
    let state = heroMax20([BEREGOND, KILI]); // BEREGOND mind 2, Kíli mind 3
    state = addCardInPlay(state, RESOURCE_PLAYER, TRUTHS_OF_DOOM);
    state = recomputeDerived(state);

    // Sanity: the company consumes the whole base pool; the +6/+2 split holds.
    expect(state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(20);
    expect(generalInfluenceControlLimit(state, PLAYER_1)).toBe(22);
    // Defensive reserve: all 6 remain unused for hazard subtraction.
    expect(effectiveGeneralInfluence(state, PLAYER_1)
      - state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(6);

    const beregondId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === BEREGOND)!.instanceId;
    const kiliId     = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === KILI)!.instanceId;
    const plays = viablePlayCharacterActions(state, PLAYER_1);

    // Both plays are legal — CoE 2.II.2.2.1 makes a GI play legal regardless
    // of whether it exceeds the control limit; the overflow settles at the
    // end of the organization phase (CoE 3.47).
    const beregondPlay = plays.find(a => a.characterInstanceId === beregondId && a.controlledBy === 'general');
    const kiliPlay = plays.find(a => a.characterInstanceId === kiliId && a.controlledBy === 'general');
    expect(beregondPlay).toBeDefined();
    expect(kiliPlay).toBeDefined();

    // Beregond (mind 2) exactly fills the +2 the card grants for control: no overflow.
    const withBeregond = dispatch(state, beregondPlay!);
    expect(withBeregond.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(22);

    // Kíli (mind 3) exceeds the +2 by 1 — the +6 gave only +2 for control, so
    // he pushes the pool one point past its limit.
    const withKili = dispatch(state, kiliPlay!);
    expect(withKili.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(23);
  });

  test('control: without Truths of Doom, the same mind-2 character overflows the pool when played under GI', () => {
    const state = heroMax20([BEREGOND]); // no Truths of Doom in play → control budget stays 20
    expect(state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(20);
    expect(generalInfluenceControlLimit(state, PLAYER_1)).toBe(20);

    const beregondId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === BEREGOND)!.instanceId;
    const plays = viablePlayCharacterActions(state, PLAYER_1);
    const beregondPlay = plays.find(a => a.characterInstanceId === beregondId && a.controlledBy === 'general');
    // The play is still legal (CoE 2.II.2.2.1) even with the pool exhausted…
    expect(beregondPlay).toBeDefined();
    // …but it overflows the control limit by his full mind, to be settled at
    // the end of the organization phase (CoE 3.47).
    const after = dispatch(state, beregondPlay!);
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(22);
  });

  // ─── Rule: Pallando specific ──────────────────────────────────────────────

  test('a revealed-Pallando player may play Truths of Doom', () => {
    const state = fwState(PALLANDO_FW, [TRUTHS_OF_DOOM]);
    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(1);
  });

  test('a non-Pallando Fallen-wizard may NOT play Truths of Doom (Pallando specific)', () => {
    const state = fwState(SARUMAN_FW, [TRUTHS_OF_DOOM]);
    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(0);
  });

  test('playable before Pallando is brought into play — the avatar still sits in the play deck (CoE 2.2.F2)', () => {
    // Regression (game mrriy0um-avfhh1, seq 60): the Fallen-wizard declared
    // Pallando but has not yet brought the avatar into play, so Pallando still
    // sits in the play deck rather than a company. Truths of Doom must remain
    // playable: only an *eliminated* avatar (in the removed-from-play pile)
    // blocks its avatar-specific Stage resources (CoE 2.2.F2) — merely being not
    // yet in play does not. The engine previously required the avatar to be in
    // play and wrongly marked the card unplayable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [HALDIR] }],
          hand: [TRUTHS_OF_DOOM],
          playDeck: [PALLANDO_FW],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(1);
  });

  // ─── Rule: Unique ─────────────────────────────────────────────────────────

  test('a second copy is not playable while one is already in play (unique)', () => {
    let state = fwState(PALLANDO_FW, [TRUTHS_OF_DOOM]);
    state = addCardInPlay(state, RESOURCE_PLAYER, TRUTHS_OF_DOOM);
    state = recomputeDerived(state);

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(0);
  });

  // ─── Card's own stage-point contribution (MEWH §1) ────────────────────────

  test('Truths of Doom contributes 4 stage points to its Fallen-wizard controller', () => {
    let state = fwState(PALLANDO_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, TRUTHS_OF_DOOM);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(4);
    // The stage card itself is worth 0 marshalling points.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });
});
