/**
 * @module tw-249.test
 *
 * Card test: Great-road (tw-249)
 * Type: hero-resource-event (short)
 * Effects:
 *   1. play-window: end-of-org (organization phase, end-of-org step)
 *   2. play-target: company, filter company.atHaven === true
 *      (only playable on companies currently at a Haven)
 *   3. Opponent may draw up to twice the normal number of cards for this
 *      company during the movement/hazard phase (hazard-draw-multiplier)
 *   4. At the end of the turn, the company may replace its site card with the
 *      Haven card at which it began the turn (haven-return-option)
 *
 * Engine Support:
 * | # | Feature                                      | Status      | Notes                                    |
 * |---|----------------------------------------------|-------------|------------------------------------------|
 * | 1 | Play window = end of organization            | IMPLEMENTED | play-window phase:organization step:end-of-org |
 * | 2 | Restrict to companies at a Haven             | IMPLEMENTED | play-target company filter company.atHaven |
 * | 3 | Opponent draws up to twice normal during M/H | IMPLEMENTED | hazard-draw-multiplier constraint on company-mh-phase |
 * | 4 | Company may return to origin haven at EOT    | IMPLEMENTED | haven-return-option constraint + haven-return action  |
 *
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA,
  handCardId, charIdAt,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  CardInstanceId,
  PlayShortEventAction,
  HavenReturnAction,
} from '../../index.js';
import { CardStatus } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { reduce } from '../../engine/reducer.js';

const GREAT_ROAD = 'tw-249' as CardDefinitionId;

describe('Great-road (tw-249)', () => {
  beforeEach(() => resetMint());

  test('Great-road is playable at end-of-org on a company at a Haven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_ROAD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const greatRoadInstance = handCardId(base, RESOURCE_PLAYER);
    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const grActions = playActions.filter(a => a.cardInstanceId === greatRoadInstance);

    expect(grActions.length).toBeGreaterThan(0);
    // targetScoutInstanceId carries the representative character for the company
    expect(grActions[0].targetScoutInstanceId).toBeDefined();
  });

  test('Great-road is NOT playable when company is not at a Haven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [GREAT_ROAD], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const greatRoadInstance = handCardId(base, RESOURCE_PLAYER);
    const allActions = computeLegalActions(base, PLAYER_1);

    const notPlayable = allActions.filter(ea =>
      !ea.viable && ea.action.type === 'not-playable' && ea.action.cardInstanceId === greatRoadInstance,
    );
    const viable = allActions.filter(ea =>
      ea.viable && ea.action.type === 'play-short-event'
      && (ea.action).cardInstanceId === greatRoadInstance,
    );

    expect(viable.length).toBe(0);
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('Great-road emits one action per haven company when multiple companies exist', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: MORIA, characters: [LEGOLAS] },
          ],
          hand: [GREAT_ROAD],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });

    const greatRoadInstance = handCardId(base, RESOURCE_PLAYER);
    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === greatRoadInstance);

    // Only one action: for the haven company (Rivendell), not the Moria company
    expect(playActions.length).toBe(1);
    const aragornId = charIdAt(base, RESOURCE_PLAYER, 0);
    expect(playActions[0].targetScoutInstanceId).toBe(aragornId);
  });

  test('Playing Great-road adds hazard-draw-multiplier constraint (×2) on the target company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_ROAD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const greatRoadInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornId = charIdAt(base, RESOURCE_PLAYER, 0);

    const { state: after } = reduce(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: greatRoadInstance,
      targetScoutInstanceId: aragornId,
    } as PlayShortEventAction);

    const c = after.activeConstraints.find(c => c.kind.type === 'hazard-draw-multiplier');
    expect(c).toBeDefined();
    expect(c!.kind.type === 'hazard-draw-multiplier' && c!.kind.multiplier).toBe(2);
  });

  test('Playing Great-road records origin haven in haven-return-option constraint', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_ROAD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const greatRoadInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornId = charIdAt(base, RESOURCE_PLAYER, 0);
    const originSite = base.players[0].companies[0].currentSite!;

    const { state: after } = reduce(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: greatRoadInstance,
      targetScoutInstanceId: aragornId,
    } as PlayShortEventAction);

    const c = after.activeConstraints.find(c => c.kind.type === 'haven-return-option');
    expect(c).toBeDefined();
    if (c && c.kind.type === 'haven-return-option') {
      expect(c.kind.originHavenInstanceId).toBe(originSite.instanceId);
      expect(c.kind.originHavenDefinitionId).toBe(originSite.definitionId);
    }
  });

  test('haven-return action is offered during end-of-turn discard step when constraint is active', () => {
    // Play Great-road during org to install constraints
    const org = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_ROAD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const { state: afterPlay } = reduce(org, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: handCardId(org, RESOURCE_PLAYER),
      targetScoutInstanceId: charIdAt(org, RESOURCE_PLAYER, 0),
    } as PlayShortEventAction);

    // Transplant constraints into an EOT state
    const eot = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const eotWithConstraints = {
      ...eot,
      activeConstraints: afterPlay.activeConstraints,
    };

    const actions = computeLegalActions(eotWithConstraints, PLAYER_1);
    const havenReturnActions = actions.filter(ea => ea.viable && ea.action.type === 'haven-return');
    expect(havenReturnActions.length).toBe(1);
  });

  test('haven-return replaces company currentSite with origin haven and consumes constraint', () => {
    // Play Great-road to install constraints
    const org = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_ROAD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const rivendellDefId = org.players[0].companies[0].currentSite!.definitionId;
    const { state: afterPlay } = reduce(org, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: handCardId(org, RESOURCE_PLAYER),
      targetScoutInstanceId: charIdAt(org, RESOURCE_PLAYER, 0),
    } as PlayShortEventAction);

    // Build an EOT state with the company at Moria (simulating movement during M/H)
    const eot = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // Align the site deck's Rivendell instance with the origin haven captured in the constraint,
    // so removeById can find and remove it (same invariant as the real game where the haven
    // instance goes back to the deck when the company moves away from it).
    const originHavenInstId = (afterPlay.activeConstraints.find(
      c => c.kind.type === 'haven-return-option',
    )!.kind as { originHavenInstanceId: CardInstanceId }).originHavenInstanceId;
    const moraInstId = eot.players[0].companies[0].currentSite!.instanceId;
    const eotWithConstraints = {
      ...eot,
      activeConstraints: afterPlay.activeConstraints,
      players: eot.players.map((p, i) => i !== 0 ? p : {
        ...p,
        siteDeck: p.siteDeck.map(c =>
          c.definitionId === RIVENDELL
            ? { ...c, instanceId: originHavenInstId }
            : c,
        ),
      }) as unknown as typeof eot.players,
    };

    const companyId = eotWithConstraints.players[0].companies[0].id;
    const { state: afterReturn } = reduce(eotWithConstraints, {
      type: 'haven-return',
      player: PLAYER_1,
      companyId,
    } as HavenReturnAction);

    // Company is now at the origin haven (Rivendell)
    expect(afterReturn.players[0].companies[0].currentSite?.definitionId).toBe(rivendellDefId);
    expect(afterReturn.players[0].companies[0].siteCardOwned).toBe(true);
    // Rivendell removed from site deck (it became the current site)
    expect(afterReturn.players[0].siteDeck.some(c => c.instanceId === originHavenInstId)).toBe(false);
    // Moria returned to site deck (untapped departure site)
    expect(afterReturn.players[0].siteDeck.some(c => c.instanceId === moraInstId)).toBe(true);
    // Constraint is consumed
    expect(afterReturn.activeConstraints.find(c => c.kind.type === 'haven-return-option')).toBeUndefined();
  });

  test('haven-return discards departure site when it is tapped', () => {
    const org = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_ROAD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const { state: afterPlay } = reduce(org, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: handCardId(org, RESOURCE_PLAYER),
      targetScoutInstanceId: charIdAt(org, RESOURCE_PLAYER, 0),
    } as PlayShortEventAction);

    const eot = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const originHavenInstId = (afterPlay.activeConstraints.find(
      c => c.kind.type === 'haven-return-option',
    )!.kind as { originHavenInstanceId: CardInstanceId }).originHavenInstanceId;
    const moraInstId = eot.players[0].companies[0].currentSite!.instanceId;
    // Mark the current site (Moria) as tapped — company entered the site
    const eotWithTappedSite = {
      ...eot,
      activeConstraints: afterPlay.activeConstraints,
      players: eot.players.map((p, i) => i !== 0 ? p : {
        ...p,
        siteDeck: p.siteDeck.map(c =>
          c.definitionId === RIVENDELL ? { ...c, instanceId: originHavenInstId } : c,
        ),
        companies: p.companies.map((c, ci) => ci === 0
          ? { ...c, currentSite: { ...c.currentSite!, status: CardStatus.Tapped } }
          : c),
      }) as unknown as typeof eot.players,
    };

    const companyId = eotWithTappedSite.players[0].companies[0].id;
    const { state: afterReturn } = reduce(eotWithTappedSite, {
      type: 'haven-return',
      player: PLAYER_1,
      companyId,
    } as HavenReturnAction);

    // Tapped Moria goes to site discard pile
    expect(afterReturn.players[0].siteDiscardPile.some(c => c.instanceId === moraInstId)).toBe(true);
    expect(afterReturn.players[0].siteDeck.some(c => c.instanceId === moraInstId)).toBe(false);
    // Rivendell removed from site deck
    expect(afterReturn.players[0].siteDeck.some(c => c.instanceId === originHavenInstId)).toBe(false);
    // Company is at Rivendell
    expect(afterReturn.players[0].companies[0].currentSite?.definitionId).toBe(RIVENDELL);
  });
});
