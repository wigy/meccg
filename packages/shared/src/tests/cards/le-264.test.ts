/**
 * @module le-264.test
 *
 * Card test: Easterlings (le-264)
 * Type: minion-resource-faction (man, unique, 2 MP, influence # 8)
 *
 * "Unique. Manifestation of hero Easterlings. Playable at Easterling Camp
 *  if the influence check is greater than 8. Standard Modifications:
 *  Balchoth (+2), Wain-easterlings (+2), Men of Dorwinion (-2)."
 *
 * "Manifestation of hero Easterlings" is italic flavor text (a lore /
 * deckbuilding note that this minion faction is the manifestation of the
 * hero faction of the same name); it carries no mechanical rule.
 *
 * The "if the influence check is greater than 8" clause is the faction's
 * `influenceNumber: 8` — the standard "greater than N" comparison handled by
 * the shared faction-influence machinery (need = influenceNumber - modifier).
 *
 * The "Standard Modifications" are three `check-modifier` effects on the
 * influence check, each gated on whether the controlling player has the named
 * faction in play (`controller.inPlay`). Balchoth and Wain-easterlings ease
 * the check by 2; Men of Dorwinion penalizes it by 2. Unlike Grey Mountain
 * Goblins (le-266), Easterlings has no "once in play, number to influence is
 * 0" clause, so there is no in-play influence override.
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                                |
 * |---|------------------------------------------------------|-------------|--------------------------------------|
 * | 1 | Playable only at Easterling Camp                     | IMPLEMENTED | `playableAt.site` match in site.ts   |
 * | 2 | Influence # 8 (greater than 8)                       | IMPLEMENTED | shared faction-influence machinery   |
 * | 3 | +2 influence check when controller has Balchoth      | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 4 | +2 influence check when controller has Wain-east.    | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 5 | -2 influence check when controller has Men of Dorw.  | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 6 | Bonus does NOT apply if opponent has the faction     | IMPLEMENTED | `controller.inPlay` is per-player    |
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

const EASTERLINGS = 'le-264' as CardDefinitionId;
const BALCHOTH = 'le-260' as CardDefinitionId;            // minion faction (+2)
const WAIN_EASTERLINGS = 'as-66' as CardDefinitionId;     // minion faction (+2)
const MEN_OF_DORWINION = 'le-271' as CardDefinitionId;    // minion faction (-2)

const CIRYAHER = 'le-6' as CardDefinitionId;              // dúnadan scout/sage, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;               // orc warrior, DI 0, no effects
const EASTERLING_CAMP = 'le-371' as CardDefinitionId;     // border-hold (Horse Plains)
const DOL_GULDUR = 'le-367' as CardDefinitionId;          // minion haven (site deck filler)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;        // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId;        // shadow-hold, not Easterling Camp

function inPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    status: CardStatus.Untapped,
  };
}

describe('Easterlings (le-264)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Easterling Camp with baseline need = 8 - DI', () => {
    // Ciryaher (DI 2, no effects) at Easterling Camp with Easterlings in hand.
    // No standard-modification factions in play → modifier = DI 2.
    // need = influenceNumber(8) - DI(2) = 6.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [EASTERLINGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('+2 check modifier applies when controller also has Balchoth in play', () => {
    // modifier = DI 2 + check bonus 2 = 4; need = 8 - 4 = 4.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [EASTERLINGS], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay(BALCHOTH, 'balchoth-1')] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(4);
  });

  test('+2 check modifier applies when controller also has Wain-easterlings in play', () => {
    // modifier = DI 2 + check bonus 2 = 4; need = 8 - 4 = 4.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [EASTERLINGS], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay(WAIN_EASTERLINGS, 'wain-1')] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(4);
  });

  test('-2 check penalty applies when controller has Men of Dorwinion in play', () => {
    // Negative standard modification: modifier = DI 2 - 2 = 0; need = 8 - 0 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [EASTERLINGS], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay(MEN_OF_DORWINION, 'mod-1')] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('standard modifications stack: Balchoth + Wain-easterlings + Men of Dorwinion', () => {
    // modifier = DI 2 + 2 (Balchoth) + 2 (Wain) - 2 (Dorwinion) = 4; need = 8 - 4 = 4.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [EASTERLINGS], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay(BALCHOTH, 'balchoth-1'), inPlay(WAIN_EASTERLINGS, 'wain-1'), inPlay(MEN_OF_DORWINION, 'mod-1')] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(4);
  });

  test('bonus does NOT apply when only the OPPONENT has Balchoth in play', () => {
    // Balchoth is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 8 - 2 = 6.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [EASTERLINGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [inPlay(BALCHOTH, 'balchoth-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('faction is NOT influence-able at a site other than Easterling Camp', () => {
    // Same character, a different shadow-hold (Moria). The playableAt
    // restriction disqualifies the faction — no influence-attempt action.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [CIRYAHER] }], hand: [EASTERLINGS], siteDeck: [DOL_GULDUR] },
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
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [EASTERLINGS], siteDeck: [DOL_GULDUR] },
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
