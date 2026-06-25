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
 * their pool *simultaneously with* — i.e. in addition to — their characters. A
 * Stage resource is its own pick from the shared pool, but it is NOT a face-down
 * round pick: drafting one resolves immediately into the player's Stage
 * resources and does NOT consume the round's single (character) pick, so the
 * Fallen-wizard never falls a character behind the opponent for taking one. A
 * Stage resource does not count toward the 5 starting characters or the mind
 * budget. Because an enabling Stage resource (e.g. Thrall of the Voice) is in
 * play the moment it is drafted, a character it enables (e.g. a mind > 5
 * character) can be drafted immediately afterwards — in the same round.
 * Duplicated unique Stage resources with the same name are discarded; if not
 * duplicated, the Stage resource is put into play. All active conditions to play
 * a drafted Stage resource must be met.
 */

import { describe, test, expect } from 'vitest';
import {
  makePlayDeck, pool, draftInstId, runActions,
  PLAYER_1, PLAYER_2, RIVENDELL, Alignment,
  createGame, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  ADRAZAR, FRODO, FARAMIR, BILBO,
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

  test('[FALLEN-WIZARD] a Stage resource resolves immediately and does not consume the round\'s character pick', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    const thrallInst = draftInstId(state, 0, THRALL_OF_THE_VOICE);
    // Drafting the Stage resource resolves it at once — no opponent pick needed —
    // straight into the drafted Stage resources, with currentPick left empty and
    // no starting-character slot occupied.
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterInstanceId: thrallInst }]);
    const step = draftStep(state);
    expect(step.draftState[0].currentPick).toBeNull();
    expect(step.draftState[0].draftedStageResources).toHaveLength(1);
    expect(step.draftState[0].drafted).toHaveLength(0);
    // The round is NOT consumed: the Fallen-wizard is still offered character
    // picks (e.g. Balin) and still owes a character pick (or a stop) this round.
    expect(draftOffered(state, PLAYER_1, 0, BALIN)).toBe(true);
  });

  test('[FALLEN-WIZARD] an enabling Stage resource is active as soon as it is drafted', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // Before Thrall is drafted, the mind-6 character it enables is not offered.
    expect(draftOffered(state, PLAYER_1, 0, GIMLI)).toBe(false);

    // Draft Thrall — it resolves immediately, so the mind-6 character it enables
    // becomes a legal pick in the SAME round, with no opponent pick required.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
    ]);
    expect(draftOffered(state, PLAYER_1, 0, GIMLI)).toBe(true);
  });

  test('[FALLEN-WIZARD] drafting Stage resources never leaves the Fallen-wizard behind on characters (regression for the Hidden Haven draft report)', () => {
    // Bug report (game mqtbg9mu-u4g9gt, seq 8): a Fallen-wizard who drafted Stage
    // resources fell one character behind the opponent for every Stage resource,
    // because a Stage-resource pick was wrongly treated as the round's single
    // face-down pick. Per CoE 1.9.F4 a Stage resource is drafted *in addition to*
    // — never instead of — a character, so an equal number of rounds must leave
    // both players with an equal number of drafted characters.
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.FallenWizard,
          draftPool: [THRALL_OF_THE_VOICE, ADRAZAR, FRODO],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [FARAMIR, BILBO],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    // Round 1: the Fallen-wizard drafts a Stage resource (free) AND a character;
    // the opponent drafts a character. The round then reveals.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, ADRAZAR) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, FARAMIR) },
    ]);

    const step = draftStep(state);
    // After one completed round both players have exactly one drafted character —
    // the Stage resource did not cost the Fallen-wizard a character pick.
    expect(step.draftState[0].drafted).toHaveLength(1);
    expect(step.draftState[1].drafted).toHaveLength(1);
    expect(step.draftState[0].draftedStageResources).toHaveLength(1);
  });

  test('[FALLEN-WIZARD] a Stage resource placed with a character does not consume the two minor-item budget', () => {
    // Regression: a recruitment-vehicle Stage resource (Thrall of the Voice) is
    // attached to a drafted character — it rides in that character's `items` so
    // its mind reduction applies. Such a Stage card is NOT a minor item (CoE
    // 1.7.F1 / 1.9.F4): the three stage points are an entirely separate budget
    // from the up-to-two minor items (CoE 1.9). The engine used to count every
    // entry in `character.items` toward the two-item limit, so a Thrall placed
    // with a character wrongly consumed item budget and blocked real minor items
    // (Dagger of Westernesse, Horn of Anor) from being assigned.
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.FallenWizard,
          draftPool: [THRALL_OF_THE_VOICE, BALIN, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [FRODO],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);

    // Round 1: P1 drafts the Stage resource (Thrall) — it resolves immediately and
    // does NOT use P1's character pick — then drafts Balin as the round's character
    // pick; P2 drafts Frodo. The round reveals and P2, with an exhausted pool,
    // auto-stops.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BALIN) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, FRODO) },
    ]);
    // P1 stops → the draft finalises and the leftover pool items (Dagger, Horn)
    // flow into the item draft.
    state = runActions(state, [
      { type: 'draft-stop', player: PLAYER_1 },
    ]);

    const setup = (state.phaseState as { setupStep: { step: string } }).setupStep;
    expect(setup.step).toBe('item-draft');

    // Thrall is attached to the drafted character but must not occupy item budget:
    // both pool minor items are offered as viable starting-item assignments.
    const balin = state.players[0].companies[0].characters[0];
    const assignableItems = (): CardDefinitionId[] => computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-starting-item')
      .map(ea => (ea.action as { itemDefId: CardDefinitionId }).itemDefId);

    expect(assignableItems()).toContain(DAGGER_OF_WESTERNESSE);
    expect(assignableItems()).toContain(HORN_OF_ANOR);

    // Assign the first minor item. The second must STILL be offered: with the bug,
    // Thrall (1) + Dagger (1) hit the 2/2 limit and Horn was rejected.
    state = runActions(state, [
      { type: 'assign-starting-item', player: PLAYER_1, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: balin },
    ]);
    expect(assignableItems()).toContain(HORN_OF_ANOR);

    // The second minor item assigns successfully, leaving Thrall + both items.
    state = runActions(state, [
      { type: 'assign-starting-item', player: PLAYER_1, itemDefId: HORN_OF_ANOR, characterInstanceId: balin },
    ]);
    const items = state.players[0].characters[balin as string].items.map(i => i.definitionId);
    expect(items).toContain(THRALL_OF_THE_VOICE);
    expect(items).toContain(DAGGER_OF_WESTERNESSE);
    expect(items).toContain(HORN_OF_ANOR);
  });
});
