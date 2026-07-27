/**
 * @module le-293.test
 *
 * Card test: Wargs of the Forochel (le-293)
 * Type: minion-resource-faction (wolf, unique, 3 MP, influence # 11, in-play # 0)
 *
 * "Unique. Playable at Lossadan Cairn if the influence check is greater than 10.
 *  Once in play, the number required to influence this faction is 0. Standard
 *  Modifications: Ice-orcs (+2), Misty Mountain Wargs (+2)."
 *
 * Rule-by-rule interpretation:
 *  - "Unique" → `unique: true`. Beyond the deck-building limit this also gates
 *    influencing: the engine's name-based in-play uniqueness check
 *    (`countCopiesInPlay`, scanning both players) refuses the attempt while any
 *    copy of the faction is already in play.
 *  - "Playable at Lossadan Cairn … greater than 10" → `playableAt.site`
 *    (minion Lossadan Cairn, le-388) plus the printed influence # of 11 (a
 *    check strictly greater than 10 succeeds). `need = influenceNumber(11) -
 *    modifiers`.
 *  - "Once in play, the number required to influence this faction is 0" →
 *    `inPlayInfluenceNumber: 0` (CoE rule 8.3): an opponent re-influencing this
 *    faction at Lossadan Cairn compares against 0, not the printed 11.
 *  - "Standard Modifications: Ice-orcs (+2), Misty Mountain Wargs (+2)" → two
 *    `check-modifier` effects on the influence check, each gated on the
 *    *controller* having the named faction in play (`controller.inPlay`), so the
 *    bonus applies only to the influencing player's own factions — never the
 *    opponent's copies. Same shape as the certified sibling Variags of Khand
 *    (le-292).
 *
 * Engine support table:
 * | # | Rule                                                     | Status      | Notes                                   |
 * |---|----------------------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Playable only at Lossadan Cairn                          | IMPLEMENTED | `playableAt.site` match in site.ts      |
 * | 2 | Influence # 11 (greater than 10)                         | IMPLEMENTED | shared faction-influence machinery      |
 * | 3 | Unique: cannot be influenced while a copy is in play     | IMPLEMENTED | name-based `countCopiesInPlay`          |
 * | 4 | +2 influence check when controller has Ice-orcs          | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 5 | +2 influence check when controller has M.M. Wargs        | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 6 | Modifiers do NOT apply if only the opponent has them     | IMPLEMENTED | `controller.inPlay` is per-player       |
 * | 7 | Opponent re-influence while in play (value = 0)          | IMPLEMENTED | `inPlayInfluenceNumber` (CoE rule 8.3)  |
 *
 * Playable: YES
 *
 * Fixtures:
 *   CIRYAHER (le-6)             — minion dúnadan, DI 2, no effects
 *   LAGDUF (le-18)              — minion orc, DI 0, no effects (opponent filler)
 *   ICE_ORCS (le-270)           — faction named in the first +2 standard modification
 *   MISTY_MOUNTAIN_WARGS (le-272) — faction named in the second +2 standard modification
 *   LOSSADAN_CAIRN (le-388)     — minion ruins-and-lairs (the only playable site)
 *   GOBLIN_GATE (le-378)        — minion shadow-hold (a different site, negative test)
 *   CARN_DUM (le-359)           — minion haven (site-deck filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase, addCardInPlay,
  firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId,
} from '../../index.js';

const WARGS_OF_FOROCHEL = 'le-293' as CardDefinitionId;      // this card
const ICE_ORCS = 'le-270' as CardDefinitionId;               // +2 Standard Modification
const MISTY_MOUNTAIN_WARGS = 'le-272' as CardDefinitionId;   // +2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;                 // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;                  // orc, DI 0, no effects
const LOSSADAN_CAIRN = 'le-388' as CardDefinitionId;         // ruins-and-lairs (faction's home)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;            // shadow-hold (not Lossadan Cairn)
const CARN_DUM = 'le-359' as CardDefinitionId;               // minion haven (site-deck filler)

/** Already-controlled Ice-orcs (first Standard Modification faction). */
const ICE_ORCS_IN_PLAY: CardInPlay = {
  instanceId: 'ice-orcs-1' as CardInstanceId, definitionId: ICE_ORCS, status: CardStatus.Untapped,
};
/** Already-controlled Misty Mountain Wargs (second Standard Modification faction). */
const MMW_IN_PLAY: CardInPlay = {
  instanceId: 'mmw-1' as CardInstanceId, definitionId: MISTY_MOUNTAIN_WARGS, status: CardStatus.Untapped,
};
/** The Wargs themselves already in play, for the re-influence checks. */
const WARGS_IN_PLAY: CardInPlay = {
  instanceId: 'wargs-inplay-1' as CardInstanceId, definitionId: WARGS_OF_FOROCHEL, status: CardStatus.Untapped,
};

describe('Wargs of the Forochel (le-293)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: playable at Lossadan Cairn, influence # 11 ─────────────────

  test('influence-attempt is legal at Lossadan Cairn with baseline need = 9 (11 - DI 2)', () => {
    // Ciryaher (DI 2, no effects) at Lossadan Cairn with the Wargs in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(11) - DI(2) = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [WARGS_OF_FOROCHEL], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('influence-attempt uses Ciryaher (the only untapped character in company)', () => {
    // Sanity check that influencingCharacterId points at Ciryaher — protects
    // against the need assertions passing via an unrelated influencer.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [WARGS_OF_FOROCHEL], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(ciryaherId);
  });

  test('faction is NOT influenceable at a site other than Lossadan Cairn', () => {
    // Same character, a different minion site (Goblin-gate). The playableAt
    // restriction disqualifies the faction — no influence-attempt is emitted.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [WARGS_OF_FOROCHEL], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  // ── Rules 4–6: standard modifications (both +2, controller-scoped) ────────

  test('+2 standard modification when the controller also has Ice-orcs in play', () => {
    // modifier = DI 2 + check bonus 2 = 4; need = 11 - 4 = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [WARGS_OF_FOROCHEL], siteDeck: [CARN_DUM], cardsInPlay: [ICE_ORCS_IN_PLAY] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 standard modification when the controller also has Misty Mountain Wargs in play', () => {
    // modifier = DI 2 + check bonus 2 = 4; need = 11 - 4 = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [WARGS_OF_FOROCHEL], siteDeck: [CARN_DUM], cardsInPlay: [MMW_IN_PLAY] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('both standard modifications stack: Ice-orcs (+2) and Misty Mountain Wargs (+2)', () => {
    // modifier = DI 2 + 2 + 2 = 6; need = 11 - 6 = 5.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [WARGS_OF_FOROCHEL], siteDeck: [CARN_DUM], cardsInPlay: [ICE_ORCS_IN_PLAY, MMW_IN_PLAY] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('+2 does NOT apply when only the OPPONENT has Ice-orcs in play', () => {
    // controller.inPlay is per-player → need stays at the baseline 11 - 2 = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [WARGS_OF_FOROCHEL], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [ICE_ORCS_IN_PLAY] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('+2 does NOT apply when only the OPPONENT has Misty Mountain Wargs in play', () => {
    // controller.inPlay is per-player → need stays at the baseline 11 - 2 = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [WARGS_OF_FOROCHEL], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [MMW_IN_PLAY] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  // ── Rule 3: uniqueness ────────────────────────────────────────────────────

  test('unique: not influenceable while another copy is already in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [WARGS_OF_FOROCHEL], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    // A copy of the Wargs already in the opponent's play area.
    const withCopy = addCardInPlay(base, 1, WARGS_OF_FOROCHEL);
    const state = { ...withCopy, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  // ── Rule 7: once in play, the number required to influence it is 0 ────────

  test('opponent may re-influence the Wargs while in play; the value required is 0', () => {
    // CoE 8.3: the in-play influence threshold is inPlayInfluenceNumber (0),
    // not the printed influence # of 11. PLAYER_2 controls the faction;
    // PLAYER_1 is the active resource player at the same Lossadan Cairn.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LOSSADAN_CAIRN, characters: [CIRYAHER] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: LOSSADAN_CAIRN, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [WARGS_IN_PLAY] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, WARGS_IN_PLAY.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });

  test('re-influence is not offered away from Lossadan Cairn', () => {
    // Re-influence happens where the faction is playable; at Goblin-gate the
    // Wargs are out of reach.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [WARGS_IN_PLAY] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    expect(firstOpponentInfluenceAttempt(state, WARGS_IN_PLAY.instanceId, PLAYER_1)).toBeUndefined();
  });
});
