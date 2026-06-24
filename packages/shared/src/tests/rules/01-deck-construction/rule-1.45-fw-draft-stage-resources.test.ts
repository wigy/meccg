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
 * their pool. Drafting happens one pick at a time (one-by-one) from the shared
 * pool — a Stage resource is its own draft pick, never bundled together with a
 * character pick. Drafting a Stage resource resolves immediately and does not
 * consume a character slot or a draft round, so a Stage resource that enables a
 * character (e.g. Thrall of the Voice) must be drafted *before* the character it
 * enables can be drafted. Duplicated unique Stage resources with the same name
 * are discarded; if not duplicated, the Stage resource is put into play. All
 * active conditions to play a drafted Stage resource must be met.
 *
 * (CoE 1.9.F4 phrases this as drafting Stage resources "simultaneously with
 * their characters"; in practice the draft is sequential — one pick at a time.)
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
  draftState: readonly { drafted: readonly unknown[]; draftedStageResources: readonly unknown[] }[];
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

  test('[FALLEN-WIZARD] drafting a Stage resource is a standalone pick that drafts no character with it', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    const thrallInst = draftInstId(state, 0, THRALL_OF_THE_VOICE);
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterInstanceId: thrallInst }]);
    const step = draftStep(state);
    // Exactly the Stage resource was taken; no character came along with it.
    expect(step.step).toBe('character-draft');
    expect(step.draftState[0].draftedStageResources).toHaveLength(1);
    expect(step.draftState[0].drafted).toHaveLength(0);
  });

  test('[FALLEN-WIZARD] an enabling Stage resource must be drafted before the character it enables (sequential, not simultaneous)', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // Before the Stage resource is drafted, the mind-6 character it enables is
    // not offered — proving the two cannot be taken in one combined pick.
    expect(draftOffered(state, PLAYER_1, 0, GIMLI)).toBe(false);

    const thrallInst = draftInstId(state, 0, THRALL_OF_THE_VOICE);
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterInstanceId: thrallInst }]);

    // Only after the Stage resource is already drafted does the character become
    // a legal next pick.
    expect(draftOffered(state, PLAYER_1, 0, GIMLI)).toBe(true);
  });
});
