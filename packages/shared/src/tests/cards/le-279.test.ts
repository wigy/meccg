/**
 * @module le-279.test
 *
 * Card test: Orcs of the Ash Mountains (le-279)
 * Type: minion-resource-faction (orc, unique, 1 MP, influence # 9)
 *
 * "Unique. Playable at Cirith Gorgor if the influence check is greater than 8.
 *  Once in play, the number required to influence this faction is 0. If this
 *  influence attempt is made by an Orc or Troll leader, you may place this
 *  faction under the control of that leader and not tap the site. Discard the
 *  faction if the leader moves or leaves play. Three or more factions
 *  controlled by the same leader give 2 extra marshalling points.
 *  Standard Modifications: Orcs of the Ephel Dúath (-2), Snaga-hai (+2)."
 *
 * The shared leader-control mechanic is certified in
 * `leader-controlled-factions.test.ts`. The "Orcs of the Ephel Dúath (-2)"
 * modifier is not exercised here because no such card exists in the pool.
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

const ORCS_OF_THE_ASH_MOUNTAINS = 'le-279' as CardDefinitionId;
const SNAGA_HAI = 'le-286' as CardDefinitionId; // +2 Standard Modification

const GRISHNAKH = 'le-12' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;

const CIRITH_GORGOR = 'le-361' as CardDefinitionId; // playable
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // not playable
const CARN_DUM = 'le-359' as CardDefinitionId;

describe('Orcs of the Ash Mountains (le-279)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Cirith Gorgor with baseline need = 9 (DI 0)', () => {
    const state = buildMinionSitePhaseState({ site: CIRITH_GORGOR, characters: [GRISHNAKH], hand: [ORCS_OF_THE_ASH_MOUNTAINS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('+2 modifier applies when controller also has Snaga-hai in play', () => {
    const snaga: CardInPlay = { instanceId: 'sn-1' as CardInstanceId, definitionId: SNAGA_HAI, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [GRISHNAKH] }], hand: [ORCS_OF_THE_ASH_MOUNTAINS], siteDeck: [CARN_DUM], cardsInPlay: [snaga] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(7); // 9 - 2
  });

  test('+2 modifier does NOT apply when only the OPPONENT has Snaga-hai (per-player)', () => {
    const snaga: CardInPlay = { instanceId: 'sn-1' as CardInstanceId, definitionId: SNAGA_HAI, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [GRISHNAKH] }], hand: [ORCS_OF_THE_ASH_MOUNTAINS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [snaga] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(9);
  });

  test('faction is NOT influenceable at a non-playable site (Goblin-gate)', () => {
    const state = buildMinionSitePhaseState({ site: GOBLIN_GATE, characters: [GRISHNAKH], hand: [ORCS_OF_THE_ASH_MOUNTAINS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  test('an Orc Leader is offered the leader-control influence variant', () => {
    const state = buildMinionSitePhaseState({ site: CIRITH_GORGOR, characters: [ORC_CAPTAIN], hand: [ORCS_OF_THE_ASH_MOUNTAINS] });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === captainId);
    expect(attempts.some(a => a.controlWithLeader === true)).toBe(true);
  });

  test('opponent can re-influence Orcs of the Ash Mountains while in play; value = 0', () => {
    const factionInPlay: CardInPlay = { instanceId: 'am-1' as CardInstanceId, definitionId: ORCS_OF_THE_ASH_MOUNTAINS, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [GRISHNAKH] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CIRITH_GORGOR, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };
    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });
});
