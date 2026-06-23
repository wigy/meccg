/**
 * @module le-288.test
 *
 * Card test: Stone Trolls (le-288)
 * Type: minion-resource-faction (troll, unique, 2 MP, influence # 11)
 *
 * "Unique. Playable at Ettenmoors if the influence check is greater than 10.
 *  Once in play, the number required to influence this faction is 0. If this
 *  influence attempt is made by an Orc or Troll leader, you may place this
 *  faction under the control of that leader and not tap the site. Discard the
 *  faction if the leader moves or leaves play. Three or more factions
 *  controlled by the same leader give 2 extra marshalling points. Standard
 *  Modifications: Black Trolls (+2)."
 *
 * The shared leader-control mechanic (control placement, no-tap, discard on
 * leader move/leave, +2 MP for three) is certified in master's le-282.test.ts;
 * this file certifies Stone Trolls' card-specific data: the Ettenmoors
 * playability, the baseline influence # of 11 (check > 10), the in-play
 * influence # of 0, the leader-control variant being offered to an Orc/Troll
 * leader, and the "Black Trolls (+2)" standard modification.
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

const STONE_TROLLS = 'le-288' as CardDefinitionId;
const BLACK_TROLLS = 'le-262' as CardDefinitionId; // +2 Standard Modification

const GRISHNAKH = 'le-12' as CardDefinitionId;  // orc, no effects, DI 0 (clean influencer)
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // orc, Leader
const LAGDUF = 'le-18' as CardDefinitionId;       // orc warrior (opponent placeholder)

const ETTENMOORS = 'le-373' as CardDefinitionId;    // playable
const CIRITH_GORGOR = 'le-361' as CardDefinitionId; // not a playable site for Stone Trolls
const CARN_DUM = 'le-359' as CardDefinitionId;      // minion haven

describe('Stone Trolls (le-288)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Ettenmoors with baseline need = 11 (DI 0)', () => {
    const state = buildMinionSitePhaseState({ site: ETTENMOORS, characters: [GRISHNAKH], hand: [STONE_TROLLS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(11);
  });

  test('faction is NOT influenceable at a non-playable site (Cirith Gorgor)', () => {
    const state = buildMinionSitePhaseState({ site: CIRITH_GORGOR, characters: [GRISHNAKH], hand: [STONE_TROLLS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  test('+2 modifier applies when controller also has Black Trolls in play (need 9)', () => {
    const blackTrolls: CardInPlay = { instanceId: 'bt-1' as CardInstanceId, definitionId: BLACK_TROLLS, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [GRISHNAKH] }], hand: [STONE_TROLLS], siteDeck: [CARN_DUM], cardsInPlay: [blackTrolls] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt!.need).toBe(9); // 11 - 2
  });

  test('+2 modifier does NOT apply when only the OPPONENT has Black Trolls (per-player)', () => {
    const blackTrolls: CardInPlay = { instanceId: 'bt-1' as CardInstanceId, definitionId: BLACK_TROLLS, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [GRISHNAKH] }], hand: [STONE_TROLLS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [blackTrolls] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(11);
  });

  test('an Orc/Troll Leader is offered the leader-control influence variant', () => {
    const state = buildMinionSitePhaseState({ site: ETTENMOORS, characters: [ORC_CAPTAIN], hand: [STONE_TROLLS] });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === captainId);
    expect(attempts.some(a => a.placeUnderLeaderControl === true)).toBe(true);
  });

  test('a non-leader influencer is NOT offered the leader-control variant', () => {
    const state = buildMinionSitePhaseState({ site: ETTENMOORS, characters: [GRISHNAKH], hand: [STONE_TROLLS] });
    const grishId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);
    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === grishId);
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.some(a => a.placeUnderLeaderControl === true)).toBe(false);
  });

  test('opponent can re-influence Stone Trolls while in play; value = 0', () => {
    const factionInPlay: CardInPlay = { instanceId: 'st-1' as CardInstanceId, definitionId: STONE_TROLLS, status: CardStatus.Untapped };
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
