/**
 * @module tw-30.test
 *
 * Card test: Drowning Seas (tw-30)
 * Type: hazard-event (short), environment, company-targeting
 * Effects: 4 (play-target company, play-condition site-path [coastal],
 *             play-option "item-loss-and-discard" [sequence: force-discard-
 *             one-company-item + random-discard-hand count:2],
 *             play-option "return-to-origin" [when inPlay Doors of Night] →
 *             company-return-to-origin)
 *
 * "Environment. Playable on a company that moved this turn to a site with a
 *  Coastal Sea [{c}] in its site path. Target company loses one item of its
 *  choice and its player must randomly discard two cards from his hand.
 *  Alternatively, if Doors of Night is in play, target company must
 *  immediately return to its site of origin."
 *
 * The Coastal-Sea clause reuses the existing site-path play-condition gate
 * (`sitePath.coastalCount >= 1`, same machinery as Lost at Sea tw-50). The
 * "loses one item of its choice" + "randomly discard two cards" pair and the
 * Doors-of-Night alternative are two mutually-exclusive resolutions the
 * hazard player picks between at play time — this is the first
 * company-targeting hazard short-event to need that choice, so `play-option`
 * (previously wired only for character-targeting and untargeted short-event
 * modes) is extended to the company-target path
 * (`legal-actions/movement-hazard.ts`, `chain-reducer.ts`'s new
 * `applyCompanyPlayOption`). The item-loss half reuses the shared
 * `discard-one-company-item` pending resolution (`force-discard-one-company-
 * item`, previously combat-only, e.g. Brigands le-64/tw-17) with no
 * `characterId` narrowing, so the choice is the company's controller's
 * across every item in the company. The random-hand-discard half is a new
 * primitive (`random-discard-hand`) using the same seeded-shuffle pattern as
 * `reveal-hand-cards-per-character` (Crebain tw-25). The return-to-origin
 * half reuses `company-return-to-origin` (CoE rule 2.IV.4), gated on `inPlay:
 * "Doors of Night"`.
 *
 * Engine Support:
 * | # | Feature                                         | Status      | Notes                                          |
 * |---|--------------------------------------------------|-------------|-------------------------------------------------|
 * | 1 | Coastal-Sea site-path gate                      | IMPLEMENTED | play-condition requires site-path                |
 * | 2 | Play target = company                           | IMPLEMENTED | play-hazard's targetCompanyId                     |
 * | 3 | Only "item loss + discard" offered w/o DoN       | IMPLEMENTED | play-option when-gating (company target, new)     |
 * | 4 | Both options offered when Doors of Night in play| IMPLEMENTED | play-option `inPlay` context (company target, new)|
 * | 5 | Item loss — company's own choice                | IMPLEMENTED | force-discard-one-company-item (new dispatch)     |
 * | 6 | Random discard of two hand cards                | IMPLEMENTED | random-discard-hand (new triggered action)        |
 * | 7 | Return to site of origin (Doors of Night)       | IMPLEMENTED | company-return-to-origin (new dispatch)           |
 *
 * Certified: 2026-08-23
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS,
  GLAMDRING, STING, DAGGER_OF_WESTERNESSE, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, makeMHState,
  handCardId, companyIdAt, dispatch, resolveChain,
  viableActions, viableActionsForHandCard, expectCharItemCount,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { RegionType, SiteType, Phase } from '../../index.js';
import type {
  GameState, CardDefinitionId, CardInPlay, CardInstanceId, PlayHazardAction,
  MovementHazardPhaseState,
} from '../../index.js';

const DROWNING_SEAS = 'tw-30' as CardDefinitionId;

/** Resource company at Moria (with Aragorn bearing a Dagger of Westernesse and a
 * 3-card filler hand), moving to Minas Tirith via a Coastal Sea, facing the
 * hazard player holding Drowning Seas. */
function baseState(opts?: { doorsOfNight?: boolean; hand?: CardDefinitionId[]; aragornItems?: CardDefinitionId[] }): GameState {
  const hand = opts?.hand ?? [GLAMDRING, STING, BILBO];
  const aragornItems = opts?.aragornItems ?? [DAGGER_OF_WESTERNESSE];
  const doorsInPlay: CardInPlay[] = opts?.doorsOfNight
    ? [{ instanceId: 'don-1' as CardInstanceId, definitionId: DOORS_OF_NIGHT, status: CardStatus.Untapped }]
    : [];

  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: MORIA,
          characters: [{ defId: ARAGORN, items: aragornItems }],
          destinationSite: MINAS_TIRITH,
        }],
        hand,
        siteDeck: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [DROWNING_SEAS],
        siteDeck: [MINAS_TIRITH],
        cardsInPlay: doorsInPlay,
      },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Coastal],
      destinationSiteType: SiteType.Haven,
    }),
  };
}

/** Non-coastal variant of {@link baseState} — same shape, no Coastal Sea in path. */
function nonCoastalState(): GameState {
  const state = baseState();
  return {
    ...state,
    phaseState: makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Border],
      destinationSiteType: SiteType.Haven,
    }),
  };
}

describe('Drowning Seas (tw-30)', () => {
  beforeEach(() => resetMint());

  test('playable on a company that moved to a site with a Coastal Sea in its path', () => {
    const state = baseState();
    const actions = viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, DROWNING_SEAS);
    expect(actions.length).toBeGreaterThan(0);
    const play = actions[0].action as PlayHazardAction;
    expect(play.targetCompanyId).toBe(companyIdAt(state, RESOURCE_PLAYER));
  });

  test('not playable when the moving company has no Coastal Sea in its path', () => {
    const state = nonCoastalState();
    const actions = viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, DROWNING_SEAS);
    expect(actions).toHaveLength(0);
  });

  test('without Doors of Night, only the item-loss-and-discard option is offered', () => {
    const state = baseState({ doorsOfNight: false });
    const actions = viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, DROWNING_SEAS);
    expect(actions).toHaveLength(1);
    expect((actions[0].action as PlayHazardAction).optionId).toBe('item-loss-and-discard');
  });

  test('with Doors of Night in play, both options are offered', () => {
    const state = baseState({ doorsOfNight: true });
    const actions = viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, DROWNING_SEAS);
    const optionIds = actions.map(a => (a.action as PlayHazardAction).optionId).sort();
    expect(optionIds).toEqual(['item-loss-and-discard', 'return-to-origin']);
  });

  test('item-loss-and-discard: the company loses one item (its own choice) and its player randomly discards two hand cards', () => {
    const state = baseState();
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId,
      optionId: 'item-loss-and-discard',
    });
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.chain).toBeNull();

    // The short-event card itself is discarded to the hazard player's pile.
    expect(afterChain.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId)).toContain(cardId);

    // Two of the three original hand cards were randomly discarded.
    expect(afterChain.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(afterChain.players[RESOURCE_PLAYER].discardPile).toHaveLength(2);

    // Aragorn's dagger is offered as the one item the company must lose.
    const pending = afterChain.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('discard-one-company-item');

    const choices = viableActions(afterChain, PLAYER_1, 'discard-item-from-company');
    expect(choices).toHaveLength(1);
    const chosen = choices[0].action as { itemInstanceId: CardInstanceId };
    const after = dispatch(afterChain, choices[0].action);
    expectCharItemCount(after, RESOURCE_PLAYER, ARAGORN, 0);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(chosen.itemInstanceId);
    expect(after.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('item-loss-and-discard: no items on the company — only the hand discard applies', () => {
    const state = baseState({ aragornItems: [] });
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId,
      optionId: 'item-loss-and-discard',
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(afterChain.players[RESOURCE_PLAYER].discardPile).toHaveLength(2);
    expect(afterChain.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('item-loss-and-discard: the random discard is capped at hand size', () => {
    const state = baseState({ hand: [GLAMDRING] });
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId,
      optionId: 'item-loss-and-discard',
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expect(afterChain.players[RESOURCE_PLAYER].discardPile).toHaveLength(1);
  });

  test('return-to-origin (Doors of Night in play): the company returns to its site of origin, untouched otherwise', () => {
    const state = baseState({ doorsOfNight: true });
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId,
      optionId: 'return-to-origin',
    });
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.chain).toBeNull();

    expect((afterChain.phaseState as MovementHazardPhaseState).returnedToOrigin).toBe(true);
    const constraints = afterChain.activeConstraints.filter(
      c => c.kind.type === 'site-phase-do-nothing'
        && c.target.kind === 'company'
        && c.target.companyId === targetCompanyId,
    );
    expect(constraints).toHaveLength(1);

    // No item loss, no hand discard — the alternative fully replaces the base effect.
    expect(afterChain.players[RESOURCE_PLAYER].hand).toHaveLength(3);
    expectCharItemCount(afterChain, RESOURCE_PLAYER, ARAGORN, 1);
    expect(afterChain.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });
});
