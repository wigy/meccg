/**
 * @module as-85-the-great-eye.test
 *
 * Card test: The Great Eye (as-85)
 * Type: minion-resource-event (long)
 * Alignment: ringwraith
 *
 * Card text:
 *   "Playable if you are Sauron. The hazard limit against all companies is
 *    decreased by one (to a minimum of two). If this card is in play, you can
 *    discard it to target and cancel the play of a hazard event played by
 *    your opponent before it resolves. This cannot be used against an
 *    on-guard card. Cannot be duplicated."
 *
 * Effects:
 *   1. play-condition — requires "player-state", `player.playsAsSauron`
 *      (true while a `play-as-sauron` marker such as The Lidless Eye le-203
 *      is in play for the player). Evaluated on the long-event play path.
 *   2. hazard-limit-environment — value -1, floor 2, appliesTo "all":
 *      every company's hazard limit (moving or stationary, either player's)
 *      is decreased by one, never below two.
 *   3. cancel-hazard-event-play — while in play, may be discarded during
 *      chain declaring to negate an opponent's unresolved hazard *event*
 *      entry (never a creature, never an on-guard reveal).
 *   4. duplication-limit scope:game max:1 — cannot be duplicated.
 *
 * Fixtures (minion, per the card's Ringwraith alignment):
 *   THE_MOUTH/GORBAG/SHAGRAT/LAGDUF (le-24/le-11/le-39/le-18) — company members
 *   DOL_GULDUR (le-367, Darkhaven), MORIA_MINION (le-392, Shadow-hold)
 *   LIDLESS_EYE (le-203) — the play-as-sauron marker
 *   DOORS_OF_NIGHT (tw-28) — opponent's hazard permanent-event to cancel
 *   CHOKING_SHADOWS (tw-21) — opponent's hazard short-event to cancel
 *   ORC_GUARD (tw-072) — hazard creature (never a legal cancel target)
 *   NURNIAGS/NURNIAG_CAMP + FOOLISH_WORDS (td-25) — influence attempt with an
 *   on-guard hazard event (excluded target)
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, mint, dispatch, resolveChain,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  GANDALF, ARAGORN, LEGOLAS, GIMLI,
  LORIEN, MINAS_TIRITH,
  viableActions, findHandCardId, findCharInstanceId,
  makeMHState, makeSitePhase, snapshotHazardLimitFor, placeOnGuard,
  expectInDiscardPile,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType, CardStatus, FOOLISH_WORDS, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState,
  MovementHazardPhaseState, InfluenceAttemptAction, CancelHazardEventAction,
} from '../../index.js';

const GREAT_EYE = 'as-85' as CardDefinitionId;
/** The Lidless Eye — carries the `play-as-sauron` marker (le-203). */
const LIDLESS_EYE = 'le-203' as CardDefinitionId;
/** Minion characters (non-avatar). */
const THE_MOUTH = 'le-24' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;
const CIRYAHER = 'le-6' as CardDefinitionId;
/** Minion sites. */
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
/** Minion faction + home site for the on-guard influence-attempt test. */
const NURNIAGS = 'le-273' as CardDefinitionId;
const NURNIAG_CAMP = 'le-396' as CardDefinitionId;
/** Opponent hazards. */
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;
const CHOKING_SHADOWS = 'tw-21' as CardDefinitionId;
const ORC_GUARD = 'tw-072' as CardDefinitionId;

const greatEyeInPlay = (): CardInPlay => ({
  instanceId: mint(),
  definitionId: GREAT_EYE,
  status: CardStatus.Untapped,
});

const lidlessEyeInPlay = (): CardInPlay => ({
  instanceId: mint(),
  definitionId: LIDLESS_EYE,
  status: CardStatus.Untapped,
});

/** Minion P1 in the long-event phase with The Great Eye in hand. */
const longEventState = (cardsInPlay: CardInPlay[]): GameState =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.LongEvent,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
        hand: [GREAT_EYE],
        siteDeck: [DOL_GULDUR],
        cardsInPlay,
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });

const greatEyePlayActions = (state: GameState) =>
  viableActions(state, PLAYER_1, 'play-long-event').filter(ea =>
    (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId
      === findHandCardId(state, RESOURCE_PLAYER, GREAT_EYE));

/**
 * Minion P1 hazard-limit snapshot: a P1 company of `characters` (moving to
 * MORIA_MINION unless `moving: false`) has its hazard limit snapshotted at
 * site revelation; returns the resulting limit. Mirrors
 * {@link snapshotHazardLimitFor} with minion fixtures and the in-play cards
 * owned by the resource player (The Great Eye's controller).
 */
const minionHazardLimit = (
  characters: CardDefinitionId[],
  opts?: { moving?: boolean; resourceInPlay?: CardInPlay[] },
): number => {
  const moving = opts?.moving ?? true;
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters, ...(moving ? { destinationSite: MORIA_MINION } : {}) }],
        hand: [],
        siteDeck: [MORIA_MINION],
        cardsInPlay: opts?.resourceInPlay ?? [],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
  const ready = { ...state, phaseState: makeMHState({ step: 'set-hazard-limit', activeCompanyIndex: 0 }) };
  const after = dispatch(ready, { type: 'pass', player: PLAYER_1 });
  return (after.phaseState as MovementHazardPhaseState).hazardLimitAtReveal;
};

/**
 * Minion P1 mid-M/H (play-hazards step) with The Great Eye in play (unless
 * `withGreatEye: false`) and the given hazards in P2's hand.
 */
const mhResponseState = (p2Hand: CardDefinitionId[], opts?: { withGreatEye?: boolean }): GameState => {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MORIA_MINION, characters: [THE_MOUTH, GORBAG] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
        cardsInPlay: (opts?.withGreatEye ?? true) ? [greatEyeInPlay()] : [],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: p2Hand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState({
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    }),
  };
};

describe('The Great Eye (as-85)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable only as Sauron ────────────────────────────────────

  test('NOT playable in the long-event phase when the player is not Sauron', () => {
    expect(greatEyePlayActions(longEventState([]))).toHaveLength(0);
  });

  test('playable as Sauron and resolves into play', () => {
    const state = longEventState([lidlessEyeInPlay()]);
    const plays = greatEyePlayActions(state);
    expect(plays).toHaveLength(1);

    const after = resolveChain(dispatch(state, plays[0].action));
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GREAT_EYE)).toBe(true);
  });

  // ── Rule 4: cannot be duplicated ───────────────────────────────────────

  test('cannot be duplicated — not playable while a copy is already in play', () => {
    const state = longEventState([lidlessEyeInPlay(), greatEyeInPlay()]);
    expect(greatEyePlayActions(state)).toHaveLength(0);
  });

  // ── Rule 2: hazard limit −1 against all companies (min 2) ─────────────

  test('decreases a moving company-of-4 hazard limit from 4 to 3', () => {
    const chars = [THE_MOUTH, GORBAG, SHAGRAT, LAGDUF];
    expect(minionHazardLimit(chars)).toBe(4);
    expect(minionHazardLimit(chars, { resourceInPlay: [greatEyeInPlay()] })).toBe(3);
  });

  test('never reduces the limit below two (company of 2 stays at 2)', () => {
    expect(minionHazardLimit([THE_MOUTH, GORBAG], { resourceInPlay: [greatEyeInPlay()] })).toBe(2);
  });

  test('a company of 3 drops exactly to the floor of two', () => {
    expect(minionHazardLimit([THE_MOUTH, GORBAG, SHAGRAT], { resourceInPlay: [greatEyeInPlay()] })).toBe(2);
  });

  test('also reaches a stationary (non-moving) company — "against all companies"', () => {
    const chars = [THE_MOUTH, GORBAG, SHAGRAT, LAGDUF];
    expect(minionHazardLimit(chars, { moving: false })).toBe(4);
    expect(minionHazardLimit(chars, { moving: false, resourceInPlay: [greatEyeInPlay()] })).toBe(3);
  });

  test("also decreases the opponent's companies' hazard limit (owner is the hazard player)", () => {
    // The hero company moves on its own turn while the minion opponent's
    // Great Eye (hazard player's cardsInPlay) is still in play.
    const heroes = [GANDALF, ARAGORN, LEGOLAS, GIMLI];
    expect(snapshotHazardLimitFor(heroes)).toBe(4);
    expect(snapshotHazardLimitFor(heroes, { envInPlay: [GREAT_EYE] })).toBe(3);
  });

  // ── Rule 3: discard to cancel an opponent's hazard event ──────────────

  test('offers a cancel against a hand-played hazard permanent-event, and canceling discards both cards', () => {
    const state = mhResponseState([DOORS_OF_NIGHT]);
    const donId = findHandCardId(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;

    const afterPlay = dispatch(state, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: companyId,
    });
    expect(afterPlay.chain).not.toBeNull();

    const cancels = viableActions(afterPlay, PLAYER_1, 'cancel-hazard-event');
    expect(cancels).toHaveLength(1);
    const cancel = cancels[0].action as CancelHazardEventAction;
    expect(cancel.targetInstanceId).toBe(donId);

    const afterCancel = dispatch(afterPlay, cancel);
    // The Great Eye is discarded from play as the cost.
    expect(afterCancel.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GREAT_EYE)).toBe(false);
    expectInDiscardPile(afterCancel, RESOURCE_PLAYER, GREAT_EYE);

    // The canceled event never enters play and lands in its owner's discard
    // exactly once (no duplicate instance from the chain-completion flush).
    const done = resolveChain(afterCancel);
    expect(done.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === DOORS_OF_NIGHT)).toBe(false);
    expect(done.players[HAZARD_PLAYER].discardPile.filter(c => c.instanceId === donId)).toHaveLength(1);
  });

  test('cancels a hand-played hazard short-event without duplicating its discarded instance', () => {
    const state = mhResponseState([CHOKING_SHADOWS]);
    const shadowsId = findHandCardId(state, HAZARD_PLAYER, CHOKING_SHADOWS);
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;

    const afterPlay = dispatch(state, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: shadowsId, targetCompanyId: companyId,
    });
    const cancels = viableActions(afterPlay, PLAYER_1, 'cancel-hazard-event');
    expect(cancels).toHaveLength(1);

    const done = resolveChain(dispatch(afterPlay, cancels[0].action));
    // Short events are discarded at play time; the negated-entry flush must
    // not add a second copy of the same instance.
    expect(done.players[HAZARD_PLAYER].discardPile.filter(c => c.instanceId === shadowsId)).toHaveLength(1);
    expectInDiscardPile(done, RESOURCE_PLAYER, GREAT_EYE);
  });

  test('NOT offered when The Great Eye is not in play', () => {
    const state = mhResponseState([DOORS_OF_NIGHT], { withGreatEye: false });
    const donId = findHandCardId(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;

    const afterPlay = dispatch(state, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: companyId,
    });
    expect(viableActions(afterPlay, PLAYER_1, 'cancel-hazard-event')).toHaveLength(0);
  });

  test('NOT offered against a hazard creature', () => {
    const state = mhResponseState([ORC_GUARD]);
    const orcId = findHandCardId(state, HAZARD_PLAYER, ORC_GUARD);
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });
    expect(afterPlay.chain).not.toBeNull();
    expect(viableActions(afterPlay, PLAYER_1, 'cancel-hazard-event')).toHaveLength(0);
  });

  test('NOT offered against a hazard event revealed from on-guard', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }],
          hand: [NURNIAGS],
          siteDeck: [CARN_DUM],
          cardsInPlay: [greatEyeInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, FOOLISH_WORDS);
    const state = { ...withOG, phaseState: makeSitePhase() };

    // Declare the influence attempt (starts a chain), then the hazard player
    // reveals Foolish Words from on-guard onto the chain.
    const attempt = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER));
    expect(attempt).toBeDefined();
    const afterAttempt = dispatch(state, attempt!);

    const reveals = viableActions(afterAttempt, PLAYER_2, 'reveal-on-guard');
    expect(reveals.length).toBeGreaterThan(0);
    const afterReveal = dispatch(afterAttempt, reveals[0].action);

    // The revealed event sits unresolved on the chain, but it is an on-guard
    // card — The Great Eye may not target it.
    expect(afterReveal.chain).not.toBeNull();
    expect(afterReveal.chain!.entries.some(e => e.card?.instanceId === ogCard.instanceId && !e.resolved)).toBe(true);
    expect(viableActions(afterReveal, PLAYER_1, 'cancel-hazard-event')).toHaveLength(0);
  });
});
