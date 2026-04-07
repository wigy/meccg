/**
 * @module le-124.test
 *
 * Card test: Lure of the Senses (le-124)
 * Type: hazard-event (permanent, character-targeting corruption)
 * Effects: 5 (play-target character, duplication-limit scope:character max:1,
 *             stat-modifier corruption-points +2, on-event untap-phase-at-haven
 *             force-check corruption, grant-action remove-self-on-roll
 *             cost:tap-bearer threshold:7)
 *
 * "Corruption. Playable on a non-Ringwraith character. Target character
 *  receives 2 corruption points and makes a corruption check at the end of
 *  his untap phase if at a Haven/Darkhaven [{H}]. During his organization
 *  phase, the character may tap to attempt to remove this card. Make a
 *  roll—if the result is greater than 6, discard this card. Cannot be
 *  duplicated on a given character."
 *
 * Engine Support:
 * | # | Feature                            | Status      | Notes                          |
 * |---|------------------------------------|-------------|--------------------------------|
 * | 1 | Play from hand targeting character  | IMPLEMENTED | play-hazard with targetCharId  |
 * | 2 | +2 corruption points               | IMPLEMENTED | stat-modifier corruption-points|
 * | 3 | Corruption check at haven (untap)   | IMPLEMENTED | on-event untap-phase-at-haven  |
 * | 4 | Tap to attempt removal (roll > 6)   | IMPLEMENTED | grant-action remove-self-on-roll|
 * | 5 | Cannot be duplicated on character   | IMPLEMENTED | duplication-limit scope:char   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce, makeMHState,
  attachHazardToChar, findCharInstanceId,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  LURE_OF_THE_SENSES,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, CardStatus,
} from '../test-helpers.js';
import type { PlayHazardAction, ActivateGrantedAction, CorruptionCheckAction, UntapPhaseState } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Lure of the Senses (le-124)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: play-target character ────────────────────────────────────────

  test('played from hand targets a specific character (one action per character)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [LURE_OF_THE_SENSES],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...state, phaseState: makeMHState() };

    const playActions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    // Each action should target a different character
    const targets = playActions.map(
      ea => (ea.action as PlayHazardAction).targetCharacterId,
    );
    for (const t of targets) {
      expect(t).toBeDefined();
    }

    // Should have one action per character (Aragorn + Gandalf)
    const uniqueTargets = new Set(targets);
    expect(uniqueTargets.size).toBe(2);
  });

  // ── Effect 2: stat-modifier corruption-points +2 ──────────────────────────

  test('+2 corruption points applied when Lure is attached to character', () => {
    // Build state in Organization phase and attach the hazard
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(base, 0, ARAGORN);
    const cpBefore = base.players[0].characters[aragornId as string].effectiveStats.corruptionPoints;

    // Attach Lure of the Senses
    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);

    // Dispatch pass to trigger recomputeDerived (reducer recomputes on every action)
    const result = reduce(withLure, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const aragornAfter = result.state.players[0].characters[aragornId as string];
    expect(aragornAfter.effectiveStats.corruptionPoints).toBe(cpBefore + 2);
  });

  // ── Effect 3: on-event untap-phase-at-haven corruption check ──────────────

  test('corruption check triggered at end of untap phase when character is at haven', () => {
    // Build state in untap phase with Lure attached to Aragorn at Rivendell (haven)
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);

    // Resource player untaps
    const afterUntap = reduce(withLure, { type: 'untap', player: PLAYER_1 });
    expect(afterUntap.error).toBeUndefined();

    // Hazard player passes
    const afterHazardPass = reduce(afterUntap.state, { type: 'pass', player: PLAYER_2 });
    expect(afterHazardPass.error).toBeUndefined();

    // Should still be in untap phase with pending lure checks
    expect(afterHazardPass.state.phaseState.phase).toBe(Phase.Untap);
    const untapState = afterHazardPass.state.phaseState as UntapPhaseState;
    expect(untapState.pendingLureChecks.length).toBe(1);

    // Corruption check action should be available for the resource player
    const ccActions = viableActions(afterHazardPass.state, PLAYER_1, 'corruption-check');
    expect(ccActions.length).toBe(1);

    const ccAction = ccActions[0].action as CorruptionCheckAction;
    const aragornId = findCharInstanceId(afterHazardPass.state, 0, ARAGORN);
    expect(ccAction.characterId).toBe(aragornId);
    // CP should include +2 from Lure
    expect(ccAction.corruptionPoints).toBeGreaterThanOrEqual(2);
  });

  test('corruption check NOT triggered when character is at non-haven site', () => {
    // Build state with Aragorn at Moria (shadow-hold, not a haven)
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);

    // Resource player untaps
    const afterUntap = reduce(withLure, { type: 'untap', player: PLAYER_1 });
    expect(afterUntap.error).toBeUndefined();

    // Hazard player passes — should go straight to Organization (no lure checks at non-haven)
    const afterHazardPass = reduce(afterUntap.state, { type: 'pass', player: PLAYER_2 });
    expect(afterHazardPass.error).toBeUndefined();
    expect(afterHazardPass.state.phaseState.phase).toBe(Phase.Organization);
  });

  test('successful lure corruption check advances to organization', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);
    // Cheat roll to 12 (guaranteed pass)
    const cheated = { ...withLure, cheatRollTotal: 12 };

    const afterUntap = reduce(cheated, { type: 'untap', player: PLAYER_1 });
    const afterHazardPass = reduce(afterUntap.state, { type: 'pass', player: PLAYER_2 });
    expect(afterHazardPass.state.phaseState.phase).toBe(Phase.Untap);

    // Resolve the corruption check
    const ccActions = viableActions(afterHazardPass.state, PLAYER_1, 'corruption-check');
    expect(ccActions.length).toBe(1);

    const result = reduce(afterHazardPass.state, ccActions[0].action);
    expect(result.error).toBeUndefined();

    // Should advance to organization after successful check
    expect(result.state.phaseState.phase).toBe(Phase.Organization);

    // Character should still be alive
    const aragornId = findCharInstanceId(result.state, 0, ARAGORN);
    expect(result.state.players[0].characters[aragornId as string]).toBeDefined();
  });

  test('failed lure corruption check discards character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);
    // Cheat roll to 2 (guaranteed fail — CP is at least 2, roll 2 ≤ CP)
    const cheated = { ...withLure, cheatRollTotal: 2 };

    const afterUntap = reduce(cheated, { type: 'untap', player: PLAYER_1 });
    const afterHazardPass = reduce(afterUntap.state, { type: 'pass', player: PLAYER_2 });

    const ccActions = viableActions(afterHazardPass.state, PLAYER_1, 'corruption-check');
    expect(ccActions.length).toBe(1);

    const result = reduce(afterHazardPass.state, ccActions[0].action);
    expect(result.error).toBeUndefined();

    // Should advance to organization
    expect(result.state.phaseState.phase).toBe(Phase.Organization);

    // Aragorn should be discarded (failed corruption check)
    const p1Chars = Object.keys(result.state.players[0].characters);
    expect(p1Chars.length).toBe(0);
    expect(result.state.players[0].discardPile.some(c => c.definitionId === ARAGORN)).toBe(true);
  });

  // ── Effect 4: grant-action remove-self-on-roll ─────────────────────────────

  test('untapped character can activate removal during organization (roll > 6)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);
    const actions = viableActions(withLure, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('remove-self-on-roll');
    expect(action.rollThreshold).toBe(7);
  });

  test('tapped character cannot activate Lure removal', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);
    // Tap the character
    const aragornId = withLure.players[0].companies[0].characters[0];
    const tappedState = {
      ...withLure,
      players: [
        {
          ...withLure.players[0],
          characters: {
            ...withLure.players[0].characters,
            [aragornId as string]: { ...withLure.players[0].characters[aragornId as string], status: CardStatus.Tapped },
          },
        },
        withLure.players[1],
      ] as typeof withLure.players,
    };

    const actions = viableActions(tappedState, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(0);
  });

  test('successful removal roll (> 6) discards Lure and taps character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);
    // Cheat roll to 7 (just above 6 = success)
    const cheated = { ...withLure, cheatRollTotal: 7 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const result = reduce(cheated, actions[0].action);
    expect(result.error).toBeUndefined();

    // Character should be tapped
    const aragornId = result.state.players[0].companies[0].characters[0];
    expect(result.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Tapped);

    // Lure should be removed from character's hazards
    expect(result.state.players[0].characters[aragornId as string].hazards).toHaveLength(0);

    // Lure should be in opponent's discard pile
    expect(result.state.players[1].discardPile.some(c => c.definitionId === LURE_OF_THE_SENSES)).toBe(true);
  });

  test('failed removal roll (<= 6) keeps Lure attached and taps character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);
    // Cheat roll to 6 (exactly 6 = failure, need > 6)
    const cheated = { ...withLure, cheatRollTotal: 6 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const result = reduce(cheated, actions[0].action);
    expect(result.error).toBeUndefined();

    // Character should be tapped
    const aragornId = result.state.players[0].companies[0].characters[0];
    expect(result.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Tapped);

    // Lure should still be attached
    expect(result.state.players[0].characters[aragornId as string].hazards).toHaveLength(1);
    expect(result.state.players[0].characters[aragornId as string].hazards[0].definitionId).toBe(LURE_OF_THE_SENSES);

    // Opponent's discard pile should not have Lure
    expect(result.state.players[1].discardPile.some(c => c.definitionId === LURE_OF_THE_SENSES)).toBe(false);
  });

  // ── Effect 5: duplication-limit scope:character max:1 ──────────────────────

  test('cannot duplicate Lure on the same character during M/H phase', () => {
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
          hand: [LURE_OF_THE_SENSES],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    // Attach one copy of Lure already on Aragorn
    const withLure = attachHazardToChar(base, 0, ARAGORN, LURE_OF_THE_SENSES);
    const mhGameState = { ...withLure, phaseState: makeMHState() };

    // Trying to play a second copy should be blocked
    const allActions = computeLegalActions(mhGameState, PLAYER_2);
    const lureActions = allActions.filter(
      ea => ea.action.type === 'play-hazard' && 'targetCharacterId' in ea.action && ea.action.targetCharacterId !== undefined,
    );
    // Should have an action targeting Aragorn but it must be non-viable
    expect(lureActions.length).toBeGreaterThanOrEqual(1);
    for (const action of lureActions) {
      expect(action.viable).toBe(false);
    }
  });
});
