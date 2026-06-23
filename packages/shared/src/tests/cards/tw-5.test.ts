/**
 * @module tw-5.test
 *
 * Card test: Ambusher (tw-5)
 * Type: hazard-creature
 * Race: Men. Strikes: 2. Prowess: 10. Keyed to {f}{b} (free OR border region).
 * Effects: 1
 *
 * "Men. Two strikes. Attacker chooses defending characters."
 *
 * The "Men" race and the two-strike count are intrinsic card data handled by
 * the engine (no effect needed). The only special rule is:
 *
 * 1. combat-attacker-chooses-defenders — during strike assignment the
 *    attacker (hazard player) assigns strikes instead of the defender.
 *
 * These tests drive the reducer: play Ambusher as a hazard against a hero
 * company, resolve the chain into combat, and assert the combat uses attacker
 * assignment with two strikes at prowess 10. A normal creature (Orc-patrol) is
 * used as a contrast to confirm the default is defender assignment.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeBorderMHState, makeWildernessMHState,
  resolveChain,
  handCardId, companyIdAt, dispatch,
  viableActions, viableFor, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const AMBUSHER = 'tw-5' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Ambusher (tw-5)', () => {
  beforeEach(() => resetMint());

  /** Build a M/H state where P2 (hazard) holds Ambusher, P1 has a 2-char company. */
  function setupAmbusherCombat() {
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
          hand: [AMBUSHER],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Border site path: Ambusher keys to {f}{b} (free OR border region).
    const gameState = { ...state, phaseState: makeBorderMHState() };

    const ambusherId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ambusherId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'border' },
    });
    return resolveChain(afterPlay);
  }

  test('combat starts with two strikes at prowess 10 and attacker assignment', () => {
    const afterChain = setupAmbusherCombat();

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // attacker-chooses-defenders: a cancel-window precedes attacker assignment.
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    // "Two strikes."
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(10);
  });

  test('attacker (hazard player) assigns strikes; defender does not', () => {
    const afterChain = setupAmbusherCombat();

    // During cancel-window the defender (P1) has only a pass (no cancel cards).
    expect(viableActions(afterChain, PLAYER_1, 'assign-strike')).toHaveLength(0);
    expect(viableActions(afterChain, PLAYER_1, 'pass')).toHaveLength(1);
    // Attacker has nothing to do during the cancel-window.
    expect(viableFor(afterChain, PLAYER_2)).toHaveLength(0);

    // After the defender passes the cancel-window, the attacker assigns.
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    // Attacker may assign each character as a defender (2 characters in company).
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike')).toHaveLength(2);
    // Defender has no assign-strike actions during attacker assignment.
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike')).toHaveLength(0);
  });

  test('contrast: a normal creature (Orc-patrol) uses defender assignment', () => {
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
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Orc-patrol keys to wilderness.
    const gameState = { ...state, phaseState: makeWildernessMHState() };

    const orcId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.combat).not.toBeNull();
    // Default: defender assigns strikes (no attacker-chooses-defenders effect).
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(viableActions(afterChain, PLAYER_1, 'assign-strike').length).toBeGreaterThan(0);
  });
});
