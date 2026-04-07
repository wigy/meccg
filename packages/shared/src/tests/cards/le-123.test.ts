/**
 * @module le-123.test
 *
 * Card test: Lure of Nature (le-123)
 * Type: hazard-event (permanent, character-targeting)
 * Effects: 5 (play-target character with targetFilter, duplication-limit scope:character max:1,
 *             stat-modifier corruption-points +2, on-event end-of-mh-phase-per-wilderness,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:5)
 *
 * "Corruption. Playable on a non-Hobbit, non-Dwarf, non-Orc, non-Ringwraith character.
 *  Target character receives 2 corruption points and makes a corruption check at the end
 *  of his movement/hazard phase for each Wilderness [{w}] in his company's site path.
 *  During his organization phase, the character may tap to attempt to remove this card.
 *  Make a roll--if the result is greater than 4, discard this card. Cannot be duplicated
 *  on a given character."
 *
 * Engine Support:
 * | # | Feature                             | Status      | Notes                                  |
 * |---|-------------------------------------|-------------|----------------------------------------|
 * | 1 | Play from hand targeting non-H/D/O/R | IMPLEMENTED | play-target with targetFilter           |
 * | 2 | +2 corruption points                 | IMPLEMENTED | stat-modifier corruption-points         |
 * | 3 | Corruption check per Wilderness      | IMPLEMENTED | on-event end-of-mh-phase-per-wilderness |
 * | 4 | Tap to attempt removal (roll>4)      | IMPLEMENTED | grant-action remove-self-on-roll        |
 * | 5 | Cannot be duplicated on character    | IMPLEMENTED | duplication-limit scope:character       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce, makeMHState,
  attachHazardToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO, GIMLI,
  LURE_OF_NATURE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, CardStatus,
} from '../test-helpers.js';
import type { PlayHazardAction, ActivateGrantedAction, MovementHazardPhaseState } from '../../index.js';
import { RegionType } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Lure of Nature (le-123)', () => {
  beforeEach(() => resetMint());

  test('played from hand targets non-Hobbit, non-Dwarf characters only', () => {
    // Aragorn (dunadan) and Bilbo (hobbit) in target company
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [LURE_OF_NATURE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...state, phaseState: makeMHState() };

    const playActions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const targets = playActions.map(
      ea => (ea.action as PlayHazardAction).targetCharacterId,
    );

    // Aragorn (dunadan) should be targetable, Bilbo (hobbit) should not
    const aragornId = mhGameState.players[0].companies[0].characters[0];
    const bilboId = mhGameState.players[0].companies[0].characters[1];
    expect(targets).toContain(aragornId);
    expect(targets).not.toContain(bilboId);
  });

  test('cannot target dwarf characters', () => {
    // Gimli (dwarf) in target company
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [LURE_OF_NATURE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...state, phaseState: makeMHState() };

    // No valid targets — only a dwarf in the company
    const playActions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  test('adds +2 corruption points to bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = base.players[0].companies[0].characters[0];
    const cpBefore = base.players[0].characters[aragornId as string].effectiveStats.corruptionPoints;

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_NATURE);
    // Trigger recompute by reducing a pass action
    const result = reduce(withLure, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const aragornAfter = result.state.players[0].characters[aragornId as string];
    expect(aragornAfter.effectiveStats.corruptionPoints).toBe(cpBefore + 2);
  });

  test('cannot be duplicated on the same character', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [LURE_OF_NATURE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    // Attach one copy already
    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_NATURE);
    const mhGameState = { ...withLure, phaseState: makeMHState() };

    // Should NOT be able to play a second copy on Aragorn
    const playActions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    const aragornId = mhGameState.players[0].companies[0].characters[0];
    const targets = playActions
      .filter(ea => ea.viable)
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);
    expect(targets).not.toContain(aragornId);
  });

  test('untapped character with Lure of Nature can activate removal during organization', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_NATURE);
    const actions = viableActions(withLure, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('remove-self-on-roll');
    expect(action.rollThreshold).toBe(5);
  });

  test('successful removal roll (>4) discards Lure of Nature and taps character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_NATURE);
    // Cheat the roll to 5 (just above 4 = success)
    const cheated = { ...withLure, cheatRollTotal: 5 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const result = reduce(cheated, actions[0].action);
    expect(result.error).toBeUndefined();

    // Character should be tapped
    const aragornId = result.state.players[0].companies[0].characters[0];
    expect(result.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Tapped);

    // Lure of Nature should be removed from character's hazards
    expect(result.state.players[0].characters[aragornId as string].hazards).toHaveLength(0);

    // Lure of Nature should be in opponent's discard pile
    expect(result.state.players[1].discardPile.some(c => c.definitionId === LURE_OF_NATURE)).toBe(true);
  });

  test('failed removal roll (<=4) keeps Lure of Nature attached and taps character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_NATURE);
    // Cheat the roll to 4 (exactly 4 = failure, need > 4)
    const cheated = { ...withLure, cheatRollTotal: 4 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const result = reduce(cheated, actions[0].action);
    expect(result.error).toBeUndefined();

    // Character should be tapped
    const aragornId = result.state.players[0].companies[0].characters[0];
    expect(result.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Tapped);

    // Lure of Nature should still be attached
    expect(result.state.players[0].characters[aragornId as string].hazards).toHaveLength(1);
    expect(result.state.players[0].characters[aragornId as string].hazards[0].definitionId).toBe(LURE_OF_NATURE);
  });

  test('triggers corruption checks equal to Wilderness count in site path at end of M/H', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_NATURE);

    // Set up M/H state at play-hazards step with 2 Wilderness in path
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Wilderness],
      resourcePlayerPassed: true,
      hazardPlayerPassed: true,
    });
    const testState = { ...withLure, phaseState: mhState, cheatRollTotal: 12 };

    // Both players passed → endCompanyMH fires → should queue lure checks
    const result = reduce(testState, { type: 'pass', player: PLAYER_2 });
    expect(result.error).toBeUndefined();

    // Should have pending lure corruption checks
    const ps = result.state.phaseState as MovementHazardPhaseState;
    expect(ps.pendingLureCorruptionChecks).toHaveLength(2);

    const aragornId = result.state.players[0].companies[0].characters[0];
    expect(ps.pendingLureCorruptionChecks[0].characterId).toBe(aragornId);
    expect(ps.pendingLureCorruptionChecks[1].characterId).toBe(aragornId);
  });

  test('no corruption checks when site path has no Wilderness', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_NATURE);

    // Set up M/H state with no Wilderness in path
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Border, RegionType.Free],
      resourcePlayerPassed: true,
      hazardPlayerPassed: true,
    });
    const testState = { ...withLure, phaseState: mhState, cheatRollTotal: 12 };

    // Both passed → endCompanyMH → no lure checks (no wilderness)
    const result = reduce(testState, { type: 'pass', player: PLAYER_2 });
    expect(result.error).toBeUndefined();

    // Should NOT have pending lure corruption checks
    const ps = result.state.phaseState as MovementHazardPhaseState;
    expect(ps.pendingLureCorruptionChecks).toHaveLength(0);
  });

  test('lure corruption check passes when roll exceeds corruption points', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_NATURE);
    const aragornId = withLure.players[0].companies[0].characters[0];

    // Set up M/H with pending lure check
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      pendingLureCorruptionChecks: [{ characterId: aragornId }],
    });
    // High roll = pass
    const testState = { ...withLure, phaseState: mhState, cheatRollTotal: 12 };

    // Legal actions should offer corruption check
    const actions = computeLegalActions(testState, PLAYER_1);
    const ccActions = actions.filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(ccActions).toHaveLength(1);
    expect((ccActions[0].action as { explanation: string }).explanation).toContain('Lure');

    const result = reduce(testState, ccActions[0].action);
    expect(result.error).toBeUndefined();

    // Character should still be in play after passing
    expect(result.state.players[0].characters[aragornId as string]).toBeDefined();
  });

  test('lure corruption check failure discards character', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_NATURE);
    const aragornId = withLure.players[0].companies[0].characters[0];

    // Manually set effectiveStats.corruptionPoints to include Lure's +2
    // (attachHazardToChar does not recompute derived stats)
    const char = withLure.players[0].characters[aragornId as string];
    const updatedChar = {
      ...char,
      effectiveStats: { ...char.effectiveStats, corruptionPoints: char.effectiveStats.corruptionPoints + 2 },
    };
    const updatedChars = { ...withLure.players[0].characters, [aragornId as string]: updatedChar };
    const updatedP0 = { ...withLure.players[0], characters: updatedChars };
    const withRecomputed = { ...withLure, players: [updatedP0, withLure.players[1]] as typeof withLure.players };

    // Aragorn CP = 2. Roll of 2 with modifier 0 → total 2.
    // total (2) > cp (2) → false → fails. total (2) >= cp-1 (1) → true → discard.
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      pendingLureCorruptionChecks: [{ characterId: aragornId }],
    });
    const testState = { ...withRecomputed, phaseState: mhState, cheatRollTotal: 2 };

    const actions = computeLegalActions(testState, PLAYER_1);
    const ccActions = actions.filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(ccActions).toHaveLength(1);

    const result = reduce(testState, ccActions[0].action);
    expect(result.error).toBeUndefined();

    // Character should be discarded (roll within 1 of CP)
    expect(result.state.players[0].characters[aragornId as string]).toBeUndefined();
    expect(result.state.players[0].discardPile.some(c => c.definitionId === ARAGORN)).toBe(true);
  });
});
