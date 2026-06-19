/**
 * @module as-66.test
 *
 * Card test: Wain-easterlings (as-66)
 * Type: minion-resource-faction (man, unique, 2 MP, influence # 10)
 *
 * "Unique. Playable at Easterling Camp if the influence check is greater than 9.
 *  Standard Modifications: Easterlings (+2), Nûriags (-2)."
 *
 * "greater than 9" means a check must roll 10 or more, encoded as
 * `influenceNumber: 10` (matching the convention used by Nûrniags le-273
 * "greater than 9" → 10 and Asdriags as-111 "greater than 10" → 11).
 *
 * Both Standard Modifications name other factions, so each is a
 * `check-modifier` gated on `controller.inPlay`: the bonus/penalty applies
 * only when the *influencing* player controls that faction (per-player, not
 * the opponent's). The card's printed "Nûriags" is a typo for the faction
 * actually named "Nûrniags" (le-273), so the -2 penalty is keyed to that
 * real in-play name. The +2 is keyed to "Easterlings" (le-264).
 *
 * Engine Support:
 * | # | Feature                                                  | Status      | Notes                                |
 * |---|----------------------------------------------------------|-------------|--------------------------------------|
 * | 1 | Playable only at Easterling Camp                         | IMPLEMENTED | `playableAt.site` match in site.ts   |
 * | 2 | Influence # 10 (greater than 9)                          | IMPLEMENTED | shared faction-influence machinery   |
 * | 3 | +2 influence check when controller has Easterlings       | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 4 | -2 influence check when controller has Nûrniags          | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 5 | Modifiers do NOT apply if opponent has those factions    | IMPLEMENTED | `controller.inPlay` is per-player    |
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

const WAIN_EASTERLINGS = 'as-66' as CardDefinitionId;
const EASTERLINGS = 'le-264' as CardDefinitionId;   // +2 Standard Modification
const NURNIAGS = 'le-273' as CardDefinitionId;       // -2 Standard Modification ("Nûriags" typo)

const CIRYAHER = 'le-6' as CardDefinitionId;         // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;          // orc, DI 0, no effects
const EASTERLING_CAMP = 'le-371' as CardDefinitionId; // border-hold (faction's home)
const CARN_DUM = 'le-359' as CardDefinitionId;       // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;    // shadow-hold (not Easterling Camp)

/** Builds a card-in-play entry for an already-controlled faction. */
function factionInPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    status: CardStatus.Untapped,
  };
}

describe('Wain-easterlings (as-66)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Easterling Camp with baseline need = 10 - DI', () => {
    // Ciryaher (DI 2, no effects) at Easterling Camp with Wain-easterlings in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(10) - DI(2) = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [WAIN_EASTERLINGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('+2 check modifier applies when controller also has Easterlings in play', () => {
    // Easterlings already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 10 - 4 = 6.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [WAIN_EASTERLINGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(EASTERLINGS, 'easterlings-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('-2 check modifier applies when controller has Nûrniags in play', () => {
    // Nûrniags in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 10 - 0 = 10.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [WAIN_EASTERLINGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(NURNIAGS, 'nurniags-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('Standard Modifications stack: Easterlings (+2) and Nûrniags (-2) net to 0', () => {
    // Both a +2 faction and a -2 faction in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + 2 - 2 = 2; need = 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [WAIN_EASTERLINGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(EASTERLINGS, 'easterlings-1'), factionInPlay(NURNIAGS, 'nurniags-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Easterlings in play', () => {
    // Easterlings is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [WAIN_EASTERLINGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(EASTERLINGS, 'easterlings-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Nûrniags in play', () => {
    // Nûrniags is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [WAIN_EASTERLINGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(NURNIAGS, 'nurniags-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('faction is NOT influenceable at a site other than Easterling Camp', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt
    // action emitted for Wain-easterlings.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [WAIN_EASTERLINGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('influence-attempt uses Ciryaher (only untapped character in company)', () => {
    // Sanity check that influencingCharacterId points at Ciryaher — protects
    // against the test passing due to an unrelated character being picked up.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EASTERLING_CAMP, characters: [CIRYAHER] }], hand: [WAIN_EASTERLINGS], siteDeck: [CARN_DUM] },
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
});
