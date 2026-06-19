/**
 * @module as-114.test
 *
 * Card test: Corsairs of Rhûn (as-114)
 * Type: minion-resource-faction (man, unique, 2 MP, influence # 10)
 *
 * "Unique. Playable at Raider-hold if the influence check is greater than 9.
 *  Standard Modifications: Easterlings (+2), Men of Dorwinion (-2)."
 *
 * "greater than 9" means a check must roll 10 or more, encoded as
 * `influenceNumber: 10` (matching the convention used by Asdriags as-111
 * "greater than 10" → 11 and Orcs of Udûn le-282 "greater than 8" → 9).
 *
 * The two Standard Modifications both name other factions (Easterlings le-264,
 * Men of Dorwinion le-271), so each is a `check-modifier` gated on
 * `controller.inPlay` — the bonus/penalty applies only when the influencing
 * player controls that faction (per-player, never the opponent's).
 *
 * Engine Support:
 * | # | Feature                                                  | Status      | Notes                                |
 * |---|----------------------------------------------------------|-------------|--------------------------------------|
 * | 1 | Playable only at Raider-hold                             | IMPLEMENTED | `playableAt.site` match in site.ts   |
 * | 2 | Influence # 10 (greater than 9)                          | IMPLEMENTED | shared faction-influence machinery   |
 * | 3 | +2 influence check when controller has Easterlings       | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 4 | -2 influence check when controller has Men of Dorwinion   | IMPLEMENTED | `controller.inPlay` resolver context |
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

const CORSAIRS = 'as-114' as CardDefinitionId;
const EASTERLINGS = 'le-264' as CardDefinitionId;        // +2 Standard Modification
const MEN_OF_DORWINION = 'le-271' as CardDefinitionId;   // -2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;        // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;          // orc, DI 0, no effects
const RAIDER_HOLD = 'le-399' as CardDefinitionId;    // border-hold (faction's home)
const CARN_DUM = 'le-359' as CardDefinitionId;       // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;    // shadow-hold (not Raider-hold)

/** Builds a card-in-play entry for an already-controlled faction. */
function factionInPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    status: CardStatus.Untapped,
  };
}

describe('Corsairs of Rhûn (as-114)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Raider-hold with baseline need = 10 - DI', () => {
    // Ciryaher (DI 2, no effects) at Raider-hold with Corsairs in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(10) - DI(2) = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [CORSAIRS], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [CORSAIRS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(EASTERLINGS, 'easterlings-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('-2 check modifier applies when controller has Men of Dorwinion in play', () => {
    // Men of Dorwinion in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 10 - 0 = 10.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [CORSAIRS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(MEN_OF_DORWINION, 'dorwinion-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('Standard Modifications stack: Easterlings (+2) and Men of Dorwinion (-2) net to 0', () => {
    // Both a +2 faction and a -2 faction in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + 2 - 2 = 2; need = 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [CORSAIRS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(EASTERLINGS, 'easterlings-1'), factionInPlay(MEN_OF_DORWINION, 'dorwinion-1')] },
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
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [CORSAIRS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(EASTERLINGS, 'easterlings-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Men of Dorwinion in play', () => {
    // Men of Dorwinion is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [CORSAIRS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(MEN_OF_DORWINION, 'dorwinion-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('faction is NOT influenceable at a site other than Raider-hold', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt
    // action emitted for Corsairs of Rhûn.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [CORSAIRS], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }], hand: [CORSAIRS], siteDeck: [CARN_DUM] },
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
