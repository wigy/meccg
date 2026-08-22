/**
 * @module rule-10.44-winner-step1-corruption
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.44: Step 1: Corruption Checks
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Determining the Winner, Step 1 (Corruption Checks) - Starting with the player who took the last turn, each player makes a corruption check for each of their non-Ringwraith, non-Balrog characters in the order of that player's choosing. Either player may take resource/character actions if doing so would directly affect one of these corruption checks, including tapping one or more characters in the same company to provide +1 support, or actions that would reduce a character's corruption point total or prevent a character from being discarded. These actions may be taken even if their effect(s) would normally only last until the end of the turn and instead last until the end of the game.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase } from '../../../index.js';
import { recomputeDerived } from '../../../engine/recompute-derived.js';
import type { FreeCouncilPhaseState, CardDefinitionId, CorruptionCheckAction } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, viableFor,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GANDALF,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  findCharInstanceId, attachHazardToChar,
} from '../../test-helpers.js';

// Minion character sharing a company with the Ringwraith avatar.
const GORBAG = 'le-11' as CardDefinitionId;
const ADUNAPHEL = 'le-50' as CardDefinitionId; // Ringwraith avatar (race: ringwraith)
const THE_BALROG = 'ba-3' as CardDefinitionId; // Balrog avatar (race: balrog, mind: null)
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

describe('Rule 10.44 — Step 1: Corruption Checks', () => {
  beforeEach(() => resetMint());

  test('Last-turn player (currentPlayer) gets corruption checks; opponent must wait', () => {
    // The last-turn player is PLAYER_1 (activePlayer). In the Free Council,
    // currentPlayer = PLAYER_1, so only PLAYER_1 can declare corruption checks.
    // PLAYER_2 must wait until PLAYER_1 passes.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    const state = { ...base, phaseState: fcState };

    // PLAYER_1 (last-turn player) gets corruption-check actions
    const p1Checks = viableFor(state, PLAYER_1).filter(a => a.action.type === 'corruption-check');
    expect(p1Checks.length).toBeGreaterThan(0);

    // PLAYER_2 does not get corruption-check actions yet
    const p2Checks = viableFor(state, PLAYER_2).filter(a => a.action.type === 'corruption-check');
    expect(p2Checks).toHaveLength(0);
  });

  test('After last-turn player passes, opponent performs corruption checks', () => {
    // Once PLAYER_1 marks their character as checked and passes, the engine
    // switches currentPlayer to PLAYER_2 for their corruption checks.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    // Mark PLAYER_1's character as already checked, then pass
    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [aragornId],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    const stateP1Done = { ...base, phaseState: fcState };
    const afterPass = dispatch(stateP1Done, { type: 'pass', player: PLAYER_1 });

    // Now PLAYER_2 gets corruption-check actions
    const p2Checks = viableFor(afterPass, PLAYER_2).filter(a => a.action.type === 'corruption-check');
    expect(p2Checks.length).toBeGreaterThan(0);

    // PLAYER_1 no longer gets corruption-check actions
    const p1Checks = viableFor(afterPass, PLAYER_1).filter(a => a.action.type === 'corruption-check');
    expect(p1Checks).toHaveLength(0);
  });

  test('After last-turn player passes, activePlayer switches too (turn indicator stays in sync)', () => {
    // Regression: the pass handler switched phaseState.currentPlayer to the
    // other player but left state.activePlayer untouched, so the UI's "whose
    // turn" highlight (render-player-names.ts) stayed on the first checker
    // for the rest of Free Council — making the second player's own
    // corruption-check turn look like the opponent was still acting.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [aragornId],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    const stateP1Done = { ...base, phaseState: fcState };
    const afterPass = dispatch(stateP1Done, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.activePlayer).toBe(PLAYER_2);
  });

  test('A failed check discards the character\'s attached hazards exactly once (no duplication)', () => {
    // Regression: resolveCorruptionCheck discarded `char.hazards` unconditionally
    // AND again inside each failure branch, so a defeated character's attached
    // hazards landed in the owner's discard pile twice — the same CardInstance
    // duplicated, violating the no-duplicate invariant.
    const LURE_OF_THE_SENSES = 'tw-60' as CardDefinitionId; // +2 CP corruption card
    const LURE_OF_NATURE = 'tw-58' as CardDefinitionId;     // +2 CP corruption card
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // Attach opponent-owned corruption cards to Gandalf (CP 4 total after
    // recompute) so they route to PLAYER_2's discard and the check can fail.
    let withHazard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    withHazard = attachHazardToChar(withHazard, RESOURCE_PLAYER, GANDALF, LURE_OF_NATURE, HAZARD_PLAYER);
    withHazard = recomputeDerived(withHazard);
    const gandalfId = findCharInstanceId(withHazard, RESOURCE_PLAYER, GANDALF);
    const hazardId = withHazard.players[RESOURCE_PLAYER].characters[gandalfId].hazards[0].instanceId;

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    // Gandalf (CP 4, his own +1 check modifier) rolls 2 → total 3 == CP-1 →
    // the check fails and he is discarded; his attached hazards discard too.
    // Use the ENGINE-OFFERED action, whose `possessions` list is populated by
    // characterPossessions (items + allies + hazards) — the original version of
    // this test hand-crafted `possessions: []` (and modifier 0), which
    // bypassed the second discard path and masked the surviving duplication.
    const state = { ...withHazard, cheatRollTotal: 2, phaseState: fcState };
    const checkActions = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction)
      .filter(a => a.characterId === gandalfId);
    expect(checkActions).toHaveLength(1);
    expect(checkActions[0].possessions).toContain(hazardId);
    const after = dispatch(state, checkActions[0]);

    const copies = after.players[HAZARD_PLAYER].discardPile.filter(c => c.instanceId === hazardId);
    expect(copies).toHaveLength(1);
  });

  test('Ringwraith and Balrog avatars are skipped — only their non-Ringwraith, non-Balrog company mate is checked', () => {
    // Regression: at game end, a Ringwraith (or Balrog) avatar was offered a
    // corruption-check action alongside its company mate, even though CoE
    // 7.4 / 10.44 say Ringwraiths and Balrogs are immune to corruption and
    // never make one.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: CARN_DUM, characters: [GORBAG, ADUNAPHEL] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const gorbagId = findCharInstanceId(base, RESOURCE_PLAYER, GORBAG);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };
    const state = { ...base, phaseState: fcState };

    const checks = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'corruption-check') as { action: CorruptionCheckAction }[];

    expect(checks).toHaveLength(1);
    expect(checks[0].action.characterId).toBe(gorbagId);

    // Once Gorbag is checked, only the Ringwraith remains — pass, not a check.
    const afterGorbagChecked = { ...state, phaseState: { ...fcState, checkedCharacters: [gorbagId] } };
    const remaining = viableFor(afterGorbagChecked, PLAYER_1).map(a => a.action.type);
    expect(remaining).not.toContain('corruption-check');
    expect(remaining).toContain('pass');
  });

  test('Balrog avatar alone is skipped — pass is offered immediately', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: CARN_DUM, characters: [THE_BALROG] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };
    const state = { ...base, phaseState: fcState };

    const actions = viableFor(state, PLAYER_1).map(a => a.action.type);
    expect(actions).not.toContain('corruption-check');
    expect(actions).toContain('pass');
  });
});
