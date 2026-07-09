/**
 * @module as-120.test
 *
 * Card test: Nûriags (as-120)
 * Type: minion-resource-faction (man, unique, 2 MP, influence # 10)
 *
 * "Unique. Playable at Variag Camp if the influence check is greater than 9.
 *  Standard Modifications: Haradrim (+2), Southrons (-2)."
 *
 * "greater than 9" means a check must roll 10 or more, encoded as
 * `influenceNumber: 10` (matching the convention used by Haradrim as-63 and
 * Corsairs of Rhûn as-114, both "greater than 9" → 10).
 *
 * The two Standard Modifications name other factions (Haradrim as-63,
 * Southrons le-287), so each is a `check-modifier` gated on
 * `controller.inPlay` — the bonus/penalty applies only when the influencing
 * player controls that faction (per-player, never the opponent's copies).
 *
 * Engine Support:
 * | # | Feature                                                  | Status      | Notes                                |
 * |---|----------------------------------------------------------|-------------|--------------------------------------|
 * | 1 | Playable only at Variag Camp                             | IMPLEMENTED | `playableAt.site` match in site.ts   |
 * | 2 | Influence # 10 (greater than 9)                          | IMPLEMENTED | shared faction-influence machinery   |
 * | 3 | +2 influence check when controller has Haradrim          | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 4 | -2 influence check when controller has Southrons         | IMPLEMENTED | `controller.inPlay` resolver context |
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

const NURIAGS = 'as-120' as CardDefinitionId;
const HARADRIM = 'as-63' as CardDefinitionId;    // +2 Standard Modification
const SOUTHRONS = 'le-287' as CardDefinitionId;  // -2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;      // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;        // orc, DI 0, no effects
const VARIAG_CAMP = 'le-411' as CardDefinitionId;  // border-hold (faction's home)
const CARN_DUM = 'le-359' as CardDefinitionId;     // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // shadow-hold (not Variag Camp)

/** Builds a card-in-play entry for an already-controlled faction. */
function factionInPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    status: CardStatus.Untapped,
  };
}

describe('Nûriags (as-120)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Variag Camp with baseline need = 10 - DI', () => {
    // Ciryaher (DI 2, no effects) at Variag Camp with Nûriags in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(10) - DI(2) = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [NURIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('+2 check modifier applies when controller also has Haradrim in play', () => {
    // Haradrim already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 10 - 4 = 6.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [NURIAGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(HARADRIM, 'haradrim-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('-2 check modifier applies when controller has Southrons in play', () => {
    // Southrons in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 10 - 0 = 10.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [NURIAGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(SOUTHRONS, 'southrons-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('Standard Modifications stack: Haradrim (+2) and Southrons (-2) net to 0', () => {
    // Both a +2 faction and a -2 faction in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + 2 - 2 = 2; need = 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [NURIAGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(HARADRIM, 'haradrim-1'), factionInPlay(SOUTHRONS, 'southrons-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Haradrim in play', () => {
    // Haradrim is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [NURIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(HARADRIM, 'haradrim-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Southrons in play', () => {
    // Southrons is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [NURIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(SOUTHRONS, 'southrons-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('faction is NOT influenceable at a site other than Variag Camp', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt
    // action emitted for Nûriags.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [NURIAGS], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [NURIAGS], siteDeck: [CARN_DUM] },
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
