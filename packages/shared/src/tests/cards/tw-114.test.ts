/**
 * @module tw-114.test
 *
 * Card test: Wolves (tw-114)
 * Type: hazard-creature
 * Race: wolves
 * Stats: prowess 8, strikes 3, kill-marshalling-points 1
 * Keyed to: border-land {b} AND wilderness {w} (both must be in the path)
 * Effects: 0 (no special effects)
 *
 * "Wolves. Three strikes."
 *
 * Wolves is a vanilla hazard creature. The race ("wolf") and strike count
 * (3) are base stats — no special effects. The card requires both a
 * border-land and a wilderness region in the company's travel path.
 *
 * Rules covered by tests:
 * 1. Combat initiates with 3 strikes and prowess 8 when played via
 *    border keying (with wilderness also in path).
 * 2. Combat initiates with 3 strikes and prowess 8 when played via
 *    wilderness keying (with border also in path).
 * 3. Defender gets assign-strike actions (no attacker-chooses-defenders).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  companyIdAt,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const WOLVES = 'tw-114' as CardDefinitionId;

const BORDER_KEYING = { method: 'region-type' as const, value: 'border' };
const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };

/** MH state with border-land + wilderness path arriving at a border-hold. */
function makeBorderWildernessMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Border, RegionType.Wilderness],
    resolvedSitePathNames: ['Andrast', 'Rhudaur'],
    destinationSiteType: SiteType.BorderHold,
    destinationSiteName: 'Pelargir',
  });
}

describe('Wolves (tw-114)', () => {
  beforeEach(() => resetMint());

  function baseState() {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WOLVES], siteDeck: [RIVENDELL] },
      ],
    });
  }

  test('combat initiates with 3 strikes and prowess 8 via border keying', () => {
    const ready = { ...baseState(), phaseState: makeBorderWildernessMHState() };

    const wolvesId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wolvesId, companyId, BORDER_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(8);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('combat initiates with 3 strikes and prowess 8 via wilderness keying', () => {
    const ready = { ...baseState(), phaseState: makeBorderWildernessMHState() };

    const wolvesId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wolvesId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });

  test('defender gets assign-strike actions (no attacker-chooses-defenders)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WOLVES], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderWildernessMHState() };

    const wolvesId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wolvesId, companyId, BORDER_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.assignmentPhase).toBe('defender');

    const defenderActions = computeLegalActions(afterChain, PLAYER_1);
    const assignStrikes = defenderActions.filter(a => a.viable && a.action.type === 'assign-strike');
    expect(assignStrikes.length).toBeGreaterThan(0);
  });
});
