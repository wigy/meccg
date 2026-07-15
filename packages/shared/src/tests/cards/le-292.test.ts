/**
 * @module le-292.test
 *
 * Card test: Variags of Khand (le-292)
 * Type: minion-resource-faction (man, unique, 2 MP, influence # 9)
 *
 * "Unique. Manifestation of hero Variags of Khand. Playable at Variag Camp if
 *  the influence check is greater than 8. Standard Modifications: Nûrniags
 *  (+2), Haradrim (-2)."
 *
 * Rule-by-rule interpretation:
 *  - "Unique" → `unique: true` (deck-building limit, not an in-game effect).
 *  - "Manifestation of hero Variags of Khand" → this minion faction and the
 *    hero Variags of Khand faction (tw-357) are the same unique entity. Both
 *    cards carry the identical printed name "Variags of Khand", so the
 *    engine's name-based in-play uniqueness check (`countCopiesInPlay`,
 *    scanning both players) already treats them as one unique faction: if
 *    either manifestation is in play anywhere, the other cannot be influenced.
 *  - "Playable at Variag Camp … greater than 8" → `playableAt.site` (le-411)
 *    plus the printed influence # of 9 (a check strictly greater than 8
 *    succeeds). Modelled by the shared faction-influence machinery;
 *    `need = influenceNumber(9) - modifiers`.
 *  - "Standard Modifications: Nûrniags (+2), Haradrim (-2)" → two
 *    `check-modifier` effects on the influence check, each gated on the
 *    controller having the named faction in play (`controller.inPlay`), so the
 *    bonus/penalty applies only to the influencing player's own factions —
 *    never the opponent's copies. Mirrors the certified sibling at Variag
 *    Camp, Nûriags (as-120).
 *
 * Engine Support:
 * | # | Feature                                                | Status      | Notes                                |
 * |---|--------------------------------------------------------|-------------|--------------------------------------|
 * | 1 | Playable only at Variag Camp                           | IMPLEMENTED | `playableAt.site` match in site.ts   |
 * | 2 | Influence # 9 (greater than 8)                         | IMPLEMENTED | shared faction-influence machinery   |
 * | 3 | +2 influence check when controller has Nûrniags        | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 4 | -2 influence check when controller has Haradrim        | IMPLEMENTED | `controller.inPlay` resolver context |
 * | 5 | Modifiers do NOT apply if opponent has those factions  | IMPLEMENTED | `controller.inPlay` is per-player    |
 * | 6 | Manifestation shares uniqueness with hero (tw-357)     | IMPLEMENTED | name-based `countCopiesInPlay`       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase, addCardInPlay,
  firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId,
} from '../../index.js';

const VARIAGS = 'le-292' as CardDefinitionId;         // this card (minion Variags of Khand)
const HERO_VARIAGS = 'tw-357' as CardDefinitionId;    // hero Variags of Khand — same unique entity
const NURNIAGS = 'le-273' as CardDefinitionId;        // +2 Standard Modification
const HARADRIM = 'as-63' as CardDefinitionId;         // -2 Standard Modification

const CIRYAHER = 'le-6' as CardDefinitionId;          // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;           // orc warrior, DI 0, no effects
const VARIAG_CAMP = 'le-411' as CardDefinitionId;     // border-hold (faction's home)
const CARN_DUM = 'le-359' as CardDefinitionId;        // minion haven (site-deck filler)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;     // shadow-hold (not Variag Camp)

/** Builds a card-in-play entry for an already-controlled faction. */
function factionInPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    status: CardStatus.Untapped,
  };
}

describe('Variags of Khand (le-292)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Variag Camp with baseline need = 7 (9 - DI 2)', () => {
    // Ciryaher (DI 2, no effects) at Variag Camp with Variags in hand.
    // No Standard Modification factions in play → modifier = DI 2.
    // need = influenceNumber(9) - DI(2) = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [VARIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 check modifier applies when controller also has Nûrniags in play', () => {
    // Nûrniags already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 9 - 4 = 5.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [VARIAGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(NURNIAGS, 'nurniags-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('-2 check modifier applies when controller has Haradrim in play', () => {
    // Haradrim in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check penalty -2 = 0; need = 9 - 0 = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [VARIAGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(HARADRIM, 'haradrim-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('Standard Modifications stack: Nûrniags (+2) and Haradrim (-2) net to 0', () => {
    // Both a +2 faction and a -2 faction in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + 2 - 2 = 2; need = 9 - 2 = 7 (same as baseline).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [VARIAGS], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(NURNIAGS, 'nurniags-1'), factionInPlay(HARADRIM, 'haradrim-1')] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 bonus does NOT apply when only the OPPONENT has Nûrniags in play', () => {
    // Nûrniags is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 2 = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [VARIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(NURNIAGS, 'nurniags-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('-2 penalty does NOT apply when only the OPPONENT has Haradrim in play', () => {
    // Haradrim is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 2 = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [VARIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay(HARADRIM, 'haradrim-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('faction is NOT influenceable at a site other than Variag Camp', () => {
    // Same character, different shadow-hold (Goblin-gate). The playableAt
    // restriction should disqualify the faction — no influence-attempt action
    // emitted for Variags of Khand.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [VARIAGS], siteDeck: [CARN_DUM] },
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
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [VARIAGS], siteDeck: [CARN_DUM] },
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

  test('Manifestation: not influenceable while hero Variags of Khand (tw-357) is already in play', () => {
    // The opponent already has the hero Variags of Khand faction in play.
    // Because minion Variags is a "Manifestation of hero Variags of Khand" —
    // the same unique entity, sharing the printed name "Variags of Khand" —
    // the minion player cannot influence it: the name-based in-play uniqueness
    // check (across both players) sees a copy already in play.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [VARIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    // Hero Variags of Khand in the opponent's play area (same unique entity as le-292).
    const withHeroVariags = addCardInPlay(base, 1, HERO_VARIAGS);
    const state = { ...withHeroVariags, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('Manifestation control: influenceable again once no Variags of Khand is in play', () => {
    // Same setup as above but WITHOUT the hero Variags in play — the
    // uniqueness gate no longer fires and the attempt is offered. This pins
    // that the previous block is caused by the manifestation-in-play, not the
    // base setup.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: VARIAG_CAMP, characters: [CIRYAHER] }], hand: [VARIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
  });
});
