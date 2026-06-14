/**
 * @module leader-controlled-factions.test
 *
 * Engine mechanic test: Lidless-Eye "leader-controlled" factions.
 *
 * Six LE minion factions (le-262 Black Trolls, le-275 Orcs of Gorgoroth,
 * le-279 Orcs of the Ash Mountains, le-281 Orcs of the Red Eye, le-282 Orcs of
 * Udûn, le-291 Uruk-hai) share a defining sub-rule:
 *
 *   "If this influence attempt is made by an Orc or Troll leader, you may place
 *    this faction under the control of that leader and not tap the site.
 *    Discard the faction if the leader moves or leaves play. Three or more
 *    factions controlled by the same leader give 2 extra marshalling points."
 *
 * The capability is carried by the `leader-controllable` play-flag on each
 * faction; the engine keys all of the behaviour below off that flag.
 *
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Orc/Troll Leader is offered a "place under leader control" influence variant | IMPLEMENTED |
 * | 2 | A non-Leader (or non-flagged faction) is NOT offered the variant             | IMPLEMENTED |
 * | 3 | Successful control placement records `controlledBy` and does NOT tap the site | IMPLEMENTED |
 * | 4 | A normal (non-control) success taps the site and records no controller        | IMPLEMENTED |
 * | 5 | Three or more factions controlled by one leader give +2 marshalling points    | IMPLEMENTED |
 * | 6 | A controlled faction is discarded when its leader leaves play                  | IMPLEMENTED |
 * | 7 | A controlled faction is discarded when its leader's company moves              | IMPLEMENTED |
 *
 * Note: every Leader-keyword character in the card pool is Orc or Troll, so the
 * "Orc or Troll" race half of the gate cannot be exercised with a contrary
 * fixture; the keyword half is covered by test #2.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildMinionSitePhaseState, resetMint,
  Phase, CardStatus, makeMHState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, viableActions, dispatch, resolveChain,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { sweepLeaderControlledFactions } from '../../engine/reducer-utils.js';
import { RegionType } from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, GameState,
} from '../../index.js';
import type { InfluenceAttemptAction } from '../../types/actions-site.js';

const ORCS_OF_THE_ASH_MOUNTAINS = 'le-279' as CardDefinitionId; // leader-controllable, Cirith Gorgor, inf 9
const ORCS_OF_UDUN = 'le-282' as CardDefinitionId;               // leader-controllable, Cirith Gorgor, inf 9
const BLACK_TROLLS = 'le-262' as CardDefinitionId;               // leader-controllable, troll, inf 11

const ORC_CAPTAIN = 'le-31' as CardDefinitionId;          // orc, Leader, DI 0
const LIEUTENANT_DOL_GULDUR = 'le-21' as CardDefinitionId; // troll, Leader, DI 3
const GRISHNAKH = 'le-12' as CardDefinitionId;            // orc, NOT a Leader, DI 0
const LAGDUF = 'le-18' as CardDefinitionId;               // orc warrior (opponent placeholder)

const CIRITH_GORGOR = 'le-361' as CardDefinitionId; // dark-hold (Ash Mountains / Udûn playable here)
const BARAD_DUR = 'le-352' as CardDefinitionId;     // dark-hold
const CARN_DUM = 'le-359' as CardDefinitionId;      // minion haven

const factionAttempts = (state: GameState): InfluenceAttemptAction[] =>
  viableActions(state, PLAYER_1, 'influence-attempt').map(a => a.action as InfluenceAttemptAction);

describe('Leader-controlled factions (le-262/275/279/281/282/291)', () => {
  beforeEach(() => resetMint());

  test('an Orc Leader is offered both a normal and a leader-control influence variant', () => {
    const state = buildMinionSitePhaseState({
      site: CIRITH_GORGOR,
      characters: [ORC_CAPTAIN],
      hand: [ORCS_OF_THE_ASH_MOUNTAINS],
    });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const attempts = factionAttempts(state).filter(a => a.influencingCharacterId === captainId);

    expect(attempts.some(a => !a.controlWithLeader)).toBe(true);
    expect(attempts.some(a => a.controlWithLeader === true)).toBe(true);
  });

  test('a Troll Leader is also offered the leader-control variant', () => {
    const state = buildMinionSitePhaseState({
      site: BARAD_DUR,
      characters: [LIEUTENANT_DOL_GULDUR],
      hand: [BLACK_TROLLS],
    });
    const ltId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const attempts = factionAttempts(state).filter(a => a.influencingCharacterId === ltId);

    expect(attempts.some(a => a.controlWithLeader === true)).toBe(true);
  });

  test('a non-Leader Orc is NOT offered the leader-control variant', () => {
    const state = buildMinionSitePhaseState({
      site: CIRITH_GORGOR,
      characters: [GRISHNAKH],
      hand: [ORCS_OF_THE_ASH_MOUNTAINS],
    });
    const grishId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);
    const attempts = factionAttempts(state).filter(a => a.influencingCharacterId === grishId);

    // Still influenceable normally, but with no leader-control option.
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.some(a => a.controlWithLeader === true)).toBe(false);
  });

  test('successful leader-control places the faction under the leader and does NOT tap the site', () => {
    const state = buildMinionSitePhaseState({
      site: CIRITH_GORGOR,
      characters: [ORC_CAPTAIN],
      hand: [ORCS_OF_THE_ASH_MOUNTAINS],
    });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const controlAction = factionAttempts(state).find(
      a => a.controlWithLeader === true && a.influencingCharacterId === captainId,
    )!;
    expect(controlAction).toBeDefined();

    const afterDeclare = dispatch(state, controlAction);
    const afterChain = resolveChain(afterDeclare);
    // The chain enqueues a pending faction-influence-roll; dispatch it with a
    // forced successful roll (2d6 = 12 >> influence # 9).
    const rollAction = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const resolved = dispatch({ ...afterChain, cheatRollTotal: 12 }, rollAction);

    const inPlay = resolved.players[0].cardsInPlay.find(c => c.definitionId === ORCS_OF_THE_ASH_MOUNTAINS);
    expect(inPlay).toBeDefined();
    expect(inPlay!.controlledBy).toBe(captainId);
    expect(inPlay!.instanceId).toBe(factionInstanceId);
    // The site is left untapped because the faction was placed under control.
    expect(resolved.players[0].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
  });

  test('a normal (non-control) success taps the site and records no controller', () => {
    const state = buildMinionSitePhaseState({
      site: CIRITH_GORGOR,
      characters: [ORC_CAPTAIN],
      hand: [ORCS_OF_THE_ASH_MOUNTAINS],
    });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const normalAction = factionAttempts(state).find(
      a => !a.controlWithLeader && a.influencingCharacterId === captainId,
    )!;

    const afterDeclare = dispatch(state, normalAction);
    const afterChain = resolveChain(afterDeclare);
    const rollAction = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const resolved = dispatch({ ...afterChain, cheatRollTotal: 12 }, rollAction);

    const inPlay = resolved.players[0].cardsInPlay.find(c => c.definitionId === ORCS_OF_THE_ASH_MOUNTAINS);
    expect(inPlay).toBeDefined();
    expect(inPlay!.controlledBy).toBeUndefined();
    // A normal influence success taps the site (CoE 6.11).
    expect(resolved.players[0].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
  });

  test('a leader controlling three factions gives +2 marshalling points (faction category)', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const captainId = findCharInstanceId(built, RESOURCE_PLAYER, ORC_CAPTAIN);
    const mk = (id: string, def: CardDefinitionId, leader: CardInstanceId): CardInPlay => ({
      instanceId: id as CardInstanceId, definitionId: def, status: CardStatus.Untapped, controlledBy: leader,
    });

    // Three 1-MP factions under one leader: 3 base + 2 bonus = 5.
    const three = recomputeDerived({
      ...built,
      players: [
        { ...built.players[0], cardsInPlay: [
          mk('f1', ORCS_OF_THE_ASH_MOUNTAINS, captainId),
          mk('f2', ORCS_OF_UDUN, captainId),
          mk('f3', BLACK_TROLLS, captainId),
        ] },
        built.players[1],
      ] as unknown as typeof built.players,
    });
    expect(three.players[0].marshallingPoints.faction).toBe(5);

    // Only two under the leader: 2 base, no bonus.
    const two = recomputeDerived({
      ...built,
      players: [
        { ...built.players[0], cardsInPlay: [
          mk('f1', ORCS_OF_THE_ASH_MOUNTAINS, captainId),
          mk('f2', ORCS_OF_UDUN, captainId),
        ] },
        built.players[1],
      ] as unknown as typeof built.players,
    });
    expect(two.players[0].marshallingPoints.faction).toBe(2);

    // Three factions split 2/1 across two leaders: no group reaches three, no bonus.
    const split = recomputeDerived({
      ...built,
      players: [
        { ...built.players[0], cardsInPlay: [
          mk('f1', ORCS_OF_THE_ASH_MOUNTAINS, captainId),
          mk('f2', ORCS_OF_UDUN, captainId),
          mk('f3', BLACK_TROLLS, 'other-leader' as CardInstanceId),
        ] },
        built.players[1],
      ] as unknown as typeof built.players,
    });
    expect(split.players[0].marshallingPoints.faction).toBe(3);
  });

  test('a controlled faction is discarded when its leader leaves play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CIRITH_GORGOR, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const captainId = findCharInstanceId(built, RESOURCE_PLAYER, ORC_CAPTAIN);
    const faction: CardInPlay = {
      instanceId: 'ctrl-1' as CardInstanceId, definitionId: ORCS_OF_THE_ASH_MOUNTAINS,
      status: CardStatus.Untapped, controlledBy: captainId,
    };

    // Leader still in play → the sweep keeps the faction.
    const withLeader = { ...built, players: [{ ...built.players[0], cardsInPlay: [faction] }, built.players[1]] as unknown as typeof built.players };
    expect(sweepLeaderControlledFactions(withLeader).players[0].cardsInPlay).toHaveLength(1);

    // Leader has left play (no longer a key in `characters`) → faction discarded.
    const ghostFaction: CardInPlay = { ...faction, controlledBy: 'ghost-leader' as CardInstanceId };
    const orphaned = { ...built, players: [{ ...built.players[0], cardsInPlay: [ghostFaction] }, built.players[1]] as unknown as typeof built.players };
    const swept = sweepLeaderControlledFactions(orphaned);
    expect(swept.players[0].cardsInPlay.some(c => c.definitionId === ORCS_OF_THE_ASH_MOUNTAINS)).toBe(false);
    expect(swept.players[0].discardPile.some(c => c.definitionId === ORCS_OF_THE_ASH_MOUNTAINS)).toBe(true);
  });

  test('a controlled faction is discarded when its leader’s company moves', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BARAD_DUR, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [CIRITH_GORGOR] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [] },
      ],
    });
    const captainId = findCharInstanceId(built, RESOURCE_PLAYER, ORC_CAPTAIN);
    const company = built.players[0].companies[0];
    const dest = built.players[0].siteDeck.find(c => c.definitionId === CIRITH_GORGOR)!;
    const faction: CardInPlay = {
      instanceId: 'ctrl-1' as CardInstanceId, definitionId: ORCS_OF_THE_ASH_MOUNTAINS,
      status: CardStatus.Untapped, controlledBy: captainId,
    };

    const withMove: GameState = {
      ...built,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resolvedSitePath: [RegionType.Wilderness],
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
      players: [
        {
          ...built.players[0],
          companies: [{
            ...company,
            siteCardOwned: true,
            destinationSite: { instanceId: dest.instanceId, definitionId: dest.definitionId, status: CardStatus.Untapped },
          }],
          cardsInPlay: [faction],
        },
        built.players[1],
      ] as unknown as typeof built.players,
    };

    // Pass both players to resolve the company's movement to Cirith Gorgor.
    const afterPass1 = dispatch(withMove, { type: 'pass', player: PLAYER_1 });
    const after = dispatch(afterPass1, { type: 'pass', player: PLAYER_2 });

    expect(after.players[0].companies[0].currentSite?.definitionId).toBe(CIRITH_GORGOR);
    expect(after.players[0].cardsInPlay.some(c => c.definitionId === ORCS_OF_THE_ASH_MOUNTAINS)).toBe(false);
    expect(after.players[0].discardPile.some(c => c.definitionId === ORCS_OF_THE_ASH_MOUNTAINS)).toBe(true);
  });
});
