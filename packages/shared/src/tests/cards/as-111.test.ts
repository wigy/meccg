/**
 * @module as-111.test
 *
 * Card test: Asdriags (as-111)
 * Type: minion-resource-faction (man, unique, 2 MP, influence # 11)
 *
 * "Unique. Playable at Nûrniag Camp if the influence check is greater than 10.
 *  Standard Modifications: Nûrniags (+2), Variags of Khand (+2), Balchoth (-2)."
 *
 * "greater than 10" means a check must roll 11 or more, encoded as
 * `influenceNumber: 11` (matching the convention used by Wain-easterlings
 * as-60 "greater than 8" → 9, Men of Dale td-138 "greater than 7" → 8).
 *
 * The three Standard Modifications all name other factions (Nûrniags le-273,
 * Variags of Khand le-292, Balchoth le-260), so each is a `check-modifier`
 * gated on `controller.inPlay` — the bonus/penalty applies only when the
 * influencing player controls that faction (per-player, not the opponent's).
 *
 * Engine Support:
 * | # | Feature                                                  | Status      | Notes                                |
 * |---|----------------------------------------------------------|-------------|--------------------------------------|
 * | 1 | Playable only at Nûrniag Camp                            | IMPLEMENTED | `playableAt.site` match in site.ts   |
 * | 2 | Influence # 11 (greater than 10)                         | IMPLEMENTED | shared faction-influence machinery   |
 * | 3 | +2 influence check when controller has Nûrniags          | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 4 | +2 influence check when controller has Variags of Khand  | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 5 | -2 influence check when controller has Balchoth          | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 6 | Modifiers do NOT apply if opponent has those factions    | IMPLEMENTED | `controller.inPlay` is per-player    |
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

const ASDRIAGS = 'as-111' as CardDefinitionId;
const NURNIAGS = 'le-273' as CardDefinitionId;          // +2 Standard Modification
const VARIAGS_OF_KHAND = 'le-292' as CardDefinitionId;  // +2 Standard Modification
const BALCHOTH = 'le-260' as CardDefinitionId;          // -2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;        // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;          // orc, DI 0, no effects
const NURNIAG_CAMP = 'le-396' as CardDefinitionId;   // shadow-hold (faction's home)
const CARN_DUM = 'le-359' as CardDefinitionId;       // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;    // shadow-hold (not Nûrniag Camp)

/** Builds a card-in-play entry for an already-controlled faction. */
function factionInPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    status: CardStatus.Untapped,
  };
}

describe('Asdriags (as-111)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Nûrniag Camp with baseline need = 11 - DI', () => {
    // Ciryaher (DI 2, no effects) at Nûrniag Camp with Asdriags in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(11) - DI(2) = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [ASDRIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('+2 check modifier applies when controller also has Nûrniags in play', () => {
    // Nûrniags already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 11 - 4 = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [ASDRIAGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(NURNIAGS, 'nurniags-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 check modifier applies when controller has Variags of Khand in play', () => {
    // Variags of Khand in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 11 - 4 = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [ASDRIAGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(VARIAGS_OF_KHAND, 'variags-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('-2 check modifier applies when controller has Balchoth in play', () => {
    // Balchoth in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 11 - 0 = 11.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [ASDRIAGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(BALCHOTH, 'balchoth-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(11);
  });

  test('Standard Modifications stack: Nûrniags (+2) and Balchoth (-2) net to 0', () => {
    // Both a +2 faction and a -2 faction in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + 2 - 2 = 2; need = 11 - 2 = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [ASDRIAGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(NURNIAGS, 'nurniags-1'), factionInPlay(BALCHOTH, 'balchoth-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Nûrniags in play', () => {
    // Nûrniags is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 11 - 2 = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [ASDRIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(NURNIAGS, 'nurniags-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Balchoth in play', () => {
    // Balchoth is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 11 - 2 = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [ASDRIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(BALCHOTH, 'balchoth-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('faction is NOT influenceable at a site other than Nûrniag Camp', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt
    // action emitted for Asdriags.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [ASDRIAGS], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [ASDRIAGS], siteDeck: [CARN_DUM] },
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
