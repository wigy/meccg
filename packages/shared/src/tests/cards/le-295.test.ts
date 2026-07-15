/**
 * @module le-295.test
 *
 * Card test: Woodmen (le-295)
 * Type: minion-resource-faction (ringwraith, unique, 3 MP, influence # 11, race Man)
 *
 * "Unique. Manifestation of hero Woodmen. Playable at Woodmen-town if the
 *  influence check is greater than 10."
 *
 * There are no DSL effects. All rules are enforced by structural faction
 * engine support:
 *   - `playableAt.site` restricts influence attempts to Woodmen-town (le-414).
 *   - `influenceNumber: 11` sets the threshold — need = 11 - DI, so a check
 *     result "greater than 10" (i.e. ≥ 11) succeeds.
 *   - "Manifestation of hero Woodmen" makes this card and the hero-side
 *     Woodmen faction (tw-368) the same unique entity. Because both cards
 *     carry the identical printed name "Woodmen", the engine's name-based
 *     in-play uniqueness check (`countCopiesInPlay`, scanning both players)
 *     already treats them as one unique faction: if either manifestation is
 *     in play anywhere in the game, the other cannot be influenced.
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                            |
 * |---|------------------------------------------------------|-------------|----------------------------------|
 * | 1 | Playable only at Woodmen-town                        | IMPLEMENTED | `playableAt.site` match          |
 * | 2 | Influence # 11 (greater than 10)                     | IMPLEMENTED | shared faction-influence machine |
 * | 3 | Manifestation shares uniqueness with hero Woodmen    | IMPLEMENTED | name-based `countCopiesInPlay`   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase, addCardInPlay,
  firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const WOODMEN = 'le-295' as CardDefinitionId;             // minion Woodmen faction (this card)
const HERO_WOODMEN = 'tw-368' as CardDefinitionId;        // hero Woodmen faction — same unique entity

// Minion fixtures — declared locally per CLAUDE.md card-ids policy.
const CIRYAHER = 'le-6' as CardDefinitionId;              // dúnadan, DI 2, no relevant effects
const LAGDUF = 'le-18' as CardDefinitionId;               // orc warrior, DI 0, no relevant effects
const WOODMEN_TOWN = 'le-414' as CardDefinitionId;        // border-hold, Western Mirkwood, nearest Dol Guldur
const DOL_GULDUR = 'le-367' as CardDefinitionId;          // minion haven (opponent / site-deck filler)
const CARN_DUM = 'le-359' as CardDefinitionId;            // minion haven (site-deck filler)
const MORIA = 'le-392' as CardDefinitionId;               // shadow-hold (not Woodmen-town)

describe('Woodmen (le-295)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Woodmen-town with need = 9 (11 - DI 2)', () => {
    // Ciryaher (DI 2) at Woodmen-town with Woodmen in hand.
    // need = influenceNumber(11) - DI(2) = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WOODMEN_TOWN, characters: [CIRYAHER] }], hand: [WOODMEN], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('influence-attempt uses Ciryaher as the influencing character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WOODMEN_TOWN, characters: [CIRYAHER] }], hand: [WOODMEN], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(ciryaherId);
  });

  test('faction is NOT influenceable at a site other than Woodmen-town', () => {
    // Same company at Moria (a shadow-hold, but not Woodmen-town).
    // The playableAt restriction must disqualify the faction entirely.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [WOODMEN], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('Manifestation: not influenceable while hero Woodmen (tw-368) is already in play', () => {
    // The opponent (a hero player) already has the hero Woodmen faction in
    // play. Because minion Woodmen is a "Manifestation of hero Woodmen" — the
    // same unique entity, sharing the printed name "Woodmen" — the minion
    // player cannot influence it: the name-based in-play uniqueness check
    // (across both players) sees a copy already in play.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WOODMEN_TOWN, characters: [CIRYAHER] }], hand: [WOODMEN], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    // Hero Woodmen in the opponent's play area (same unique entity as le-295).
    const withHeroWoodmen = addCardInPlay(base, 1, HERO_WOODMEN);
    const state = { ...withHeroWoodmen, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('Manifestation control: influenceable again once no Woodmen is in play', () => {
    // Same setup as above but WITHOUT the hero Woodmen in play — the
    // uniqueness gate no longer fires and the attempt is offered. This pins
    // that test 4's block is caused by the manifestation-in-play, not by the
    // base setup.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WOODMEN_TOWN, characters: [CIRYAHER] }], hand: [WOODMEN], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
  });
});
