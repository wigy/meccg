/**
 * @module le-277.test
 *
 * Card test: Orcs of Mirkwood (le-277)
 * Type: minion-resource-faction (orc, unique, 2 MP, influence # 9)
 *
 * "Unique. Playable at Sarn Goriwing if the influence check is greater than 8.
 *  Once in play, the number required to influence this faction is 0.
 *  Standard Modifications: Orcs of Red Eye (-2), Orcs of Gorgoroth (+2)."
 *
 * The "Once in play, the number required to influence this faction is 0"
 * clause is modeled via the card's `inPlayInfluenceNumber: 0` field. The
 * Standard Modifications match the controlling player's in-play factions by
 * name ("Orcs of the Red Eye" / "Orcs of Gorgoroth" — the authoritative card
 * names, per data/cards.json LE-281 / LE-275).
 *
 * Engine Support:
 * | # | Feature                                                  | Status      | Notes                                   |
 * |---|----------------------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Playable only at Sarn Goriwing                           | IMPLEMENTED | `playableAt.site` match in site.ts      |
 * | 2 | Influence # 9 (greater than 8)                           | IMPLEMENTED | shared faction-influence machinery      |
 * | 3 | +2 influence check when controller has Orcs of Gorgoroth | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 4 | -2 influence check when controller has Orcs of Red Eye   | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 5 | Modifiers do NOT apply if opponent has those factions    | IMPLEMENTED | `controller.inPlay` is per-player       |
 * | 6 | Opponent re-influence while in play (value = 0)          | IMPLEMENTED | `inPlayInfluenceNumber` (CoE rule 8.3)  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase,
  firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId,
} from '../../index.js';

const ORCS_OF_MIRKWOOD = 'le-277' as CardDefinitionId;
const ORCS_OF_GORGOROTH = 'le-275' as CardDefinitionId;     // +2 Standard Modification
const ORCS_OF_THE_RED_EYE = 'le-281' as CardDefinitionId;   // -2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;       // dúnadan scout/sage, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;         // orc warrior, DI 0, no effects
const SARN_GORIWING = 'le-401' as CardDefinitionId; // shadow-hold (home site)
const CARN_DUM = 'le-359' as CardDefinitionId;      // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // shadow-hold (not Sarn Goriwing)

describe('Orcs of Mirkwood (le-277)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Sarn Goriwing with baseline need = 9 - DI', () => {
    // Ciryaher (DI 2, no effects) at Sarn Goriwing with Orcs of Mirkwood in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(9) - DI(2) = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [CIRYAHER] }], hand: [ORCS_OF_MIRKWOOD], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 check modifier applies when controller also has Orcs of Gorgoroth in play', () => {
    // Orcs of Gorgoroth already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 9 - 4 = 5.
    const gorgInPlay: CardInPlay = {
      instanceId: 'gorg-1' as CardInstanceId,
      definitionId: ORCS_OF_GORGOROTH,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [CIRYAHER] }], hand: [ORCS_OF_MIRKWOOD], siteDeck: [CARN_DUM], cardsInPlay: [gorgInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('-2 check modifier applies when controller has Orcs of the Red Eye in play', () => {
    // Orcs of the Red Eye in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 9 - 0 = 9.
    const redEyeInPlay: CardInPlay = {
      instanceId: 'redeye-1' as CardInstanceId,
      definitionId: ORCS_OF_THE_RED_EYE,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [CIRYAHER] }], hand: [ORCS_OF_MIRKWOOD], siteDeck: [CARN_DUM], cardsInPlay: [redEyeInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Orcs of Gorgoroth in play', () => {
    // Gorgoroth is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 2 = 7.
    const gorgInPlay: CardInPlay = {
      instanceId: 'gorg-1' as CardInstanceId,
      definitionId: ORCS_OF_GORGOROTH,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [CIRYAHER] }], hand: [ORCS_OF_MIRKWOOD], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [gorgInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Orcs of the Red Eye in play', () => {
    // Red Eye is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 2 = 7.
    const redEyeInPlay: CardInPlay = {
      instanceId: 'redeye-1' as CardInstanceId,
      definitionId: ORCS_OF_THE_RED_EYE,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [CIRYAHER] }], hand: [ORCS_OF_MIRKWOOD], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [redEyeInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('faction is NOT influenceable at a site other than Sarn Goriwing', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt
    // action emitted for Orcs of Mirkwood.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [ORCS_OF_MIRKWOOD], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('influence-attempt uses Ciryaher (only untapped character in company)', () => {
    // Sanity check that the influencingCharacterId field points at
    // Ciryaher — protects against the test passing due to an unrelated
    // character being picked up.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [CIRYAHER] }], hand: [ORCS_OF_MIRKWOOD], siteDeck: [CARN_DUM] },
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

  test('opponent can re-influence Orcs of Mirkwood while in play; value = 0', () => {
    // CoE rule 8.3, final list: "the value required for the influence
    // check on the faction that is already in play". For Orcs of Mirkwood
    // the card text sets that value to 0. PLAYER_2 owns the faction
    // (in cardsInPlay) and PLAYER_1 is the active resource player at
    // Sarn Goriwing making the re-influence attempt.
    const factionInPlay: CardInPlay = {
      instanceId: 'om-1' as CardInstanceId,
      definitionId: ORCS_OF_MIRKWOOD,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [CIRYAHER] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: SARN_GORIWING, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });

  test('opponent CANNOT re-influence Orcs of Mirkwood at a non-Sarn-Goriwing site', () => {
    // The faction can only be re-influenced at a site matching its
    // playableAt (Sarn Goriwing). Here both companies are at Goblin-gate
    // so no opponent-influence-attempt is emitted.
    const factionInPlay: CardInPlay = {
      instanceId: 'om-1' as CardInstanceId,
      definitionId: ORCS_OF_MIRKWOOD,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeUndefined();
  });
});
