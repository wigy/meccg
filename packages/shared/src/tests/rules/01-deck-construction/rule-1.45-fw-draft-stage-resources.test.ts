/**
 * @module rule-1.45-fw-draft-stage-resources
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.45 (CoE 1.9.F4): Fallen-Wizard Draft Stage Resources
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING (wigy, draft UX): drafting a Stage resource is the Fallen-wizard's
 * action for that round.
 *
 * [FALLEN-WIZARD] A Fallen-wizard drafts the Stage resource(s) in their pool
 * during the character draft (CoE 1.9.F4). A Stage resource is its own pick from
 * the shared pool. Drafting one is that player's whole action for the round: it
 * resolves the round (the player adds no character that round) rather than
 * leaving the round open for a separate, additional character pick. A Stage
 * resource that names a starting site (Hidden Haven, wh-75) does not complete
 * the round until its site is brought out (CRF 22); resolution waits for the
 * pairing. A Stage resource does not count toward the 5 starting characters or
 * the mind budget, so it costs the Fallen-wizard no characters by the end of the
 * draft — they finish drafting any remaining characters in later rounds, solo
 * once the opponent stops (CoE 1.9: the opponent's stop lets the other finish).
 * An enabling Stage resource (e.g. Thrall of the Voice) is in play the moment it
 * is drafted, so a character it enables (e.g. a mind > 5 character) becomes a
 * legal pick from the next round on. Duplicated unique Stage resources with the
 * same name are discarded; if not duplicated, the Stage resource is put into
 * play. All active conditions to play a drafted Stage resource must be met.
 *
 * NOTE: This supersedes the earlier reading where a Stage resource was drafted
 * "in addition to" a character in the SAME round (prior report mqtbg9mu). The
 * end-of-draft character count is unchanged; only the per-round sequencing is.
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
const GLOVE_OF_RADAGAST = 'wh-111' as CardDefinitionId;  // Stage resource (unique, Radagast specific)
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
  draftState: readonly { drafted: readonly unknown[]; draftedStageResources: readonly unknown[]; currentPick: unknown; stopped: boolean }[];
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

  test('[FALLEN-WIZARD] drafting a Stage resource is the round\'s whole action and adds no character', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    const thrallInst = draftInstId(state, 0, THRALL_OF_THE_VOICE);
    // Drafting the Stage resource goes straight into the drafted Stage resources
    // (no face-down character pick, no starting-character slot occupied) and is
    // this player's action for the round.
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterInstanceId: thrallInst }]);
    const step = draftStep(state);
    expect(step.draftState[0].currentPick).toBeNull();
    expect(step.draftState[0].draftedStageResources).toHaveLength(1);
    expect(step.draftState[0].drafted).toHaveLength(0);
    // Having acted for the round, the Fallen-wizard is offered nothing further —
    // they are NOT forced to also draft a character; they wait for the opponent.
    expect(draftableInstances(state, PLAYER_1)).toHaveLength(0);

    // Once the opponent acts the round resolves, and the Fallen-wizard simply
    // added no character that round (the Stage resource was their action).
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, BALIN) }]);
    const after = draftStep(state);
    expect(after.draftState[0].drafted).toHaveLength(0);
    expect(after.draftState[0].draftedStageResources).toHaveLength(1);
    expect(after.draftState[1].drafted).toHaveLength(1);
  });

  test('[FALLEN-WIZARD] an enabling Stage resource lifts its gate from the next round on', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // Before Thrall is drafted, the mind-6 character it enables is not offered.
    expect(draftOffered(state, PLAYER_1, 0, GIMLI)).toBe(false);

    // Draft Thrall (the Fallen-wizard's action this round) and let the opponent
    // act so the round resolves. Thrall is now in play, so the mind-6 character
    // it enables is a legal pick from the next round.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, BALIN) },
    ]);
    expect(draftOffered(state, PLAYER_1, 0, GIMLI)).toBe(true);
  });

  test('[FALLEN-WIZARD] drafting Stage resources costs no characters by the end of the draft (regression for the Hidden Haven draft report)', () => {
    // Prior report (game mqtbg9mu-u4g9gt, seq 8): a Fallen-wizard who drafted
    // Stage resources fell one character behind the opponent for every Stage
    // resource. Under the resolve-immediately model a Stage resource IS the
    // round's action (so the Fallen-wizard is briefly "behind" within the draft),
    // but it never costs a character by the END: a Stage resource counts toward
    // neither the 5-character cap nor the mind budget, so the Fallen-wizard keeps
    // drafting characters — solo once the opponent stops (CoE 1.9) — until they
    // have as many as they would have had without taking the Stage resource.
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

    // Round 1: the Fallen-wizard's action is the Stage resource (Thrall); the
    // opponent drafts a character. The round resolves — the FW adds no character
    // (briefly 0 vs 1), which is expected and not a loss.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, FARAMIR) },
    ]);
    expect(draftStep(state).draftState[0].drafted).toHaveLength(0);
    expect(draftStep(state).draftState[1].drafted).toHaveLength(1);

    // Round 2: both draft a character; the opponent then exhausts its pool and
    // auto-stops.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, ADRAZAR) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, BILBO) },
    ]);
    expect(draftStep(state).draftState[1].stopped).toBe(true);

    // The Fallen-wizard is NOT cut short by the opponent stopping — they finish
    // their last character solo. Drafting it finalises the draft.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, FRODO) },
    ]);

    // By the end both starting companies hold the same number of characters (2),
    // and the Stage resource cost the Fallen-wizard none of them.
    const companyChars = (i: number): number =>
      state.players[i].companies.reduce((n, c) => n + c.characters.length, 0);
    expect(companyChars(0)).toBe(2);
    expect(companyChars(1)).toBe(2);
  });

  test('[FALLEN-WIZARD] drafted Stage resources count toward the stage-point total during the draft (regression for game mqxur28y-to5dzj seq 13)', () => {
    // Report (game mqxur28y-to5dzj, seq 13): a Fallen-wizard who had drafted
    // Stage resources during the character draft still saw a stage-point total of
    // 0. The derived total only summed Stage cards already in `cardsInPlay`, but
    // drafted Stage resources do not enter play until draft finalize
    // (`applyDraftResults`) — so mid-draft they were uncounted. They must
    // contribute their stage points (CoE 1.7.F1: a FW builds toward exactly 3)
    // from the moment they are drafted.
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    expect(state.players[0].stagePoints).toBe(0);

    // The Fallen-wizard drafts the Stage resource (Thrall of the Voice, worth 1
    // stage point). It is now in the player's drafted Stage resources, so the
    // running total must read 1 immediately — not 0.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
    ]);
    expect(draftStep(state).draftState[0].draftedStageResources).toHaveLength(1);
    expect(state.players[0].stagePoints).toBe(1);
    // The Wizard opponent accrues no stage points (a Fallen-wizard-only concept).
    expect(state.players[1].stagePoints).toBe(0);
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

    // Round 1: P1's action is the Stage resource (Thrall); P2 drafts Frodo. The
    // round resolves and P2, with an exhausted pool, auto-stops.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, FRODO) },
    ]);
    // Round 2: P1 drafts its character (Balin) solo, then stops → the draft
    // finalises and the leftover pool items (Dagger, Horn) flow into the item
    // draft. Thrall attaches to the drafted character at finalize.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BALIN) },
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
    const items = state.players[0].characters[balin].items.map(i => i.definitionId);
    expect(items).toContain(THRALL_OF_THE_VOICE);
    expect(items).toContain(DAGGER_OF_WESTERNESSE);
    expect(items).toContain(HORN_OF_ANOR);
  });

  test('[FALLEN-WIZARD] Glove of Radagast is draftable as a Stage resource (regression for bug report f5b68841a24ffeb4)', () => {
    // Report: a Fallen-wizard (Radagast) drafting from a pool containing Glove
    // of Radagast (wh-111) found it not offered as a Stage resource pick and
    // never placed into the starting deck. Root cause: wh-111 was missing the
    // `starting-item` keyword that every other Fallen-wizard Stage resource
    // (Thrall of the Voice, Hidden Haven, Bad Company, Open to the Summons)
    // carries — `isStageResourceCard` never recognised it, so it fell through
    // to ordinary (non-character) draft evaluation and was always rejected.
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.FallenWizard,
          draftPool: [GLOVE_OF_RADAGAST, BALIN],
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

    expect(draftOffered(state, PLAYER_1, 0, GLOVE_OF_RADAGAST)).toBe(true);

    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, GLOVE_OF_RADAGAST) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, FRODO) },
    ]);

    // Drafted straight into the Stage resources, not the starting-character
    // slots — it costs no character and is now on its way into the deck.
    expect(draftStep(state).draftState[0].draftedStageResources).toHaveLength(1);
    expect(draftStep(state).draftState[0].drafted).toHaveLength(0);
  });
});
