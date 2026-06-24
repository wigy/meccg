/**
 * @module rule-1.45-fw-draft-stage-resources
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.45 (CoE 1.9.F4): Fallen-Wizard Draft Stage Resources
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player also drafts the Stage resource(s) in
 * their pool. A Stage resource is its own draft pick (never bundled with a
 * character pick) and is picked face-down, then revealed simultaneously with
 * the opponent's pick when the round resolves — it is the player's single pick
 * for that round. A Stage resource does not count toward the 5 starting
 * characters or the mind budget. Because the enabling Stage resource is only in
 * play once revealed, a character it enables (e.g. a mind > 5 character enabled
 * by Thrall of the Voice) can only be drafted in a *later* round, after the
 * Stage resource has been revealed. Duplicated unique Stage resources with the
 * same name are discarded; if not duplicated, the Stage resource is put into
 * play. All active conditions to play a drafted Stage resource must be met.
 */

import { describe, test, expect } from 'vitest';
import {
  makePlayDeck, pool, draftInstId, runActions,
  PLAYER_1, PLAYER_2, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { GameConfig, CardDefinitionId, CardInstanceId, GameState, PlayerId } from '../../../index.js';

const THRALL_OF_THE_VOICE = 'wh-82' as CardDefinitionId; // Stage resource (recruitment vehicle)
const GIMLI = 'tw-159' as CardDefinitionId;              // hero character, mind 6
const BALIN = 'tw-123' as CardDefinitionId;              // hero character, mind 5

/** All draft-pick instance IDs currently offered to a player via legal actions. */
function draftableInstances(state: GameState, player: PlayerId): CardInstanceId[] {
  return computeLegalActions(state, player)
    .filter(ea => ea.viable && ea.action.type === 'draft-pick')
    .map(ea => (ea.action as { characterInstanceId: CardInstanceId }).characterInstanceId);
}

/** Whether drafting a given pool definition is offered to a player. */
function draftOffered(state: GameState, player: PlayerId, playerIndex: number, defId: CardDefinitionId): boolean {
  const inst = draftInstId(state, playerIndex, defId);
  return draftableInstances(state, player).includes(inst);
}

function makeConfig(p1Alignment: Alignment): GameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: p1Alignment,
        draftPool: [THRALL_OF_THE_VOICE, GIMLI, BALIN],
        playDeck: makePlayDeck(),
        siteDeck: [RIVENDELL],
        sideboard: [],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        draftPool: [BALIN],
        playDeck: makePlayDeck(),
        siteDeck: [RIVENDELL],
        sideboard: [],
      },
    ],
    seed: 42,
  };
}

type DraftStep = {
  step: string;
  draftState: readonly { drafted: readonly unknown[]; draftedStageResources: readonly unknown[]; currentPick: unknown }[];
};

function draftStep(state: GameState): DraftStep {
  return (state.phaseState as { setupStep: DraftStep }).setupStep;
}

describe('Rule 1.45 — Fallen-Wizard Draft Stage Resources', () => {
  test('[FALLEN-WIZARD] the Stage resource and characters are each offered as separate one-by-one picks', () => {
    const state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // The Stage resource (Thrall) and the eligible character (Balin) are each
    // independently draftable picks from the shared pool — drafting is one pick
    // at a time, not a combined character+resource pick.
    expect(draftOffered(state, PLAYER_1, 0, THRALL_OF_THE_VOICE)).toBe(true);
    expect(draftOffered(state, PLAYER_1, 0, BALIN)).toBe(true);
  });

  test('[FALLEN-WIZARD] a Stage resource pick is face-down and revealed with the opponent\'s pick', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    const thrallInst = draftInstId(state, 0, THRALL_OF_THE_VOICE);
    // The Fallen-wizard picks Thrall, but the opponent has not picked yet — so it
    // stays a face-down currentPick and is NOT yet resolved.
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterInstanceId: thrallInst }]);
    let step = draftStep(state);
    expect(step.draftState[0].currentPick).not.toBeNull();
    expect(step.draftState[0].draftedStageResources).toHaveLength(0);
    // While the pick is pending, no further pick is offered (one pick per round).
    expect(draftableInstances(state, PLAYER_1)).toEqual([]);

    // The opponent picks → the round reveals → Thrall resolves into the Stage
    // resources, and does not occupy a starting-character slot.
    const oppInst = draftInstId(state, 1, BALIN);
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_2, characterInstanceId: oppInst }]);
    step = draftStep(state);
    expect(step.draftState[0].currentPick).toBeNull();
    expect(step.draftState[0].draftedStageResources).toHaveLength(1);
    expect(step.draftState[0].drafted).toHaveLength(0);
  });

  test('[FALLEN-WIZARD] an enabling Stage resource must be revealed before the character it enables', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // Before Thrall is drafted, the mind-6 character it enables is not offered.
    expect(draftOffered(state, PLAYER_1, 0, GIMLI)).toBe(false);

    // Draft Thrall and reveal the round (opponent also picks).
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, BALIN) },
    ]);

    // Only once Thrall has been revealed (in draftedStageResources) does the
    // mind-6 character become a legal pick.
    expect(draftOffered(state, PLAYER_1, 0, GIMLI)).toBe(true);
  });
});
