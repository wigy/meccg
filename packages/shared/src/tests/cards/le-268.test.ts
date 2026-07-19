/**
 * @module le-268.test
 *
 * Card test: Hill Trolls (le-268)
 * Type: minion-resource-faction (troll, unique, 2 MP, influence # 10)
 *
 * "Unique. Playable at Ettenmoors if the influence check is greater than 9.
 *  Once in play, the number required to influence this faction is 0. If this
 *  influence attempt is made by an Orc or Troll leader, you may place this
 *  faction under the control of that leader and not tap the site. Discard the
 *  faction if the leader moves or leaves play. Three or more factions
 *  controlled by the same leader give 2 extra marshalling points. Standard
 *  Modifications: Stone-trolls (+2)."
 *
 * The shared leader-control mechanic (control placement, no-tap, discard on
 * leader move/leave, +2 MP for three) is certified in master's le-282.test.ts;
 * this file certifies Hill Trolls' card-specific data: the Ettenmoors
 * playability, the baseline influence # of 10 (check > 9), the in-play
 * influence # of 0, the leader-control variant being offered to an Orc/Troll
 * leader, and the "Stone-trolls (+2)" standard modification.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildMinionSitePhaseState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, viableActions, makeSitePhase,
  firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId } from '../../index.js';
import type { InfluenceAttemptAction } from '../../types/actions-site.js';

const HILL_TROLLS = 'le-268' as CardDefinitionId;
const STONE_TROLLS = 'le-288' as CardDefinitionId; // +2 Standard Modification

const GRISHNAKH = 'le-12' as CardDefinitionId;  // orc, no effects, DI 0 (clean influencer)
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // orc, Leader
const LAGDUF = 'le-18' as CardDefinitionId;       // orc warrior (opponent placeholder)

const ETTENMOORS = 'le-373' as CardDefinitionId;    // playable
const CIRITH_GORGOR = 'le-361' as CardDefinitionId; // not a playable site for Hill Trolls
const CARN_DUM = 'le-359' as CardDefinitionId;      // minion haven

describe('Hill Trolls (le-268)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Ettenmoors with baseline need = 10 (DI 0)', () => {
    const state = buildMinionSitePhaseState({ site: ETTENMOORS, characters: [GRISHNAKH], hand: [HILL_TROLLS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('faction is NOT influenceable at a non-playable site (Cirith Gorgor)', () => {
    const state = buildMinionSitePhaseState({ site: CIRITH_GORGOR, characters: [GRISHNAKH], hand: [HILL_TROLLS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  test('+2 modifier applies when controller also has Stone Trolls in play (need 8)', () => {
    const stoneTrolls: CardInPlay = { instanceId: 'st-1' as CardInstanceId, definitionId: STONE_TROLLS, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [GRISHNAKH] }], hand: [HILL_TROLLS], siteDeck: [CARN_DUM], cardsInPlay: [stoneTrolls] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt!.need).toBe(8); // 10 - 2
  });

  test('+2 modifier does NOT apply when only the OPPONENT has Stone Trolls (per-player)', () => {
    const stoneTrolls: CardInPlay = { instanceId: 'st-1' as CardInstanceId, definitionId: STONE_TROLLS, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [GRISHNAKH] }], hand: [HILL_TROLLS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [stoneTrolls] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(10);
  });

  test('an Orc/Troll Leader is offered the leader-control influence variant', () => {
    const state = buildMinionSitePhaseState({ site: ETTENMOORS, characters: [ORC_CAPTAIN], hand: [HILL_TROLLS] });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === captainId);
    expect(attempts.some(a => a.placeUnderLeaderControl === true)).toBe(true);
  });

  test('a non-leader influencer is NOT offered the leader-control variant', () => {
    const state = buildMinionSitePhaseState({ site: ETTENMOORS, characters: [GRISHNAKH], hand: [HILL_TROLLS] });
    const grishId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);
    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === grishId);
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.some(a => a.placeUnderLeaderControl === true)).toBe(false);
  });

  test('opponent can re-influence Hill Trolls while in play; value = 0', () => {
    const factionInPlay: CardInPlay = { instanceId: 'ht-1' as CardInstanceId, definitionId: HILL_TROLLS, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [GRISHNAKH] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: ETTENMOORS, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };
    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });
});
