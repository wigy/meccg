/**
 * @module le-281.test
 *
 * Card test: Orcs of the Red Eye (le-281)
 * Type: minion-resource-faction (orc, unique, 1 MP, influence # 9)
 *
 * "Unique. Playable at Barad-dûr if the influence check is greater than 8.
 *  Once in play, the number required to influence this faction is 0. If this
 *  influence attempt is made by an Orc or Troll leader, you may place this
 *  faction under the control of that leader and not tap the site. Discard the
 *  faction if the leader moves or leaves play. Three or more factions
 *  controlled by the same leader give 2 extra marshalling points.
 *  Standard Modifications: Orcs of Mirkwood (-2), Orcs of Udûn (-2),
 *  Uruk-hai (+2)."
 *
 * The shared leader-control mechanic is certified in
 * `leader-controlled-factions.test.ts`; this file certifies the card-specific
 * data (site, influence #, standard modifications, re-influence value).
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

const ORCS_OF_THE_RED_EYE = 'le-281' as CardDefinitionId;
const ORCS_OF_MIRKWOOD = 'le-277' as CardDefinitionId; // -2 Standard Modification
const URUK_HAI = 'le-291' as CardDefinitionId;          // +2 Standard Modification

const GRISHNAKH = 'le-12' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;

const BARAD_DUR = 'le-352' as CardDefinitionId;     // playable
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // not playable
const CARN_DUM = 'le-359' as CardDefinitionId;

describe('Orcs of the Red Eye (le-281)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Barad-dûr with baseline need = 9 (DI 0)', () => {
    const state = buildMinionSitePhaseState({ site: BARAD_DUR, characters: [GRISHNAKH], hand: [ORCS_OF_THE_RED_EYE] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('-2 modifier applies when controller also has Orcs of Mirkwood in play', () => {
    const mirkwood: CardInPlay = { instanceId: 'mw-1' as CardInstanceId, definitionId: ORCS_OF_MIRKWOOD, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [ORCS_OF_THE_RED_EYE], siteDeck: [CARN_DUM], cardsInPlay: [mirkwood] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(11); // 9 - (-2)
  });

  test('+2 modifier applies when controller has Uruk-hai in play', () => {
    const uruk: CardInPlay = { instanceId: 'uh-1' as CardInstanceId, definitionId: URUK_HAI, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [ORCS_OF_THE_RED_EYE], siteDeck: [CARN_DUM], cardsInPlay: [uruk] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(7); // 9 - 2
  });

  test('-2 modifier does NOT apply when only the OPPONENT has Orcs of Mirkwood (per-player)', () => {
    const mirkwood: CardInPlay = { instanceId: 'mw-1' as CardInstanceId, definitionId: ORCS_OF_MIRKWOOD, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [ORCS_OF_THE_RED_EYE], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM], cardsInPlay: [mirkwood] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(9);
  });

  test('faction is NOT influenceable at a non-playable site (Goblin-gate)', () => {
    const state = buildMinionSitePhaseState({ site: GOBLIN_GATE, characters: [GRISHNAKH], hand: [ORCS_OF_THE_RED_EYE] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  test('an Orc Leader is offered the leader-control influence variant', () => {
    const state = buildMinionSitePhaseState({ site: BARAD_DUR, characters: [ORC_CAPTAIN], hand: [ORCS_OF_THE_RED_EYE] });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === captainId);
    expect(attempts.some(a => a.controlWithLeader === true)).toBe(true);
  });

  test('opponent can re-influence Orcs of the Red Eye while in play; value = 0', () => {
    const factionInPlay: CardInPlay = { instanceId: 're-1' as CardInstanceId, definitionId: ORCS_OF_THE_RED_EYE, status: CardStatus.Untapped };
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
