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
  SUN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  handCardId, dispatch,
  addCardInPlay,
  runSimpleDraft,
  eotState,
  HAZARD_PLAYER, RESOURCE_PLAYER,
  pool,
} from '../../test-helpers.js';
import type { AddCharacterToDeckAction, CardInstanceId, DiscardCardAction, PlayShortEventAction } from '../../../index.js';
import { Phase, SetupStep, describeAction, extractActionCardDefs, reduce } from '../../../index.js';

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
   * Regression for bug ad5ae57b20698ba1 (game moab9vqb-68zlad, seq ~14):
   * during character-deck-draft, the opponent's toast read the actual card
   * name of each character the active player shuffled into their face-down
   * play deck (e.g. "Add Frodo to play deck"). Per CoE rule 1.8, leftover
   * pool characters shuffled into the play deck must stay hidden — the
   * opponent may know the action was taken but not which character was
   * chosen. Under the generic visibility model the pool → playDeck move
   * is private-to-private, so the instance never enters
   * `state.revealedInstances` and `extractActionCardDefs` omits it.
   */
  test('extractActionCardDefs omits the shuffled character (pool → playDeck is private→private)', () => {
    let state = runSimpleDraft();
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

    const p1Pool = state.phaseState.setupStep.deckDraftState[0].remainingPool;
    expect(p1Pool.length).toBeGreaterThan(0);
    const charInstance = p1Pool[0];

    const action: AddCharacterToDeckAction = {
      type: 'add-character-to-deck',
      player: PLAYER_1,
      characterInstanceId: charInstance.instanceId,
    };
    const result = reduce(state, action);
    if (result.error) throw new Error(result.error);

    // The shuffled character's identity is absent from the broadcast map —
    // the character was never in a public pile (pool → playDeck are both
    // private to the opponent), so it never entered revealedInstances.
    const defs = extractActionCardDefs(result.state, action);
    expect(defs[charInstance.instanceId as string]).toBeUndefined();

    // describeAction therefore renders "a card" for the opponent's toast.
    const audienceLookup = (id: CardInstanceId) => defs[id as string];
    const audienceDesc = describeAction(action, pool, audienceLookup);
    expect(audienceDesc).toContain('a card');
    const realName = pool[charInstance.definitionId as string]?.name;
    if (realName) expect(audienceDesc).not.toContain(realName);
  });
});

describe('discard-card — opponent must not learn the discarded card', () => {
  beforeEach(() => resetMint());

  /**
   * Regression for bug f5dfb6071aa0e22e (game moab9vqb-68zlad, seq ~116):
   * during the reset-hand / end-of-turn discard steps, the opponent's
   * toast read the actual card name of the card the active player
   * discarded from hand (e.g. "Discard The Sun"). Hand → discardPile is
   * a private-to-private transition under the engine's visibility model
   * (projection.ts redacts the opponent's discardPile), so the instance
   * must never enter `state.revealedInstances` and `extractActionCardDefs`
   * must omit it — the opponent sees "a card" instead.
   */
  test('extractActionCardDefs omits the discarded card (hand → discardPile is private→private)', () => {
    const state = eotState({ p1Hand: [SUN] });
    const discardedId = handCardId(state, RESOURCE_PLAYER);

    const action: DiscardCardAction = {
      type: 'discard-card',
      player: PLAYER_1,
      cardInstanceId: discardedId,
    };
    const after = dispatch(state, action);

    // Precondition: the card moved from hand to the owner's private
    // discard pile, and was never in a public location.
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain(discardedId);
    expect(after.revealedInstances[discardedId as string]).toBeUndefined();

    // The action map broadcast to the opponent omits the card's identity.
    const defs = extractActionCardDefs(after, action);
    expect(defs[discardedId as string]).toBeUndefined();

    // describeAction with only the opponent's map renders "a card".
    const audienceLookup = (id: CardInstanceId) => defs[id as string];
    const audienceDesc = describeAction(action, pool, audienceLookup);
    expect(audienceDesc).toContain('a card');
    const realName = pool[SUN as string]?.name;
    if (realName) expect(audienceDesc).not.toContain(realName);
  });
});
