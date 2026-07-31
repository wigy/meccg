/**
 * @module td-80.test
 *
 * Card test: Were-worm (td-80)
 * Type: hazard-creature (Drake)
 *
 * Text:
 *   "Drake. One strike. Attacker chooses defending characters. Defending
 *    company must discard one item of attacker's choice for each character
 *    wounded by Were-worm."
 *
 * Base stats: strikes 1, prowess 13, body 6, kill MP 2, race Drake,
 * non-unique.
 *
 * keyedTo (canonical playable "{w}{w}{w}" from data/cards.json TD-80):
 * | # | Entry                                             | Notes                   |
 * |---|---------------------------------------------------|-------------------------|
 * | 1 | regionTypes: [wilderness, wilderness, wilderness] | base keying ({w}{w}{w}) |
 *
 * A region type repeated N times within one `keyedTo` entry requires at
 * least N regions of that type in the company's resolved site path
 * (`regionTypesMatch`), so Were-worm demands three wildernesses.
 *
 * Regression: bug report d1c96687b3f8ea3d — Were-worm (and several other
 * multi-wilderness TD/LE creatures) was encoded with a single wilderness in
 * `keyedTo`, letting it be played on any one-wilderness site path.
 *
 * Playable: YES (keying + base attack; the wound-triggered item discard is
 * not yet certified)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeDoubleWildernessMHState, makeWildernessMHState, makeTripleWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const WERE_WORM = 'td-80' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };

function baseStateWithHazardInHand() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [WERE_WORM],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Were-worm (td-80)', () => {
  beforeEach(() => resetMint());

  // ─── Keying: three wildernesses in the site path are required ─────────────

  test('NOT playable on a single-wilderness path (cost is {w}{w}{w})', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('NOT playable on a two-wilderness path', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('playable on a three-wilderness path', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeTripleWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  // ─── Base stats: one strike at prowess 13, drake, body 6 ──────────────────

  test('attack uses 1 strike at prowess 13 with drake race and body 6', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeTripleWildernessMHState() };
    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId, WILDERNESS_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(13);
    expect(after.combat!.creatureRace).toBe('drake');
    expect(after.combat!.creatureBody).toBe(6);
  });
});
