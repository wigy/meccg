/**
 * @module le-269.test
 *
 * Card test: Hillmen (le-269)
 * Type: minion-resource-faction (man, unique, 4 MP, influence # 11)
 *
 * "Unique. Manifestation of hero Hillmen. Playable at Cameth Brin if the
 *  influence check is greater than 10. Standard Modifications: Dunlendings
 *  (+2), Angmarim (+2)."
 *
 * "Manifestation of hero Hillmen" is italic flavor text (a lore /
 * deckbuilding note that this minion faction is the manifestation of the
 * hero faction of the same name); it carries no mechanical rule.
 *
 * The "if the influence check is greater than 10" clause is the faction's
 * `influenceNumber: 11` — the standard "greater than N" comparison handled
 * by the shared faction-influence machinery (need = influenceNumber -
 * modifier).
 *
 * The "Standard Modifications" are two `check-modifier` effects on the
 * influence check, each gated on whether the controlling player has the
 * named faction in play (`controller.inPlay`): Dunlendings and Angmarim
 * each ease the check by 2. There is no "once in play, number to influence
 * is 0" clause (cf. Angmarim as-62), so no in-play influence override.
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                                |
 * |---|--------------------------------------------------------|-------------|--------------------------------------|
 * | 1 | Playable only at Cameth Brin                         | IMPLEMENTED | `playableAt.site` match in site.ts   |
 * | 2 | Influence # 11 (greater than 10)                     | IMPLEMENTED | shared faction-influence machinery   |
 * | 3 | +2 influence check when controller has Dunlendings   | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 4 | +2 influence check when controller has Angmarim      | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 5 | Bonus does NOT apply if opponent has the faction     | IMPLEMENTED | `controller.inPlay` is per-player    |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase,
  firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId,
} from '../../index.js';

const HILLMEN = 'le-269' as CardDefinitionId;
const DUNLENDINGS = 'le-263' as CardDefinitionId;   // minion faction (+2)
const ANGMARIM = 'as-62' as CardDefinitionId;       // minion faction (+2)

const CIRYAHER = 'le-6' as CardDefinitionId;        // dúnadan scout/sage, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;         // orc warrior, DI 0, no effects
const CAMETH_BRIN = 'le-358' as CardDefinitionId;   // border-hold (Rhudaur)
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven (site deck filler)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId;  // shadow-hold, not Cameth Brin

function inPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    status: CardStatus.Untapped,
  };
}

describe('Hillmen (le-269)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Cameth Brin with baseline need = 11 - DI', () => {
    // Ciryaher (DI 2, no effects) at Cameth Brin with Hillmen in hand.
    // No standard-modification factions in play → modifier = DI 2.
    // need = influenceNumber(11) - DI(2) = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CAMETH_BRIN, characters: [CIRYAHER] }], hand: [HILLMEN], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('+2 check modifier applies when controller also has Dunlendings in play', () => {
    // modifier = DI 2 + check bonus 2 = 4; need = 11 - 4 = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CAMETH_BRIN, characters: [CIRYAHER] }], hand: [HILLMEN], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay(DUNLENDINGS, 'dunlendings-1')] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 check modifier applies when controller also has Angmarim in play', () => {
    // modifier = DI 2 + check bonus 2 = 4; need = 11 - 4 = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CAMETH_BRIN, characters: [CIRYAHER] }], hand: [HILLMEN], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay(ANGMARIM, 'angmarim-1')] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('standard modifications stack: Dunlendings + Angmarim', () => {
    // modifier = DI 2 + 2 (Dunlendings) + 2 (Angmarim) = 6; need = 11 - 6 = 5.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CAMETH_BRIN, characters: [CIRYAHER] }], hand: [HILLMEN], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay(DUNLENDINGS, 'dunlendings-1'), inPlay(ANGMARIM, 'angmarim-1')] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('bonus does NOT apply when only the OPPONENT has Dunlendings in play', () => {
    // Dunlendings is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 11 - 2 = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CAMETH_BRIN, characters: [CIRYAHER] }], hand: [HILLMEN], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay(DUNLENDINGS, 'dunlendings-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('faction is NOT influence-able at a site other than Cameth Brin', () => {
    // Same character, a different shadow-hold (Moria). The playableAt
    // restriction disqualifies the faction — no influence-attempt action.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [CIRYAHER] }], hand: [HILLMEN], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('influence-attempt uses Ciryaher (only untapped character in company)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CAMETH_BRIN, characters: [CIRYAHER] }], hand: [HILLMEN], siteDeck: [DOL_GULDUR] },
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
});
