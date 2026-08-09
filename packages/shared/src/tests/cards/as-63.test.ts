/**
 * @module as-63.test
 *
 * Card test: Haradrim (as-63)
 * Type: minion-resource-faction (man, unique, 2 MP, influence # 10)
 *
 * "Unique. Playable at Southron Oasis if the influence check is greater than 9.
 *  Standard Modifications: Southrons (+2), Variags of Khand (-2)."
 *
 * "greater than 9" means a check must roll 10 or more, encoded as
 * `influenceNumber: 10` (matching the convention used by Asdriags as-111
 * "greater than 10" → 11 and Wain-easterlings as-60 "greater than 8" → 9).
 *
 * Both Standard Modifications name other factions (Southrons le-287, Variags of
 * Khand le-292), so each is a `check-modifier` on the `influence` check gated on
 * `controller.inPlay` — the bonus/penalty applies only when the influencing
 * player controls that faction (per-player, not the opponent's).
 *
 * Engine Support:
 * | # | Feature                                                   | Status      | Notes                                |
 * |---|-----------------------------------------------------------|-------------|--------------------------------------|
 * | 1 | Playable only at Southron Oasis                           | IMPLEMENTED | `playableAt.site` match in site.ts   |
 * | 2 | Influence # 10 (greater than 9)                           | IMPLEMENTED | shared faction-influence machinery   |
 * | 3 | +2 influence check when controller has Southrons          | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 4 | -2 influence check when controller has Variags of Khand   | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 5 | Modifiers do NOT apply if opponent has those factions     | IMPLEMENTED | `controller.inPlay` is per-player    |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase,
  firstFactionInfluenceAttempt,
  pool,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId,
} from '../../index.js';

const HARADRIM = 'as-63' as CardDefinitionId;
const SOUTHRONS = 'le-287' as CardDefinitionId;        // +2 Standard Modification
const VARIAGS_OF_KHAND = 'le-292' as CardDefinitionId; // -2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;         // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;          // orc, DI 0, no effects
const SOUTHRON_OASIS = 'le-404' as CardDefinitionId; // border-hold (faction's home)
const CARN_DUM = 'le-359' as CardDefinitionId;       // minion haven
const GOBLIN_GATE = 'le-378' as CardDefinitionId;    // shadow-hold (not Southron Oasis)

/** Builds a card-in-play entry for an already-controlled faction. */
function factionInPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    status: CardStatus.Untapped,
  };
}

describe('Haradrim (as-63)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Southron Oasis with baseline need = 10 - DI', () => {
    // Ciryaher (DI 2, no effects) at Southron Oasis with Haradrim in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(10) - DI(2) = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [HARADRIM], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('+2 check modifier applies when controller also has Southrons in play', () => {
    // Southrons already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 10 - 4 = 6.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [HARADRIM], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(SOUTHRONS, 'southrons-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('-2 check modifier applies when controller has Variags of Khand in play', () => {
    // Variags of Khand in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 10 - 0 = 10.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [HARADRIM], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(VARIAGS_OF_KHAND, 'variags-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('Standard Modifications stack: Southrons (+2) and Variags of Khand (-2) net to 0', () => {
    // Both the +2 faction and the -2 faction in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + 2 - 2 = 2; need = 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [HARADRIM], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(SOUTHRONS, 'southrons-1'), factionInPlay(VARIAGS_OF_KHAND, 'variags-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Southrons in play', () => {
    // Southrons is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [HARADRIM], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(SOUTHRONS, 'southrons-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Variags of Khand in play', () => {
    // Variags of Khand is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 10 - 2 = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [HARADRIM], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(VARIAGS_OF_KHAND, 'variags-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('faction is NOT influenceable at a site other than Southron Oasis', () => {
    // Same character, different site (Goblin-gate). The playableAt restriction
    // should disqualify the faction — no influence-attempt action for Haradrim.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [HARADRIM], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('image is the minion printing (Haradrim2.jpg), distinct from hero as-59', () => {
    // Bug report baca0f513854d830: minion Haradrim rendered with the hero
    // printing's artwork. The remaster repo serves the two same-named
    // Haradrim cards under distinct filenames — hero as-59 is Haradrim.jpg,
    // minion as-63 is Haradrim2.jpg.
    expect(pool[HARADRIM]?.image).toMatch(/Haradrim2\.jpg$/);
    expect(pool[HARADRIM]?.image).not.toBe(pool['as-59' as CardDefinitionId]?.image);
  });

  test('influence-attempt uses Ciryaher (only untapped character in company)', () => {
    // Sanity check that influencingCharacterId points at Ciryaher — protects
    // against the test passing due to an unrelated character being picked up.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [CIRYAHER] }], hand: [HARADRIM], siteDeck: [CARN_DUM] },
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
