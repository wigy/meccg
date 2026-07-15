/**
 * @module le-267.test
 *
 * Card test: Half-trolls (le-267)
 * Type: minion-resource-faction (troll, unique, 1 MP, influence # 10)
 *
 * "Unique. Playable at Cirith Ungol or Barad-dûr if the influence check is
 *  greater than 9. Once in play, the number required to influence this faction
 *  is 0. If this influence attempt is made by an Orc or Troll leader, you may
 *  place this faction under the control of that leader and not tap the site.
 *  Discard the faction if the leader moves or leaves play. Three or more
 *  factions controlled by the same leader give 2 extra faction marshalling
 *  points. Standard Modifications: Variags of Khand (+2)."
 *
 * The shared leader-control mechanic (control placement, no-tap, discard on
 * leader move/leave, +2 MP for three controlled factions) is certified on
 * master by le-282.test.ts / le-262.test.ts. This file certifies Half-trolls'
 * card-specific data: the two playable sites (Cirith Ungol, Barad-dûr), the
 * baseline influence need of 10, the "Variags of Khand (+2)" Standard
 * Modification (that named card exists in the pool, so the modifier is
 * exercised end-to-end here — unlike Black Trolls' Morgul Orcs), the
 * in-play re-influence value of 0, and that an Orc leader is offered the
 * leader-control variant.
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

const HALF_TROLLS = 'le-267' as CardDefinitionId;
const VARIAGS_OF_KHAND = 'le-292' as CardDefinitionId; // +2 Standard Modification (name "Variags of Khand")

const GRISHNAKH = 'le-12' as CardDefinitionId;  // orc, no effects, DI 0 (clean influencer)
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // orc, Leader
const LAGDUF = 'le-18' as CardDefinitionId;       // orc warrior (opponent placeholder)

const CIRITH_UNGOL = 'le-362' as CardDefinitionId; // playable
const BARAD_DUR = 'le-352' as CardDefinitionId;    // playable
const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // not a playable site
const CARN_DUM = 'le-359' as CardDefinitionId;     // minion haven

describe('Half-trolls (le-267)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Cirith Ungol with baseline need = 10 (DI 0)', () => {
    const state = buildMinionSitePhaseState({ site: CIRITH_UNGOL, characters: [GRISHNAKH], hand: [HALF_TROLLS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('influence-attempt is also legal at Barad-dûr', () => {
    const state = buildMinionSitePhaseState({ site: BARAD_DUR, characters: [GRISHNAKH], hand: [HALF_TROLLS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeDefined();
  });

  test('+2 modifier applies when controller also has Variags of Khand in play', () => {
    const variags: CardInPlay = { instanceId: 'var-1' as CardInstanceId, definitionId: VARIAGS_OF_KHAND, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_UNGOL, characters: [GRISHNAKH] }], hand: [HALF_TROLLS], siteDeck: [CARN_DUM], cardsInPlay: [variags] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt!.need).toBe(8); // 10 - 2
  });

  test('+2 modifier does NOT apply when only the OPPONENT has Variags of Khand (per-player)', () => {
    const variags: CardInPlay = { instanceId: 'var-1' as CardInstanceId, definitionId: VARIAGS_OF_KHAND, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_UNGOL, characters: [GRISHNAKH] }], hand: [HALF_TROLLS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [variags] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(10);
  });

  test('faction is NOT influenceable at a non-playable site (Goblin-gate)', () => {
    const state = buildMinionSitePhaseState({ site: GOBLIN_GATE, characters: [GRISHNAKH], hand: [HALF_TROLLS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  test('an Orc Leader is offered the leader-control influence variant', () => {
    const state = buildMinionSitePhaseState({ site: CIRITH_UNGOL, characters: [ORC_CAPTAIN], hand: [HALF_TROLLS] });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === captainId);
    expect(attempts.some(a => a.placeUnderLeaderControl === true)).toBe(true);
  });

  test('a non-leader Orc is NOT offered the leader-control variant', () => {
    const state = buildMinionSitePhaseState({ site: CIRITH_UNGOL, characters: [GRISHNAKH], hand: [HALF_TROLLS] });
    const grishId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);
    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === grishId);
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.some(a => a.placeUnderLeaderControl === true)).toBe(false);
  });

  test('opponent can re-influence Half-trolls while in play; value = 0', () => {
    const factionInPlay: CardInPlay = { instanceId: 'ht-1' as CardInstanceId, definitionId: HALF_TROLLS, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_UNGOL, characters: [GRISHNAKH] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CIRITH_UNGOL, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };
    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });
});
