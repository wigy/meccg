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
 *     4. nonhaven-company-mp-pin (value 1) — clause B below.
 *     5. played-after-faction-mp-pin (value 1) — clause A below.
 *
 * Clause A ("Each faction you play after Await the Onset is worth 1 marshalling
 * point regardless of other cards in play … place these factions under Await the
 * Onset") is a per-instance **pin-to-1 tag**: a faction influenced into play while
 * this card is in play is stamped `mpPinned: 1` on its `CardInPlay` (in the
 * faction-influence reducer), and pinned factions score exactly 1 regardless of any
 * faction-MP booster (Gatherer of Loyalties wh-70, Pallando wh-7, Give Welcome
 * wh-99). Factions played *before* keep their normal value. A Fallen-wizard never
 * stores factions at a site, so no location is tracked — the tag alone distinguishes
 * "played after".
 *
 * Clause B ("Each of your marshalling point cards in a company not in one of your
 * Wizardhavens [{H}] when the game ends is worth 1 marshalling point regardless of
 * other cards in play") is a **pin-to-1 override**: every MP card (character, its
 * items, its allies) held by a company whose current site is not a Wizardhaven for
 * the player scores exactly 1, overriding all other MP rules (§4 clamp, Great Patron
 * wh-72, the `*-mp-full` exemptions, Give Welcome wh-99). "When the game ends" is
 * modelled as a continuous override — the engine keeps no separate end-of-game
 * scoring pass.
 *
 * For a Fallen-wizard both clauses are normally no-ops (the §4 clamp already values
 * each card at 1), so the tests exercise them against cards another effect has
 * boosted above 1.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  viableActions, addCardInPlay, addCardToHand, recomputeDerived, protectSiteForPlayer,
  attachItemToChar, attachAllyToChar, dispatch, resolveChain, makeSitePhase,
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, TREEBEARD,
  WOOD_ELVES, BLUE_MOUNTAIN_DWARVES, KNIGHTS_OF_DOL_AMROTH, MEN_OF_ANORIEN,
  RIVENDELL, LORIEN, MORIA, THRANDUILS_HALLS,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId } from '../../index.js';
import type { InfluenceAttemptAction } from '../../types/actions-site.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const AWAIT_ONSET   = 'wh-96' as CardDefinitionId; // FW stage permanent-event under test
const GANDALF_FW    = 'wh-4'  as CardDefinitionId; // the Fallen-wizard avatar it's specific to
const ISENGARD_FW   = 'wh-56' as CardDefinitionId; // Fallen-wizard Wizardhaven
const WHITE_TOWERS  = 'wh-58' as CardDefinitionId; // Fallen-wizard Wizardhaven
const UNTIMELY_BROOD = 'wh-62' as CardDefinitionId; // stage-points 4 (non-unique)
const GREAT_PATRON  = 'wh-72' as CardDefinitionId; // FW chars/allies >= 2 MP each score 2
const GIVE_WELCOME  = 'wh-99' as CardDefinitionId; // FW unique non-char cards worth 1 score 2
const GATHERER_OF_LOYALTIES = 'wh-70' as CardDefinitionId; // unique factions each worth 2
const THORIN        = 'tw-183' as CardDefinitionId; // hero character, 3 printed MP
const BOOK_OF_MAZARBUL = 'tw-201' as CardDefinitionId; // unique hero item, 1 printed MP

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

  // ─── Clause B: pin company-held MP cards outside a Wizardhaven to 1 ───────────

  test('pins a Great-Patron-boosted character to 1 in a non-Wizardhaven company, but leaves it boosted at a Wizardhaven', () => {
    // Two companies: one at Moria (a Ruins & Lairs — not a Wizardhaven), one at
    // Isengard (a Fallen-wizard Wizardhaven). Each holds a 3-MP character.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: MORIA, characters: [ARAGORN] },       // outside a Wizardhaven
            { site: ISENGARD_FW, characters: [THORIN] },  // at a Wizardhaven
          ],
          hand: [],
          siteDeck: [LORIEN],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // Great Patron: a Fallen-wizard's characters worth >= 2 MP each score 2
    // (overriding the §4 1-MP clamp). Both Aragorn and Thorin are 3-MP → 2 each.
    state = addCardInPlay(state, RESOURCE_PLAYER, GREAT_PATRON);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(4); // 2 + 2

    // Await the Onset in play: the character in the non-Wizardhaven company is
    // pinned to 1 "regardless of other cards in play"; the one at Isengard keeps
    // its Great Patron value of 2.
    state = addCardInPlay(state, RESOURCE_PLAYER, AWAIT_ONSET);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(3); // 1 (pinned) + 2
  });

  test('pins a Great-Patron-boosted company-held ally to 1 outside a Wizardhaven', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [LORIEN],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // Treebeard: a 2-MP hero ally, boosted to 2 by Great Patron (else §4-clamped to 1).
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, TREEBEARD);
    state = addCardInPlay(state, RESOURCE_PLAYER, GREAT_PATRON);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(2);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(2); // Aragorn 3-MP → 2

    state = addCardInPlay(state, RESOURCE_PLAYER, AWAIT_ONSET);
    state = recomputeDerived(state);
    // Both the ally and its bearer are pinned to 1 (company is not at a Wizardhaven).
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(1);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(1);
  });

  test('pins a Give-Welcome-boosted company-held item to 1 outside a Wizardhaven', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [LORIEN],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // Book of Mazarbul: a unique 1-MP item, re-valued to 2 by Give Welcome to the
    // Unexpected (wh-99, "your unique non-character cards worth 1 MP are worth 2").
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, BOOK_OF_MAZARBUL);
    state = addCardInPlay(state, RESOURCE_PLAYER, GIVE_WELCOME);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);

    state = addCardInPlay(state, RESOURCE_PLAYER, AWAIT_ONSET);
    state = recomputeDerived(state);
    // The item is pinned to 1 (company is not at a Wizardhaven), overriding wh-99.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  // ─── Clause A: factions played after are pinned to 1, "placed under" the card ─

  test('a faction stamped as played-after scores its pinned value, overriding a faction-MP booster; a faction played before keeps the boost', () => {
    // Gatherer of Loyalties (wh-70): each unique faction is worth 2 MP. One faction
    // is tagged `mpPinned: 1` (played after Await the Onset — "placed under" it),
    // the other is not (played before), so it keeps the Gatherer boost.
    const playedAfter: CardInPlay = {
      instanceId: 'wood-1' as CardInstanceId, definitionId: WOOD_ELVES,
      status: CardStatus.Untapped, mpPinned: 1,
    };
    const playedBefore: CardInPlay = {
      instanceId: 'kda-1' as CardInstanceId, definitionId: KNIGHTS_OF_DOL_AMROTH,
      status: CardStatus.Untapped,
    };
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
          cardsInPlay: [playedAfter, playedBefore],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, GATHERER_OF_LOYALTIES);
    state = addCardInPlay(state, RESOURCE_PLAYER, AWAIT_ONSET);
    state = recomputeDerived(state);
    // Wood-elves pinned to 1; Knights of Dol Amroth boosted to 2 by Gatherer.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(3); // 1 + 2
  });

  test('influencing a faction into play while Await the Onset is in play stamps it mpPinned = 1', () => {
    // Full engine drive: a Fallen-wizard company at Thranduil's Halls influences
    // Wood-elves (a unique 3-MP hero faction) into play while both Await the Onset
    // and Gatherer of Loyalties (unique factions worth 2) are already in play.
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: THRANDUILS_HALLS, characters: [GANDALF_FW] }],
          hand: [WOOD_ELVES],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    base = addCardInPlay(base, RESOURCE_PLAYER, AWAIT_ONSET);
    base = addCardInPlay(base, RESOURCE_PLAYER, GATHERER_OF_LOYALTIES);
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const attempt = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.factionInstanceId === factionInstanceId);
    expect(attempt).toBeDefined();

    const afterChain = resolveChain(dispatch(state, attempt!));
    const rollAction = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const resolved = dispatch({ ...afterChain, cheatRollTotal: 12 }, rollAction);

    const faction = resolved.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === factionInstanceId);
    expect(faction).toBeDefined();
    expect(faction!.mpPinned).toBe(1);

    // And it scores 1 MP — pinned, overriding the Gatherer of Loyalties boost.
    const scored = recomputeDerived(resolved);
    expect(scored.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });
});
