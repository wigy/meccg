/**
 * @module rule-10.40-calling-the-game
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.40: Calling the Game
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Calling the Game - The conditions that allow the normal end of the game to be initiated depend on the predetermined length of the game.
 * Starter ("1-deck") Game - If a player currently has at least 20 marshalling points not including cards at Under-deeps sites OR has exhausted their own play deck at least once, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least once, the game ends after the current turn.
 * Short ("2-deck") Game - If a player currently has at least 25 marshalling points not including cards at Under-deeps sites and has exhausted their own play deck at least once OR has exhausted their own play deck at least twice, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least twice, the game ends after the current turn.
 * Long ("3-deck") Game - If a player currently has at least 30 marshalling points not including cards at Under-deeps sites and has exhausted their own play deck at least twice OR has exhausted their own play deck at least three times, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least three times, the game ends after the current turn.
 * Campaign ("4-deck") Game - If a player currently has at least 40 marshalling points not including cards at Under-deeps sites and has exhausted their own play deck at least three times OR has exhausted their own play deck at least four times, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least four times, the game ends after the current turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  companyIdAt,
} from '../../test-helpers.js';
import { formatGameState } from '../../../index.js';
import type { EndOfTurnPhaseState } from '../../../index.js';
import type { CardInstanceId, CardDefinitionId } from '../../../index.js';
import { addConstraint } from '../../../engine/pending.js';

describe('Rule 10.40 — Calling the Game', () => {
  beforeEach(() => resetMint());

  test('Game end conditions depend on game length: Starter (20 MP or 1 exhaust), Short (25 MP + 1 exhaust or 2), Long (30 MP + 2 or 3), Campaign (40 MP + 3 or 4)', () => {
    const eotSignalEnd: EndOfTurnPhaseState = {
      phase: Phase.EndOfTurn,
      step: 'signal-end',
      discardDone: [true, true],
      resetHandDone: [true, true],
    };

    // Short game (default): 25 MPs + 1 exhaust → may call
    const state25mp1ex = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 25 }, deckExhaustionCount: 1 },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state25mp1 = { ...state25mp1ex, phaseState: eotSignalEnd };
    const canCall25mp1 = viableFor(state25mp1, PLAYER_1).some(a => a.action.type === 'call-free-council');
    expect(canCall25mp1).toBe(true);

    // Short game: 2 exhausts (regardless of MPs) → may call
    const state0mp2ex = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 0 }, deckExhaustionCount: 2 },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state0mp2 = { ...state0mp2ex, phaseState: eotSignalEnd };
    const canCall0mp2 = viableFor(state0mp2, PLAYER_1).some(a => a.action.type === 'call-free-council');
    expect(canCall0mp2).toBe(true);

    // Short game: 25 MPs but 0 exhausts → cannot call
    const state25mp0ex = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 25 }, deckExhaustionCount: 0 },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state25mp0 = { ...state25mp0ex, phaseState: eotSignalEnd };
    const canCall25mp0 = viableFor(state25mp0, PLAYER_1).some(a => a.action.type === 'call-free-council');
    expect(canCall25mp0).toBe(false);

    // Short game: 10 MPs and 1 exhaust → cannot call (need 25 MPs)
    const state10mp1ex = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 10 }, deckExhaustionCount: 1 },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state10mp1 = { ...state10mp1ex, phaseState: eotSignalEnd };
    const canCall10mp1 = viableFor(state10mp1, PLAYER_1).some(a => a.action.type === 'call-free-council');
    expect(canCall10mp1).toBe(false);
  });

  test('formatGameState shows the unmodified MP total alongside the tournament-adjusted score, so the 25-MP calling threshold is visible', () => {
    // Player 1's raw total is exactly 25 — the calling threshold — but the
    // tournament-adjusted score shown as "MP" is inflated to 33 by the
    // doubling step (CoE §10.3.iii: opponent has 0 in item/ally, so player
    // 1's item/ally sources double). Without the raw total also shown, a
    // player can't tell from the adjusted score alone whether they can call.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 9, item: 6, faction: 3, ally: 2, kill: 3, misc: 2 } },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL],
          marshallingPoints: { character: 1, faction: 5 } },
      ],
    });

    const text = formatGameState(state);
    expect(text).toContain('33 MP (25 unmodified)');
  });

  test('call-free-council ends the turn like a plain pass: turn-scoped constraints are swept', () => {
    // Regression: triggerCouncilCall entered the opponent's last turn without
    // the turn-end sweep the plain signal-end pass applies, so "rest of the
    // turn" constraints from the caller's turn leaked into the last turn.
    const eotSignalEnd: EndOfTurnPhaseState = {
      phase: Phase.EndOfTurn,
      step: 'signal-end',
      discardDone: [true, true],
      resetHandDone: [true, true],
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 25 }, deckExhaustionCount: 1 },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withTurnScoped = addConstraint({ ...base, phaseState: eotSignalEnd }, {
      source: 'p1-turn-src' as CardInstanceId,
      sourceDefinitionId: 'test-def' as CardDefinitionId,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });
    const withBoth = addConstraint(withTurnScoped, {
      source: 'p1-phase-src' as CardInstanceId,
      sourceDefinitionId: 'test-def' as CardDefinitionId,
      scope: { kind: 'phase', phase: Phase.Site },
      target: { kind: 'company', companyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    const after = dispatch(withBoth, { type: 'call-free-council', player: PLAYER_1 });

    // Turn-scoped constraint swept; the non-turn-scoped one survives.
    expect(after.activeConstraints.map(c => c.scope.kind)).toEqual(['phase']);
  });

  test('the last turn ending into the Free Council sweeps turn-scoped constraints before the checks', () => {
    // Regression: transitionToFreeCouncil skipped the turn-end sweep, so
    // turn-scoped effects (e.g. a hazard's check-modifier "for the rest of
    // the turn") stayed active and wrongly modified the game-deciding Free
    // Council corruption checks. (Effects created DURING the Council rightly
    // last to game end per rule 10.44 — they arise after this boundary.)
    const eotSignalEnd: EndOfTurnPhaseState = {
      phase: Phase.EndOfTurn,
      step: 'signal-end',
      discardDone: [true, true],
      resetHandDone: [true, true],
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withConstraint = addConstraint({ ...base, phaseState: eotSignalEnd, lastTurnFor: PLAYER_1 }, {
      source: 'p1-turn-src' as CardInstanceId,
      sourceDefinitionId: 'test-def' as CardDefinitionId,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: companyIdAt(base, RESOURCE_PLAYER) },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    const after = dispatch(withConstraint, { type: 'pass', player: PLAYER_1 });

    expect(after.phaseState.phase).toBe(Phase.FreeCouncil);
    expect(after.activeConstraints).toHaveLength(0);
  });
});

describe('Rule 10.40: calling the Council ends the turn', () => {
  beforeEach(() => resetMint());

  function buildWithTurnConstraint() {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 25 }, deckExhaustionCount: 1,
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const eot: EndOfTurnPhaseState = {
      phase: Phase.EndOfTurn, step: 'signal-end', discardDone: [true, true], resetHandDone: [true, true],
    };
    const aragornId = base.players[0].companies[0].characters[0];
    return addConstraint({ ...base, phaseState: eot }, {
      source: aragornId,
      sourceDefinitionId: base.players[0].characters[aragornId].definitionId,
      scope: { kind: 'turn' },
      target: { kind: 'character', characterId: aragornId },
      kind: { type: 'character-removal-protected' },
    });
  }

  test('normal pass sweeps turn-scoped constraints', () => {
    const state = buildWithTurnConstraint();
    expect(state.activeConstraints.some(c => c.scope.kind === 'turn')).toBe(true);
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.activePlayer).toBe(PLAYER_2);
    expect(after.activeConstraints.some(c => c.scope.kind === 'turn')).toBe(false);
  });

  test('call-free-council also sweeps turn-scoped constraints before the opponent\'s last turn', () => {
    const state = buildWithTurnConstraint();
    const after = dispatch(state, { type: 'call-free-council', player: PLAYER_1 });
    expect(after.activePlayer).toBe(PLAYER_2);
    expect(after.lastTurnFor).toBe(PLAYER_2);
    expect(after.activeConstraints.some(c => c.scope.kind === 'turn')).toBe(false);
  });
});
