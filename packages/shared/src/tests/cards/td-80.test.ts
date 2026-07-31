/**
 * @module td-80.test
 *
 * Card test: Were-worm (td-80)
 * Type: hazard-creature (Drake), non-unique.
 * Strikes: 1, Prowess: 13, Body: 6, kill MP 2.
 * Keyed to `{w}` — one Wilderness in the site path.
 *
 * Card text: "Drake. One strike. Attacker chooses defending characters.
 * Defending company must discard one item of attacker's choice for each
 * character wounded by Were-worm."
 *
 * Rule coverage:
 *
 * | # | Rule                                   | Mechanism                                          |
 * |---|-----------------------------------------|-----------------------------------------------------|
 * | 1 | One strike at 13 prowess, body 6        | printed stats → CombatState                        |
 * | 2 | Attacker chooses defending characters   | combat-attacker-chooses-defenders (cancel-window)   |
 *
 * Rule 3 (discard an item per wounded character) is not yet certified.
 *
 * Playable: PARTIAL (rule 2 fixed by this test; rule 3 outstanding)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch,
  viableActions, viableFor,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const WERE_WORM = 'td-80' as CardDefinitionId;

describe('Were-worm (td-80)', () => {
  beforeEach(() => resetMint());

  test('combat opens in the cancel-window with 1 strike at 13 prowess, body 6', () => {
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
          hand: [WERE_WORM],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const wormId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, wormId, companyId,
      { method: 'region-type' as const, value: 'wilderness' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // attacker-chooses-defenders opens a cancel-window before assignment
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.combat!.attackerChoosesDefenders).toBe(true);
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(13);
    expect(afterChain.combat!.creatureBody).toBe(6);
    expect(afterChain.combat!.creatureRace).toBe('drake');
  });

  test('the hazard player (attacker) assigns the strike, the defender does not', () => {
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
          hand: [WERE_WORM],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const wormId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, wormId, companyId,
      { method: 'region-type' as const, value: 'wilderness' },
    );

    // Cancel-window: defender may only pass; attacker has nothing to do yet.
    expect(viableActions(afterChain, PLAYER_1, 'assign-strike')).toHaveLength(0);
    expect(viableFor(afterChain, PLAYER_2)).toHaveLength(0);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThan(0);
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike')).toHaveLength(0);
  });
});
