/**
 * @module wh-36.test
 *
 * Card test: The White Wizard (wh-36)
 * Type: hero-resource-event (permanent), Wizard alignment, unique. MP 2 (misc).
 *
 * Text: "Unique. Playable on a Wizard with Sacrifice of Form. +2 to his direct
 * influence, +1 to all of his corruption checks. Discard if Saruman is in play
 * as an opposing Wizard."
 *
 * Effects:
 * | # | Effect Type                                    | Notes                                             |
 * |---|-------------------------------------------------|----------------------------------------------------|
 * | 1 | play-target (character), filter                 | target.race wizard AND target.attachedEventNames  |
 * |   |                                                   | $includes "Sacrifice of Form"                      |
 * | 2 | stat-modifier direct-influence +2                | unconditional, once attached                       |
 * | 3 | check-modifier corruption +1                     | unconditional, once attached                       |
 * | 4 | discard-self-when                                | condition opponent.avatarName === "Saruman"        |
 *
 * Playable: YES
 *
 * A resource permanent-event with a character play-target attaches into the
 * bearer's `items` (not bare `cardsInPlay`) via `inPlayOnCharacterSlot`
 * (`chain-reducer.ts`), exactly like Align Palantír (tw-190). Sacrifice of
 * Form (tw-321) reattaches to its Wizard via `CardInPlay.attachedTo` the
 * moment he returns to play (`sacrifice-of-form.ts`), so "a Wizard with
 * Sacrifice of Form" is expressed as a `target.attachedEventNames` filter
 * (`legal-actions/organization-events.ts`), and the `discard-self-when` sweep
 * now also scans character-borne items (`discard-self-when.ts`
 * `sweepDiscardSelfWhenItems`) since this card never sits bare in
 * `cardsInPlay`.
 *
 * Fixtures: Pallando (tw-175, Wizard avatar, DI 10, no innate corruption-check
 * modifier of his own) stands in for the "Wizard with Sacrifice of Form" —
 * Sacrifice of Form is attached directly via `addP1CardsInPlay` rather than
 * driven through the full sacrifice/return flow (already covered by
 * tw-321.test.ts). Saruman (tw-181) is the opposing Wizard named in the
 * discard clause.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase, Alignment, CardStatus,
  buildTestState, resetMint, mint,
  addP1CardsInPlay, attachItemToChar,
  viableActions, playPermanentEventAndResolve,
  findCharInstanceId, getCharacter, recomputeDerived,
  enqueueTransferCorruptionCheck, expectInDiscardPile,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import { sweepDiscardSelfWhen } from '../../engine/discard-self-when.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId, CorruptionCheckAction, GameState, PlayPermanentEventAction } from '../../index.js';

const THE_WHITE_WIZARD = 'wh-36' as CardDefinitionId;
const SACRIFICE_OF_FORM = 'tw-321' as CardDefinitionId;
const PALLANDO = 'tw-175' as CardDefinitionId; // Wizard avatar, DI 10, no own corruption-check-modifier
const SARUMAN = 'tw-181' as CardDefinitionId; // opposing Wizard avatar named in the discard clause
const ARAGORN = 'tw-120' as CardDefinitionId; // non-Wizard, for the race-gate check

/** Base state: Pallando alone at Rivendell (P1), an opposing company at Minas Tirith (P2). */
function baseState(opts: { hand?: CardDefinitionId[]; p2CharDefId?: CardDefinitionId } = {}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [PALLANDO] }],
        hand: opts.hand ?? [THE_WHITE_WIZARD], siteDeck: [MORIA],
      },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: opts.p2CharDefId ? [opts.p2CharDefId] : [] }],
        hand: [], siteDeck: [LORIEN],
      },
    ],
  });
}

/** Attach a bare "Sacrifice of Form" cardsInPlay entry to the named P1 character. */
function withSacrificeOfForm(state: GameState, charDefId: CardDefinitionId = PALLANDO): GameState {
  const charId = findCharInstanceId(state, RESOURCE_PLAYER, charDefId);
  return addP1CardsInPlay(state, [
    { instanceId: mint(), definitionId: SACRIFICE_OF_FORM, status: CardStatus.Untapped, attachedTo: charId } as unknown as CardInPlay,
  ]);
}

describe('The White Wizard (wh-36)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: play-target — a Wizard bearing Sacrifice of Form ─────────────

  test('playable on a Wizard bearing Sacrifice of Form', () => {
    const state = withSacrificeOfForm(baseState());
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as PlayPermanentEventAction).targetCharacterId).toBe(pallandoId);
  });

  test('NOT playable on a Wizard with no Sacrifice of Form attached', () => {
    const state = baseState();
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable on a non-Wizard character even bearing an attached "Sacrifice of Form"-named card', () => {
    // Contrived: directly attach a Sacrifice of Form instance to a non-Wizard
    // to isolate the `target.race: "wizard"` half of the filter from the
    // `attachedEventNames` half (Sacrifice of Form's own legal-action gate
    // already prevents this in real play).
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [THE_WHITE_WIZARD], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const attached = withSacrificeOfForm(built, ARAGORN);
    expect(viableActions(attached, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── Effects 2 & 3: +2 direct influence, +1 corruption checks, once attached ─

  function playOnPallando(state: GameState): { after: GameState; pallandoId: CardInstanceId } {
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const after = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId, action.targetCharacterId);
    return { after, pallandoId };
  }

  test('attaches to the Wizard as an item and grants +2 direct influence', () => {
    const state = withSacrificeOfForm(baseState());
    const { after } = playOnPallando(state);
    const recomputed = recomputeDerived(after);
    const char = getCharacter(recomputed, RESOURCE_PLAYER, PALLANDO);
    expect(char.items.some(i => i.definitionId === THE_WHITE_WIZARD)).toBe(true);
    expect(char.effectiveStats.directInfluence).toBe(12); // Pallando base 10 + 2
  });

  test('grants +1 to the Wizard\'s corruption checks', () => {
    const state = withSacrificeOfForm(baseState());
    const { after, pallandoId } = playOnPallando(state);
    const whiteWizardItemId = getCharacter(after, RESOURCE_PLAYER, PALLANDO).items.find(
      i => i.definitionId === THE_WHITE_WIZARD,
    )!.instanceId;

    const withCheck = enqueueTransferCorruptionCheck(after, PLAYER_1, pallandoId, whiteWizardItemId);
    const ccActions = computeLegalActions(withCheck, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);
    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].corruptionModifier).toBe(1);
  });

  // ── Effect 4: discard-self-when — Saruman in play as opposing Wizard ────────

  test('is discarded the moment it enters play, if Saruman is already in play as the opposing Wizard', () => {
    // The postReduce discard-self-when sweep runs after every action,
    // including the very reduce that resolves the card's own chain entry —
    // it never actually sits attached even for an instant if the condition
    // already holds when it enters play.
    const state = withSacrificeOfForm(baseState({ p2CharDefId: SARUMAN }));
    const { after } = playOnPallando(state);

    expect(getCharacter(after, RESOURCE_PLAYER, PALLANDO).items.some(i => i.definitionId === THE_WHITE_WIZARD)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === THE_WHITE_WIZARD)).toBe(true);
  });

  test('discards an already-attached copy once the opposing Wizard becomes Saruman', () => {
    // Attach directly (bypassing the play/chain flow, already covered above)
    // to isolate the sweep itself: the card was legitimately in play before
    // Saruman appeared, and the very next postReduce sweep discards it.
    const state = attachItemToChar(baseState({ p2CharDefId: SARUMAN }), RESOURCE_PLAYER, PALLANDO, THE_WHITE_WIZARD);
    const whiteWizardItemId = getCharacter(state, RESOURCE_PLAYER, PALLANDO).items.find(
      i => i.definitionId === THE_WHITE_WIZARD,
    )!.instanceId;

    const swept = sweepDiscardSelfWhen(state);

    expect(getCharacter(swept, RESOURCE_PLAYER, PALLANDO).items.some(i => i.definitionId === THE_WHITE_WIZARD)).toBe(false);
    expectInDiscardPile(swept, RESOURCE_PLAYER, whiteWizardItemId);
  });

  test('stays in play while the opposing Wizard is not Saruman', () => {
    const state = withSacrificeOfForm(baseState({ p2CharDefId: undefined }));
    const { after } = playOnPallando(state);

    const swept = sweepDiscardSelfWhen(after);

    expect(getCharacter(swept, RESOURCE_PLAYER, PALLANDO).items.some(i => i.definitionId === THE_WHITE_WIZARD)).toBe(true);
  });
});
