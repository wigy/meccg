/**
 * @module le-278.test
 *
 * Card test: Orcs of Moria (le-278)
 * Type: minion-resource-faction (orc, unique, 3 MP, influence # 11)
 *
 * "Unique. Playable at Moria if the influence check is greater than 10.
 *  Once in play, the number required to influence this faction is 0.
 *  Standard Modifications: Goblins of Goblin-gate (+2), Orcs of Dol Guldur (-2)."
 *
 * The "Once in play, the number required to influence this faction is 0"
 * clause is modeled via the card's `inPlayInfluenceNumber: 0` field. When
 * an opponent attempts to re-influence the faction while it is in play
 * (CoE rule 8.3, final list item: "the value required for the influence
 * check on the faction that is already in play"), that override is used
 * as the comparison value — see the re-influence test below.
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                                    |
 * |---|------------------------------------------------------|-------------|------------------------------------------|
 * | 1 | Playable only at Moria                               | IMPLEMENTED | `playableAt.site` match in site.ts       |
 * | 2 | Influence # 11 (greater than 10)                     | IMPLEMENTED | shared faction-influence machinery       |
 * | 3 | +2 influence check when controller has GGG           | IMPLEMENTED | `controller.inPlay` resolver context     |
 * | 4 | -2 influence check when controller has ODG           | IMPLEMENTED | `controller.inPlay` resolver context     |
 * | 5 | Modifiers do NOT apply if opponent has those factions | IMPLEMENTED | `controller.inPlay` is per-player        |
 * | 6 | Opponent re-influence while in play (value = 0)      | IMPLEMENTED | `inPlayInfluenceNumber` (CoE rule 8.3)   |
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

const ORCS_OF_MORIA = 'le-278' as CardDefinitionId;
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;
const ORCS_OF_DOL_GULDUR = 'as-121' as CardDefinitionId;

const CIRYAHER = 'le-6' as CardDefinitionId;     // dúnadan scout/sage, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;       // orc warrior, DI 0, no effects
const MORIA = 'le-392' as CardDefinitionId;       // shadow-hold
const DOL_GULDUR = 'le-367' as CardDefinitionId;  // minion haven (site deck filler)
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId; // shadow-hold (not Moria)

describe('Orcs of Moria (le-278)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Moria with baseline need = 11 - DI', () => {
    // Ciryaher (DI 2, no effects) at Moria with Orcs of Moria in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(11) - DI(2) = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [ORCS_OF_MORIA], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('+2 check modifier applies when controller also has Goblins of Goblin-gate in play', () => {
    // Grey Mountain Goblins already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 11 - 4 = 7.
    const gggInPlay: CardInPlay = {
      instanceId: 'ggg-1' as CardInstanceId,
      definitionId: GOBLINS_OF_GOBLIN_GATE,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [ORCS_OF_MORIA], siteDeck: [DOL_GULDUR], cardsInPlay: [gggInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('-2 check modifier applies when controller has Orcs of Dol Guldur in play', () => {
    // Orcs of Dol Guldur in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 11 - 0 = 11.
    const odgInPlay: CardInPlay = {
      instanceId: 'odg-1' as CardInstanceId,
      definitionId: ORCS_OF_DOL_GULDUR,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [ORCS_OF_MORIA], siteDeck: [DOL_GULDUR], cardsInPlay: [odgInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(11);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Goblins of Goblin-gate in play', () => {
    // GGG is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 11 - 2 = 9.
    const gggInPlay: CardInPlay = {
      instanceId: 'ggg-1' as CardInstanceId,
      definitionId: GOBLINS_OF_GOBLIN_GATE,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [ORCS_OF_MORIA], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [gggInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Orcs of Dol Guldur in play', () => {
    // ODG is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 11 - 2 = 9.
    const odgInPlay: CardInPlay = {
      instanceId: 'odg-1' as CardInstanceId,
      definitionId: ORCS_OF_DOL_GULDUR,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [ORCS_OF_MORIA], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [odgInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('faction is NOT influenceable at a site other than Moria', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt
    // action emitted for Orcs of Moria.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [ORCS_OF_MORIA], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
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
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [ORCS_OF_MORIA], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(ciryaherId);
  });

  test('opponent can re-influence Orcs of Moria while in play; value = 0', () => {
    // CoE rule 8.3, final list: "the value required for the influence
    // check on the faction that is already in play". For Orcs of Moria
    // the card text sets that value to 0. PLAYER_2 owns the faction
    // (in cardsInPlay) and PLAYER_1 is the active resource player at
    // Moria making the re-influence attempt. Opponent-influence attempts
    // require turnNumber > 2 (see site.ts guard).
    const factionInPlay: CardInPlay = {
      instanceId: 'om-1' as CardInstanceId,
      definitionId: ORCS_OF_MORIA,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });

  test('opponent CANNOT re-influence Orcs of Moria at a non-Moria site', () => {
    // The faction can only be re-influenced at a site matching its
    // playableAt (Moria). Here both companies are at a different
    // shadow-hold (Goblin-gate) so no opponent-influence-attempt is emitted.
    const factionInPlay: CardInPlay = {
      instanceId: 'om-1' as CardInstanceId,
      definitionId: ORCS_OF_MORIA,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeUndefined();
  });
});
