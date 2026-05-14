/**
 * @module tw-249.test
 *
 * Card test: Great-road (tw-249)
 * Type: hero-resource-event (short)
 * Effects:
 *   1. play-window: end-of-org (organization phase, end-of-org step)
 *   2. play-target: company, filter company.atHaven === true
 *      (only playable on companies currently at a Haven)
 *   3. [NOT IMPLEMENTED] opponent may draw up to twice the normal number of
 *      cards for this company during the movement/hazard phase
 *   4. [NOT IMPLEMENTED] at the end of the turn, the company may replace its
 *      site card with the Haven card at which it began the turn
 *      (considered movement with no movement/hazard phase)
 *
 * Engine Support:
 * | # | Feature                                      | Status          | Notes                                    |
 * |---|----------------------------------------------|-----------------|------------------------------------------|
 * | 1 | Play window = end of organization            | IMPLEMENTED     | play-window phase:organization step:end-of-org |
 * | 2 | Restrict to companies at a Haven             | IMPLEMENTED     | play-target company filter company.atHaven |
 * | 3 | Opponent draws up to twice normal during M/H | NOT IMPLEMENTED | requires hazard-draw-multiplier engine support |
 * | 4 | Company may return to origin haven at EOT    | NOT IMPLEMENTED | requires haven-return end-of-turn action  |
 *
 * NOT CERTIFIED — effects 3 and 4 are not implemented.
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
  PlayShortEventAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

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
        // Aragorn's company is at Moria (a ruins-and-lairs, not a Haven)
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [GREAT_ROAD], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const greatRoadInstance = handCardId(base, RESOURCE_PLAYER);
    const allActions = computeLegalActions(base, PLAYER_1);

    // Card should appear as not-playable (not viable)
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
    // Player has two companies: one at a haven, one at Moria
    // Only the haven company should be eligible
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

  test.todo('opponent draws up to twice the normal number of cards during M/H (not implemented)');

  test.todo('at end of turn, company may replace site card with origin haven (not implemented)');
});
