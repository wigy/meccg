/**
 * @module last-action-card-defs
 *
 * Engine mechanics — card identities attached to a broadcast
 * {@link StateMessage}'s `lastAction`.
 *
 * Regression for bug 0e6e061ca06457e7 (game mo8vm8nd-zh71f8, seq 135):
 * a hazard player watched the opponent play Marvels Told as a short event
 * but the toast / log line read "Play short-event a card …". The cause:
 * the card moves hand → chain → owner discard in a single state
 * transition, and the opponent's view redacts both the hand and the
 * face-down discard pile (CoE glossary "discard pile"). With neither the
 * pre-action nor post-action view lookup holding the instance→definition
 * mapping, `describeAction` fell back to "a card".
 *
 * The fix ships the action-referenced card definitions alongside the
 * broadcast `lastAction`, resolved from the authoritative state. The
 * client merges this map ahead of its view lookup when naming the
 * opponent's action. This file pins the server-side helper.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ELROND, LEGOLAS,
  MARVELS_TOLD, FOOLISH_WORDS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  handCardId, dispatch,
  addCardInPlay,
  runSimpleDraft,
  HAZARD_PLAYER, RESOURCE_PLAYER,
  pool,
} from '../../test-helpers.js';
import type { AddCharacterToDeckAction, CardInstanceId, PlayShortEventAction } from '../../../index.js';
import {
  Phase,
  SetupStep,
  describeAction,
  extractActionCardDefs,
  extractActionCardDefsForAudience,
  getActingPlayerPrivateInstanceIds,
  reduce,
} from '../../../index.js';

describe('lastAction card defs — opponent toast naming', () => {
  beforeEach(() => resetMint());

  test('extractActionCardDefs resolves the played card for a short-event play', () => {
    // Marvels Told is played from hand and sent straight to the owner's
    // discard pile in the same state transition. The action carries only
    // the instance id, so without this helper the opponent's describeAction
    // cannot name the card.
    const base = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const before = addCardInPlay(base, HAZARD_PLAYER, FOOLISH_WORDS);

    const marvelsId = handCardId(before, RESOURCE_PLAYER);
    const foolishWordsId = before.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(before.players[0].characters)[0] as unknown as CardInstanceId;

    const action: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    };
    const after = dispatch(before, action);

    // Precondition that reproduces the bug: after the transition the
    // played card is in the owner's discard pile, which the opponent's
    // projection redacts. A lookup built from the post-action projection
    // alone cannot map marvelsId → MARVELS_TOLD.
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain(marvelsId);

    const defs = extractActionCardDefs(after, action);
    expect(defs[marvelsId as string]).toBe(MARVELS_TOLD);
    // The discard target is also named in the action and should resolve
    // to its current (discarded) definition.
    expect(defs[foolishWordsId as string]).toBe(FOOLISH_WORDS);
    // The scout is a character in play and resolves too.
    expect(defs[elrondId as string]).toBe(ELROND);
  });

  test('describeAction with merged lookup names Marvels Told in the opponent toast', () => {
    // End-to-end check of the fix: with only the view-level lookup the
    // card appears as "a card"; layering the action-referenced defs on
    // top produces the card name.
    const base = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const before = addCardInPlay(base, HAZARD_PLAYER, FOOLISH_WORDS);

    const marvelsId = handCardId(before, RESOURCE_PLAYER);
    const foolishWordsId = before.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(before.players[0].characters)[0] as unknown as CardInstanceId;

    const action: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    };
    const after = dispatch(before, action);

    // Simulate the opponent's view lookup: the played card is invisible
    // (hand or face-down discard), so it returns undefined.
    const viewLookup = (id: CardInstanceId): typeof MARVELS_TOLD | undefined =>
      id === elrondId ? ELROND : undefined;
    const bare = describeAction(action, pool, viewLookup);
    expect(bare).toContain('a card');
    expect(bare).not.toContain('Marvels Told');

    // Merge the server-supplied action defs ahead of the view lookup.
    const defs = extractActionCardDefs(after, action);
    const mergedLookup = (id: CardInstanceId) => defs[id as string] ?? viewLookup(id);
    const named = describeAction(action, pool, mergedLookup);
    expect(named).toContain('Marvels Told');
  });
});

describe('add-character-to-deck — opponent must not learn the shuffled character', () => {
  beforeEach(() => resetMint());

  /**
   * Regression for bug report ad5ae57b20698ba1 (game moab9vqb-68zlad, seq ~14):
   * during character-deck-draft, the opponent's toast read the actual card name
   * of each character the active player shuffled into their face-down play deck
   * (e.g. "Add Frodo to play deck"). Per CoE rule 1.8, leftover pool characters
   * shuffled into the play deck must stay hidden — the opponent may know the
   * action was taken but not which character was chosen.
   */
  test('getActingPlayerPrivateInstanceIds flags the shuffled character', () => {
    const action: AddCharacterToDeckAction = {
      type: 'add-character-to-deck',
      player: PLAYER_1,
      characterInstanceId: 'p1-57' as CardInstanceId,
    };
    expect(getActingPlayerPrivateInstanceIds(action)).toEqual(['p1-57']);
  });

  test('audience-filtered defs strip the shuffled character so describeAction renders "a card"', () => {
    // Drive setup to character-deck-draft so the action is applicable.
    let state = runSimpleDraft();
    expect(state.phaseState.phase).toBe(Phase.Setup);
    if (state.phaseState.phase !== Phase.Setup) throw new Error('expected setup');

    if (state.phaseState.setupStep.step === SetupStep.ItemDraft) {
      const itemStep = state.phaseState.setupStep;
      const p1Char = state.players[0].companies[0].characters[0];
      const p2Char = state.players[1].companies[0].characters[0];
      for (const item of itemStep.itemDraftState[0].unassignedItems) {
        const r = reduce(state, {
          type: 'assign-starting-item',
          player: PLAYER_1,
          itemDefId: item.definitionId,
          characterInstanceId: p1Char,
        });
        if (r.error) throw new Error(r.error);
        state = r.state;
      }
      for (const item of itemStep.itemDraftState[1].unassignedItems) {
        const r = reduce(state, {
          type: 'assign-starting-item',
          player: PLAYER_2,
          itemDefId: item.definitionId,
          characterInstanceId: p2Char,
        });
        if (r.error) throw new Error(r.error);
        state = r.state;
      }
    }

    if (state.phaseState.phase !== Phase.Setup) throw new Error('expected setup');
    expect(state.phaseState.setupStep.step).toBe(SetupStep.CharacterDeckDraft);
    if (state.phaseState.setupStep.step !== SetupStep.CharacterDeckDraft) throw new Error('expected deck draft');

    // Pick a concrete character to add to p1's deck from their remaining pool.
    const p1Pool = state.phaseState.setupStep.deckDraftState[0].remainingPool;
    expect(p1Pool.length).toBeGreaterThan(0);
    const charInstance = p1Pool[0];

    const action: AddCharacterToDeckAction = {
      type: 'add-character-to-deck',
      player: PLAYER_1,
      characterInstanceId: charInstance.instanceId,
    };
    const after = reduce(state, action);
    if (after.error) throw new Error(after.error);

    // Full (acting-player) defs resolve the character's real definition.
    const fullDefs = extractActionCardDefs(after.state, action);
    expect(fullDefs[charInstance.instanceId as string]).toBe(charInstance.definitionId);

    // Audience-filtered defs strip the private character entry.
    const audienceDefs = extractActionCardDefsForAudience(after.state, action);
    expect(audienceDefs[charInstance.instanceId as string]).toBeUndefined();

    // describeAction with only the audience-filtered lookup renders "a card",
    // matching how the opponent's toast / log should read.
    const audienceLookup = (id: CardInstanceId) => audienceDefs[id as string];
    const audienceDesc = describeAction(action, pool, audienceLookup);
    expect(audienceDesc).toContain('a card');
    // And the card name must not leak to the opponent.
    const realName = pool[charInstance.definitionId as string]?.name;
    if (realName) expect(audienceDesc).not.toContain(realName);

    // The acting player still sees the card name, proving the split.
    const actingLookup = (id: CardInstanceId) => fullDefs[id as string];
    const actingDesc = describeAction(action, pool, actingLookup);
    if (realName) expect(actingDesc).toContain(realName);
  });
});
