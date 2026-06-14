/**
 * @module le-262.test
 *
 * Card test: Black Trolls (le-262)
 * Type: minion-resource-faction (troll, unique, 1 MP, influence # 11)
 *
 * "Unique. Playable at Cirith Gorgor or Barad-dûr if the influence check is
 *  greater than 10. Once in play, the number required to influence this faction
 *  is 0. If this influence attempt is made by an Orc or Troll leader, you may
 *  place this faction under the control of that leader and not tap the site.
 *  Discard the faction if the leader moves or leaves play. Three or more
 *  factions controlled by the same leader give 2 extra marshalling points.
 *  Standard Modifications: Morgul Orcs (+2), Orcs of Gundabad (-2)."
 *
 * The shared leader-control mechanic (control placement, no-tap, discard on
 * leader move/leave, +2 MP for three) is certified in
 * master's le-282.test.ts (shared mechanism); this file certifies Black Trolls'
 * card-specific data. The "Morgul Orcs (+2)" modifier is not exercised here
 * because no card named "Morgul Orcs" exists in the pool.
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

const BLACK_TROLLS = 'le-262' as CardDefinitionId;
const ORCS_OF_GUNDABAD = 'le-276' as CardDefinitionId; // -2 Standard Modification

const GRISHNAKH = 'le-12' as CardDefinitionId;  // orc, no effects, DI 0 (clean influencer)
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // orc, Leader
const LAGDUF = 'le-18' as CardDefinitionId;       // orc warrior (opponent placeholder)

const CIRITH_GORGOR = 'le-361' as CardDefinitionId; // playable
const BARAD_DUR = 'le-352' as CardDefinitionId;     // playable
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // not a playable site
const CARN_DUM = 'le-359' as CardDefinitionId;      // minion haven

describe('Black Trolls (le-262)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Cirith Gorgor with baseline need = 11 (DI 0)', () => {
    const state = buildMinionSitePhaseState({ site: CIRITH_GORGOR, characters: [GRISHNAKH], hand: [BLACK_TROLLS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(11);
  });

  test('influence-attempt is also legal at Barad-dûr', () => {
    const state = buildMinionSitePhaseState({ site: BARAD_DUR, characters: [GRISHNAKH], hand: [BLACK_TROLLS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeDefined();
  });

  test('-2 modifier applies when controller also has Orcs of Gundabad in play', () => {
    const gundabad: CardInPlay = { instanceId: 'gund-1' as CardInstanceId, definitionId: ORCS_OF_GUNDABAD, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [GRISHNAKH] }], hand: [BLACK_TROLLS], siteDeck: [CARN_DUM], cardsInPlay: [gundabad] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt!.need).toBe(13); // 11 - (-2)
  });

  test('-2 modifier does NOT apply when only the OPPONENT has Orcs of Gundabad (per-player)', () => {
    const gundabad: CardInPlay = { instanceId: 'gund-1' as CardInstanceId, definitionId: ORCS_OF_GUNDABAD, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [GRISHNAKH] }], hand: [BLACK_TROLLS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [gundabad] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(11);
  });

  test('faction is NOT influenceable at a non-playable site (Goblin-gate)', () => {
    const state = buildMinionSitePhaseState({ site: GOBLIN_GATE, characters: [GRISHNAKH], hand: [BLACK_TROLLS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  test('an Orc Leader is offered the leader-control influence variant', () => {
    const state = buildMinionSitePhaseState({ site: CIRITH_GORGOR, characters: [ORC_CAPTAIN], hand: [BLACK_TROLLS] });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === captainId);
    expect(attempts.some(a => a.placeUnderLeaderControl === true)).toBe(true);
  });

  test('opponent can re-influence Black Trolls while in play; value = 0', () => {
    const factionInPlay: CardInPlay = { instanceId: 'bt-1' as CardInstanceId, definitionId: BLACK_TROLLS, status: CardStatus.Untapped };
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
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });
});
