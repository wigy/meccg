/**
 * @module td-84.test
 *
 * Card test: Winged Fire-drake (td-84)
 * Type: hazard-creature (Drake)
 *
 * Text:
 *   "Drake. Two strikes. Attacker chooses defending characters."
 *
 * Base stats: strikes 2, prowess 12, body — (no body check), kill MP 1.
 * Playable: {w}{w}{w} or {s}{s} — three Wilderness OR two Shadow-land
 * regions in the site path.
 *
 * Effects:
 * | # | Effect Type                       | Status | Notes                            |
 * |---|-----------------------------------|--------|-----------------------------------|
 * | 1 | combat-attacker-chooses-defenders | OK     | Cancel-window before assignment  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, RegionType, SiteType,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const WINGED_FIRE_DRAKE = 'td-84' as CardDefinitionId;

/** MH state resolved through three wilderness regions, targeting a ruins/lairs site. */
function mhInWilderness(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Rhudaur', 'Arthedain', 'Cardolan'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Some Lair',
  });
}

describe('Winged Fire-drake (td-84)', () => {
  beforeEach(() => resetMint());

  test('combat starts with cancel-window (attacker-chooses-defenders), 2 strikes at 12', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [WINGED_FIRE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInWilderness() };

    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId,
      { method: 'region-type' as const, value: 'wilderness' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // attacker-chooses-defenders: cancel window precedes attacker assignment
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(12);
    expect(afterChain.combat!.creatureBody).toBe(null);
    expect(afterChain.combat!.creatureRace).toBe('drake');
  });

  test('attacker (not defender) gets assign-strike actions after cancel-window pass', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [WINGED_FIRE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInWilderness() };

    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId,
      { method: 'region-type' as const, value: 'wilderness' },
    );

    // Defender (P1) has no assign-strike during cancel-window (attacker chooses)
    expect(viableActions(afterChain, PLAYER_1, 'assign-strike')).toHaveLength(0);

    // After defender passes the cancel-window, attacker (P2) gets assignment.
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThan(0);
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike')).toHaveLength(0);
  });

  /** Build an M/H state for the drake's player with the given site path. */
  function keyingState(path: RegionType[], names: string[]): GameState {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [WINGED_FIRE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: path,
      resolvedSitePathNames: names,
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    return { ...state, phaseState: mh };
  }

  function keyedVia(state: GameState, rt: RegionType): boolean {
    return viableActions(state, PLAYER_2, 'play-hazard').some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === rt;
    });
  }

  test('keyable via wilderness when path has three wildernesses', () => {
    const ready = keyingState(
      [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
      ['Rhudaur', 'Arthedain', 'Cardolan'],
    );
    expect(keyedVia(ready, RegionType.Wilderness)).toBe(true);
  });

  test('NOT keyable when path has only two wildernesses (regression)', () => {
    // Bug report (game muhat0ke-6mn56v): the drake was played against a
    // company moving through two Wilderness regions; the card requires
    // {w}{w}{w}.
    const ready = keyingState(
      [RegionType.Wilderness, RegionType.Wilderness],
      ['Rhudaur', 'Arthedain'],
    );
    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
  });

  test('keyable via shadow-land when path has two shadow-lands', () => {
    const ready = keyingState(
      [RegionType.Shadow, RegionType.Shadow],
      ['Imlad Morgul', 'Gorgoroth'],
    );
    expect(keyedVia(ready, RegionType.Shadow)).toBe(true);
  });

  test('NOT keyable in a single shadow-land', () => {
    const ready = keyingState([RegionType.Shadow], ['Imlad Morgul']);
    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
