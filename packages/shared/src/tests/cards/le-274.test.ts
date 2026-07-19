/**
 * @module le-274.test
 *
 * Card test: Orcs of Angmar (le-274)
 * Type: minion-resource-faction (orc, unique, 2 MP, influence # 9)
 *
 * "Unique. Playable at Mount Gram if the influence check is greater than 8.
 *  Once in play, the number required to influence this faction is 0.
 *  Standard Modifications: Morgul-orcs (+2), Orcs of Gundabad (-2)."
 *
 * The "Once in play, the number required to influence this faction is 0"
 * clause is modeled via the card's `inPlayInfluenceNumber: 0` field.
 *
 * Mirror of the certified Orcs of Gundabad (le-276): same shared
 * faction-influence machinery, `playableAt` restriction, and two
 * `check-modifier` (influence) effects gated on `controller.inPlay`.
 *
 * Engine Support:
 * | # | Feature                                                  | Status      | Notes                                   |
 * |---|----------------------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Playable only at Mount Gram                              | IMPLEMENTED | `playableAt.site` match in site.ts      |
 * | 2 | Influence # 9 (greater than 8)                           | IMPLEMENTED | shared faction-influence machinery      |
 * | 3 | +2 influence check when controller has Morgul-orcs       | IMPLEMENTED | `controller.inPlay` resolver context    |
 * | 4 | -2 influence check when controller has Orcs of Gundabad  | IMPLEMENTED | `controller.inPlay` resolver context    |
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

const ORCS_OF_ANGMAR = 'le-274' as CardDefinitionId;
const MORGUL_ORCS = 'as-119' as CardDefinitionId;
const ORCS_OF_GUNDABAD = 'le-276' as CardDefinitionId;

const CIRYAHER = 'le-6' as CardDefinitionId;      // dúnadan scout/sage, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;        // orc warrior, DI 0, no effects
const MOUNT_GRAM = 'le-394' as CardDefinitionId;   // shadow-hold (Orcs of Angmar's site)
const CARN_DUM = 'le-359' as CardDefinitionId;     // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // shadow-hold (not Mount Gram)

describe('Orcs of Angmar (le-274)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Mount Gram with baseline need = 9 - DI', () => {
    // Ciryaher (DI 2, no effects) at Mount Gram with Orcs of Angmar in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(9) - DI(2) = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MOUNT_GRAM, characters: [CIRYAHER] }], hand: [ORCS_OF_ANGMAR], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 check modifier applies when controller also has Morgul-orcs in play', () => {
    // Morgul-orcs already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 9 - 4 = 5.
    const morgulInPlay: CardInPlay = {
      instanceId: 'morgul-1' as CardInstanceId,
      definitionId: MORGUL_ORCS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MOUNT_GRAM, characters: [CIRYAHER] }], hand: [ORCS_OF_ANGMAR], siteDeck: [CARN_DUM], cardsInPlay: [morgulInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('-2 check modifier applies when controller has Orcs of Gundabad in play', () => {
    // Orcs of Gundabad in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 9 - 0 = 9.
    const gundabadInPlay: CardInPlay = {
      instanceId: 'gundabad-1' as CardInstanceId,
      definitionId: ORCS_OF_GUNDABAD,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MOUNT_GRAM, characters: [CIRYAHER] }], hand: [ORCS_OF_ANGMAR], siteDeck: [CARN_DUM], cardsInPlay: [gundabadInPlay] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Morgul-orcs in play', () => {
    // Morgul-orcs is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 2 = 7.
    const morgulInPlay: CardInPlay = {
      instanceId: 'morgul-1' as CardInstanceId,
      definitionId: MORGUL_ORCS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MOUNT_GRAM, characters: [CIRYAHER] }], hand: [ORCS_OF_ANGMAR], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [morgulInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Orcs of Gundabad in play', () => {
    // Orcs of Gundabad is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 2 = 7.
    const gundabadInPlay: CardInPlay = {
      instanceId: 'gundabad-1' as CardInstanceId,
      definitionId: ORCS_OF_GUNDABAD,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MOUNT_GRAM, characters: [CIRYAHER] }], hand: [ORCS_OF_ANGMAR], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [gundabadInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('faction is NOT influenceable at a site other than Mount Gram', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt
    // action emitted for Orcs of Angmar.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [ORCS_OF_ANGMAR], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: MOUNT_GRAM, characters: [CIRYAHER] }], hand: [ORCS_OF_ANGMAR], siteDeck: [CARN_DUM] },
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

  test('opponent can re-influence Orcs of Angmar while in play; value = 0', () => {
    // CoE rule 8.3, final list: "the value required for the influence
    // check on the faction that is already in play". For Orcs of Angmar
    // the card text sets that value to 0. PLAYER_2 owns the faction
    // (in cardsInPlay) and PLAYER_1 is the active resource player at
    // Mount Gram making the re-influence attempt.
    const factionInPlay: CardInPlay = {
      instanceId: 'oa-1' as CardInstanceId,
      definitionId: ORCS_OF_ANGMAR,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MOUNT_GRAM, characters: [CIRYAHER] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: MOUNT_GRAM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });

  test('opponent CANNOT re-influence Orcs of Angmar at a non-Mount-Gram site', () => {
    // The faction can only be re-influenced at a site matching its
    // playableAt (Mount Gram). Here both companies are at Goblin-gate
    // so no opponent-influence-attempt is emitted.
    const factionInPlay: CardInPlay = {
      instanceId: 'oa-1' as CardInstanceId,
      definitionId: ORCS_OF_ANGMAR,
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
