/**
 * @module rule-meas-region-movement-limit
 *
 * MEAS §3 — Region movement spans a maximum of FOUR consecutive regions, or
 * SIX when an effect grants extra region distance. The total is hard-capped at
 * six no matter how much extra distance is granted.
 *
 * Geography (per rule-3.44): from Rivendell (Rhudaur), Moria (Redhorn Gate) is
 * 3 regions away and Minas Tirith (Anórien) is 6 regions away.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardInstanceId, GameState, PlayerState, Company } from '../../index.js';
import { computeLegalActions } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM, HENNETH_ANNUN,
} from '../test-helpers.js';

/** Set a company's extraRegionDistance (no CompanySetup field exposes it). */
function withExtraRegions(state: GameState, extra: number): GameState {
  const company: Company = { ...state.players[0].companies[0], extraRegionDistance: extra };
  const p0: PlayerState = { ...state.players[0], companies: [company] };
  return { ...state, players: [p0, state.players[1]] as [PlayerState, PlayerState] };
}

/** Names of the sites this player's plan-movement actions can reach. */
function reachableSiteNames(state: GameState): string[] {
  return computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.viable && ea.action.type === 'plan-movement')
    .map(ea => {
      const dest = (ea.action as { destinationSite: CardInstanceId }).destinationSite;
      return resolveInstanceId(state, dest) as string;
    });
}

function freshState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MORIA, MINAS_TIRITH, HENNETH_ANNUN, MOUNT_DOOM],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
}

describe('MEAS §3 — Region movement limit (4 / 6)', () => {
  beforeEach(() => resetMint());

  test('at base, a plan beyond 4 regions is rejected', () => {
    const reach = reachableSiteNames(freshState());
    expect(reach).toContain(MORIA as string);          // 3 regions
    expect(reach).not.toContain(MINAS_TIRITH as string); // 6 regions > 4
  });

  test('an extra-region effect lets a 6-region plan through', () => {
    const reach = reachableSiteNames(withExtraRegions(freshState(), 2));
    expect(reach).toContain(MINAS_TIRITH as string); // now reachable at 6
  });

  test('the total is capped at 6 — extra distance beyond +2 never expands reach', () => {
    // Without the cap, +6 extra would reach 7+ region sites (Henneth Annûn /
    // Mount Doom). With the cap, the reachable set at +2 equals the set at +20.
    const atSix = reachableSiteNames(withExtraRegions(freshState(), 2)).sort();
    const atHuge = reachableSiteNames(withExtraRegions(freshState(), 20)).sort();
    expect(atHuge).toEqual(atSix);
    // Mount Doom (Gorgoroth — beyond six regions from Rivendell) stays out of
    // reach no matter how much extra distance is granted.
    expect(atHuge).not.toContain(MOUNT_DOOM as string);
  });
});
