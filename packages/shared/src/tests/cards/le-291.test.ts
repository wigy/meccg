/**
 * @module le-291.test
 *
 * Card test: Uruk-hai (le-291)
 * Type: minion-resource-faction (orc, unique, 2 MP, influence # 12)
 *
 * "Unique. Playable at Barad-dûr, Cirith Gorgor, or Cirith Ungol if the
 *  influence check is greater than 11. Once in play, the number required to
 *  influence this faction is 0. If this influence attempt is made by an Orc or
 *  Troll leader, you may place this faction under the control of that leader
 *  and not tap the site. Discard the faction if the leader moves or leaves
 *  play. Three or more factions controlled by the same leader give 2 extra
 *  marshalling points. Standard Modifications: Any other Orc faction
 *  (-2; applied only once)."
 *
 * The "Any other Orc faction (-2)" modifier is generic: it applies whenever the
 * controller has at least one Orc faction in play, regardless of which one, via
 * the `controller.factionRaces` resolver context. Because a single check-
 * modifier contributes its value once, the "applied only once" wording is
 * satisfied even with several Orc factions in play. The shared leader-control
 * mechanic is certified in master's le-282.test.ts (shared mechanism).
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

const URUK_HAI = 'le-291' as CardDefinitionId;
const ORCS_OF_GORGOROTH = 'le-275' as CardDefinitionId; // an Orc faction (triggers -2)
const ORCS_OF_UDUN = 'le-282' as CardDefinitionId;      // another Orc faction

const GRISHNAKH = 'le-12' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;

const BARAD_DUR = 'le-352' as CardDefinitionId;     // playable
const CIRITH_GORGOR = 'le-361' as CardDefinitionId; // playable
const CIRITH_UNGOL = 'le-362' as CardDefinitionId;  // playable
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // not playable
const CARN_DUM = 'le-359' as CardDefinitionId;

describe('Uruk-hai (le-291)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Barad-dûr with baseline need = 12 (DI 0)', () => {
    const state = buildMinionSitePhaseState({ site: BARAD_DUR, characters: [GRISHNAKH], hand: [URUK_HAI] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(12);
  });

  test('influence-attempt is also legal at Cirith Gorgor and Cirith Ungol', () => {
    for (const site of [CIRITH_GORGOR, CIRITH_UNGOL]) {
      const state = buildMinionSitePhaseState({ site, characters: [GRISHNAKH], hand: [URUK_HAI] });
      const factionInstanceId = state.players[0].hand[0].instanceId;
      expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeDefined();
    }
  });

  test('-2 modifier applies once when controller has another Orc faction in play', () => {
    const gorg: CardInPlay = { instanceId: 'gor-1' as CardInstanceId, definitionId: ORCS_OF_GORGOROTH, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [URUK_HAI], siteDeck: [CARN_DUM], cardsInPlay: [gorg] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(14); // 12 - (-2)
  });

  test('-2 modifier is applied only ONCE even with several Orc factions in play', () => {
    const gorg: CardInPlay = { instanceId: 'gor-1' as CardInstanceId, definitionId: ORCS_OF_GORGOROTH, status: CardStatus.Untapped };
    const udun: CardInPlay = { instanceId: 'udun-1' as CardInstanceId, definitionId: ORCS_OF_UDUN, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [URUK_HAI], siteDeck: [CARN_DUM], cardsInPlay: [gorg, udun] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(14); // still 12 - (-2), not -4
  });

  test('-2 modifier does NOT apply when only the OPPONENT has an Orc faction (per-player)', () => {
    const gorg: CardInPlay = { instanceId: 'gor-1' as CardInstanceId, definitionId: ORCS_OF_GORGOROTH, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [URUK_HAI], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [gorg] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(12);
  });

  test('faction is NOT influenceable at a non-playable site (Goblin-gate)', () => {
    const state = buildMinionSitePhaseState({ site: GOBLIN_GATE, characters: [GRISHNAKH], hand: [URUK_HAI] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  test('an Orc Leader is offered the leader-control influence variant', () => {
    const state = buildMinionSitePhaseState({ site: BARAD_DUR, characters: [ORC_CAPTAIN], hand: [URUK_HAI] });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === captainId);
    expect(attempts.some(a => a.placeUnderLeaderControl === true)).toBe(true);
  });

  test('opponent can re-influence Uruk-hai while in play; value = 0', () => {
    const factionInPlay: CardInPlay = { instanceId: 'uh-1' as CardInstanceId, definitionId: URUK_HAI, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };
    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });
});
