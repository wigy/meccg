/**
 * @module wh-96.test
 *
 * Card test: Await the Onset (wh-96)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event), alignment "stage"
 *
 * Printed text:
 *   "Gandalf specific. Playable if you are Gandalf and have at least: 12 stage
 *    points, two protected Wizardhavens [{H}], 4 factions, and 6 characters. Each
 *    faction you play after Await the Onset is worth 1 marshalling point
 *    regardless of other cards in play (place these factions under Await the
 *    Onset). Each of your marshalling point cards in a company not in one of your
 *    Wizardhavens [{H}] when the game ends is worth 1 marshalling point regardless
 *    of other cards in play. Cannot be duplicated."
 *
 * Card shape (data):
 *   - alignment "stage", eventType "permanent"; worth 5 marshalling points
 *     (miscellaneous, per the authoritative card DB WH-96) and 3 stage points.
 *     Keyword `gandalf-specific` (playable only while the player counts as
 *     Gandalf; enforced generically via `wizardSpecificName`).
 *   - effects:
 *     1. stage-points (value 3).
 *     2. play-condition `player-state` — playable only with ≥12 stage points, ≥2
 *        protected Wizardhavens, ≥4 factions, and ≥6 characters (the Gandalf gate
 *        is the `gandalf-specific` keyword).
 *     3. duplication-limit scope `game`, max 1 — "Cannot be duplicated".
 *
 * ⚠️ NOT CERTIFIED — the two marshalling-point clauses are exceptions to CoE rule
 *    10.F2 ("a Fallen-wizard does not receive marshalling points for resources
 *    stored at non-Wizardhaven sites"), which the engine does not model:
 *      - Factions in `cardsInPlay` carry no stored-location, so 10.F2 cannot be
 *        applied to them, and there is no "place under this card" tracking.
 *      - There is no end-of-game final-scoring pass distinct from the continuous
 *        MP total, which clause B ("when the game ends") requires.
 *    On the current everything-scores baseline both clauses are unobservable
 *    no-ops (a Fallen-wizard's cards already score 1 MP each via the §4 clamp),
 *    so they are left unimplemented pending an engine-architecture decision.
 *    These tests exercise only the self-contained, decision-independent rules
 *    (stage points, printed MP, play-restriction gating, duplication limit).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  viableActions, addCardInPlay, addCardToHand, recomputeDerived, protectSiteForPlayer,
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI,
  WOOD_ELVES, BLUE_MOUNTAIN_DWARVES, KNIGHTS_OF_DOL_AMROTH, MEN_OF_ANORIEN,
  RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const AWAIT_ONSET   = 'wh-96' as CardDefinitionId; // FW stage permanent-event under test
const GANDALF_FW    = 'wh-4'  as CardDefinitionId; // the Fallen-wizard avatar it's specific to
const ISENGARD_FW   = 'wh-56' as CardDefinitionId; // Fallen-wizard Wizardhaven
const WHITE_TOWERS  = 'wh-58' as CardDefinitionId; // Fallen-wizard Wizardhaven
const UNTIMELY_BROOD = 'wh-62' as CardDefinitionId; // stage-points 4 (non-unique)

const FOUR_FACTIONS = [WOOD_ELVES, BLUE_MOUNTAIN_DWARVES, KNIGHTS_OF_DOL_AMROTH, MEN_OF_ANORIEN];

describe('Await the Onset (wh-96)', () => {
  beforeEach(() => resetMint());

  // ─── Stage points ──────────────────────────────────────────────────────────

  test('contributes 3 stage points to its Fallen-wizard controller', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [GANDALF_FW] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, AWAIT_ONSET);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(3);
  });

  // ─── Printed marshalling points ─────────────────────────────────────────────

  test('scores 5 miscellaneous marshalling points for its Fallen-wizard controller (stage card, exempt from the §4 clamp)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [GANDALF_FW] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, AWAIT_ONSET);
    state = recomputeDerived(state);

    // Stage cards keep their full printed MP for a Fallen-wizard (not clamped to 1).
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(5);
  });

  // ─── Play-restriction: all conditions met ────────────────────────────────────

  test('playable from hand with 12 stage points, 2 protected Wizardhavens, 4 factions, and 6 characters', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: ISENGARD_FW, characters: [GANDALF_FW, ARAGORN, BILBO] },
            { site: WHITE_TOWERS, characters: [FRODO, LEGOLAS, GIMLI] },
          ],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // 3 × An Untimely Brood → 12 stage points.
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    // 4 factions in play.
    for (const f of FOUR_FACTIONS) state = addCardInPlay(state, RESOURCE_PLAYER, f);
    // Both Wizardhavens protected.
    state = protectSiteForPlayer(state, PLAYER_1, ISENGARD_FW, 'isen');
    state = protectSiteForPlayer(state, PLAYER_1, WHITE_TOWERS, 'towers');
    state = addCardToHand(state, RESOURCE_PLAYER, AWAIT_ONSET);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(12);

    const handId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === AWAIT_ONSET)!.instanceId;
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(1);
  });

  // ─── Play-restriction: only one protected Wizardhaven ────────────────────────

  test('not playable with only one protected Wizardhaven (needs two)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: ISENGARD_FW, characters: [GANDALF_FW, ARAGORN, BILBO] },
            { site: WHITE_TOWERS, characters: [FRODO, LEGOLAS, GIMLI] },
          ],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    for (const f of FOUR_FACTIONS) state = addCardInPlay(state, RESOURCE_PLAYER, f);
    // Only ONE Wizardhaven protected.
    state = protectSiteForPlayer(state, PLAYER_1, ISENGARD_FW, 'isen');
    state = addCardToHand(state, RESOURCE_PLAYER, AWAIT_ONSET);
    state = recomputeDerived(state);

    const handId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === AWAIT_ONSET)!.instanceId;
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);
  });

  // ─── Play-restriction: only five characters ──────────────────────────────────

  test('not playable with only five characters (needs six)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: ISENGARD_FW, characters: [GANDALF_FW, ARAGORN, BILBO] },
            { site: WHITE_TOWERS, characters: [FRODO, LEGOLAS] },
          ],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    for (const f of FOUR_FACTIONS) state = addCardInPlay(state, RESOURCE_PLAYER, f);
    state = protectSiteForPlayer(state, PLAYER_1, ISENGARD_FW, 'isen');
    state = protectSiteForPlayer(state, PLAYER_1, WHITE_TOWERS, 'towers');
    state = addCardToHand(state, RESOURCE_PLAYER, AWAIT_ONSET);
    state = recomputeDerived(state);

    // Five characters total across the two companies.
    expect(Object.keys(state.players[RESOURCE_PLAYER].characters)).toHaveLength(5);

    const handId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === AWAIT_ONSET)!.instanceId;
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);
  });

  // ─── Duplication limit ───────────────────────────────────────────────────────

  test('cannot be duplicated: a second copy is not playable while one is in play', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: ISENGARD_FW, characters: [GANDALF_FW, ARAGORN, BILBO] },
            { site: WHITE_TOWERS, characters: [FRODO, LEGOLAS, GIMLI] },
          ],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    for (const f of FOUR_FACTIONS) state = addCardInPlay(state, RESOURCE_PLAYER, f);
    state = protectSiteForPlayer(state, PLAYER_1, ISENGARD_FW, 'isen');
    state = protectSiteForPlayer(state, PLAYER_1, WHITE_TOWERS, 'towers');
    // One copy already in play + a second copy in hand.
    state = addCardInPlay(state, RESOURCE_PLAYER, AWAIT_ONSET);
    state = addCardToHand(state, RESOURCE_PLAYER, AWAIT_ONSET);
    state = recomputeDerived(state);

    const handId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === AWAIT_ONSET)!.instanceId;
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);
  });
});
