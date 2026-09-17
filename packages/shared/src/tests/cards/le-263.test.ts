/**
 * @module le-263.test
 *
 * Card test: Dunlendings (le-263)
 * Type: minion-resource-faction (man, unique, 4 MP, influence # 10)
 *
 * "Unique. Manifestation of hero Dunlendings. Playable at Dunnish Clan-hold
 *  if the influence check is greater than 9. Standard Modifications:
 *  Hillmen (+2)."
 *
 * "Manifestation of hero Dunlendings" is italic flavor text (a lore /
 * deckbuilding note that this minion faction is the manifestation of the
 * hero faction of the same name); it carries no mechanical rule.
 *
 * The "if the influence check is greater than 9" clause is the faction's
 * `influenceNumber: 10` — the standard "greater than N" comparison handled
 * by the shared faction-influence machinery (need = influenceNumber -
 * modifier).
 *
 * The "Standard Modifications" line is a single `check-modifier` effect on
 * the influence check, gated on whether the controlling player has Hillmen
 * (le-269) in play (`controller.inPlay`). Precedent: Easterlings (le-264).
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                |
 * |---|----------------------------------------------------|-------------|---------------------------------------|
 * | 1 | Playable only at Dunnish Clan-hold                | IMPLEMENTED | `playableAt.site` match in site.ts   |
 * | 2 | Influence # 10 (greater than 9)                   | IMPLEMENTED | shared faction-influence machinery   |
 * | 3 | +2 influence check when controller has Hillmen    | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 4 | Bonus does NOT apply if opponent has Hillmen      | IMPLEMENTED | `controller.inPlay` is per-player    |
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

const DUNLENDINGS = 'le-263' as CardDefinitionId;
const HILLMEN = 'le-269' as CardDefinitionId;             // minion faction (+2)

const CIRYAHER = 'le-6' as CardDefinitionId;              // dúnadan scout/sage, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;               // orc warrior, DI 0, no effects
const DUNNISH_CLAN_HOLD = 'le-370' as CardDefinitionId;   // border-hold (Dunland)
const DOL_GULDUR = 'le-367' as CardDefinitionId;          // minion haven (site deck filler)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;        // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId;        // shadow-hold, not Dunnish Clan-hold

function inPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    status: CardStatus.Untapped,
  };
}

describe('Dunlendings (le-263)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Dunnish Clan-hold with baseline need = 10 - DI', () => {
    // Ciryaher (DI 2, no effects) at Dunnish Clan-hold with Dunlendings in hand.
    // No standard-modification faction in play → modifier = DI 2.
    // need = influenceNumber(10) - DI(2) = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DUNNISH_CLAN_HOLD, characters: [CIRYAHER] }], hand: [DUNLENDINGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('+2 check modifier applies when controller also has Hillmen in play', () => {
    // modifier = DI 2 + check bonus 2 = 4; need = 10 - 4 = 6.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DUNNISH_CLAN_HOLD, characters: [CIRYAHER] }], hand: [DUNLENDINGS], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay(HILLMEN, 'hillmen-1')] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('bonus does NOT apply when only the OPPONENT has Hillmen in play', () => {
    // Hillmen is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DUNNISH_CLAN_HOLD, characters: [CIRYAHER] }], hand: [DUNLENDINGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay(HILLMEN, 'hillmen-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('faction is NOT influence-able at a site other than Dunnish Clan-hold', () => {
    // Same character, a different shadow-hold (Moria). The playableAt
    // restriction disqualifies the faction — no influence-attempt action.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [CIRYAHER] }], hand: [DUNLENDINGS], siteDeck: [DOL_GULDUR] },
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
        { id: PLAYER_1, companies: [{ site: DUNNISH_CLAN_HOLD, characters: [CIRYAHER] }], hand: [DUNLENDINGS], siteDeck: [DOL_GULDUR] },
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
