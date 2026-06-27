/**
 * @module rule-1.44-fw-draft-mind-restriction
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.44: Fallen-Wizard Draft Mind Restriction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player cannot reveal a character with mind greater than five during the character draft unless they have already drafted a Stage resource that specifically allows them to play a character with mind greater than five (e.g. Thrall of the Voice).
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
const CELEBORN = 'tw-136' as CardDefinitionId;           // hero character, mind 6
const BALIN = 'tw-123' as CardDefinitionId;              // hero character, mind 5

/** Viability of drafting a given pool definition for a player, via legal actions. */
function draftViable(state: GameState, player: PlayerId, playerIndex: number, defId: CardDefinitionId): boolean | undefined {
  const inst = draftInstId(state, playerIndex, defId);
  return computeLegalActions(state, player).find(
    ea => ea.action.type === 'draft-pick'
      && (ea.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === inst,
  )?.viable;
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

describe('Rule 1.44 — Fallen-Wizard Draft Mind Restriction', () => {
  test('[FALLEN-WIZARD] cannot draft a mind-6 character without an enabling Stage resource', () => {
    const state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // Mind 6 is blocked; mind 5 is fine.
    expect(draftViable(state, PLAYER_1, 0, GIMLI)).toBe(false);
    expect(draftViable(state, PLAYER_1, 0, BALIN)).toBe(true);
  });

  test('[FALLEN-WIZARD] may draft a mind-6 character once Thrall of the Voice has been drafted', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // Drafting Thrall is the Fallen-wizard's action for the round (CoE 1.9.F4,
    // resolve-immediately model); once the opponent acts and the round resolves,
    // Thrall is in play and lifts the mind > 5 gate for the next round.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, BALIN) },
    ]);
    expect(draftViable(state, PLAYER_1, 0, GIMLI)).toBe(true);
  });

  test('[FALLEN-WIZARD] one Thrall enables only ONE mind-6 character, not two', () => {
    // Regression (bug report: "I can play 2 six minders with one thrall"). A single
    // recruitment vehicle (Thrall) lifts the mind > 5 gate for exactly one drafted
    // character; once that character is drafted the vehicle is spent and a second
    // mind-6 character is blocked again.
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [THRALL_OF_THE_VOICE, GIMLI, CELEBORN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [BALIN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    // Draft Thrall (resolves immediately, CoE 1.9.F4) and let the opponent exhaust
    // their pool so the Fallen-wizard's subsequent picks resolve solo.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, BALIN) },
    ]);

    // With one unconsumed vehicle, either mind-6 character is draftable.
    expect(draftViable(state, PLAYER_1, 0, GIMLI)).toBe(true);
    expect(draftViable(state, PLAYER_1, 0, CELEBORN)).toBe(true);

    // Draft the first mind-6 character — this consumes the single Thrall.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, GIMLI) },
    ]);

    // The second mind-6 character is now blocked: the lone Thrall is spent.
    expect(draftViable(state, PLAYER_1, 0, CELEBORN)).toBe(false);
  });

  test('a non-Fallen-wizard player is unaffected by the mind > 5 draft restriction', () => {
    const state = createGame(makeConfig(Alignment.Wizard), pool);
    expect(draftViable(state, PLAYER_1, 0, GIMLI)).toBe(true);
  });

  test('drafting the Stage resource does not consume a starting-character slot', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // Drafting Thrall resolves it immediately into the Stage resources, not among
    // the drafted starting characters, and without using the round's pick.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
    ]);
    const step = (state.phaseState as { setupStep: { step: string; draftState: readonly { drafted: readonly unknown[]; draftedStageResources: readonly unknown[] }[] } }).setupStep;
    expect(step.step).toBe('character-draft');
    expect(step.draftState[0].drafted).toHaveLength(0);
    expect(step.draftState[0].draftedStageResources).toHaveLength(1);
  });
});
