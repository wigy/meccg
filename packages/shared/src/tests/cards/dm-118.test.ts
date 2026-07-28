/**
 * @module dm-118.test
 *
 * Card test: Balance Between Powers (dm-118)
 * Type: hero-resource-event (permanent), keyword: environment, 0 MP, not unique
 *
 * Card text:
 *   "Environment. No environment cards can be played. At the start of your
 *    organization phase, discard this card or keep it in play by discarding an
 *    environment card from your hand. Your opponent can then discard an
 *    environment card from his hand to discard this card, which you can counter
 *    by discarding two environment cards from your hand, which he can counter by
 *    discarding one, which you can counter with two, he with one, etc. Discard
 *    when any play deck is exhausted."
 *
 * Effects:
 *   1. prohibit-card-play, filter keywords $includes environment — the
 *      class-wide play-lock, enforced for both players in every play window.
 *   2. event-maintenance, trigger controller-organization-phase-start,
 *      handCardFilter environment, counterChain {challenge 1, counter 2} — the
 *      upkeep payment and the bidding war that follows it.
 *   3. on-event play-deck-exhausted → move self to discard.
 *
 * | # | Effect                                             | Status | Notes                                        |
 * |---|----------------------------------------------------|--------|----------------------------------------------|
 * | 1 | prohibit-card-play (filter: environment)           | OK     | applyCardPlayProhibitions in legal-actions   |
 * | 2 | event-maintenance upkeep + counter chain           | OK     | event-maintenance pending resolution         |
 * | 3 | on-event: play-deck-exhausted, discard-self        | OK     | completeDeckExhaust in reducer-utils         |
 *
 * Playable: YES
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  addCardInPlay,
  buildHazardMovingState,
  dispatch,
  nonViableOfType,
  reduce,
  resolveChain,
  runActions,
  HAZARD_PLAYER, RESOURCE_PLAYER,
  expectInDiscardPile,
  Phase,
  viableActions,
  viableFor,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, EndOfTurnPhaseState, GameState, PendingResolution, PlayerId } from '../../index.js';

const BALANCE = 'dm-118' as CardDefinitionId;

/** Environment resource long-event with no other rules — the "cannot be played" probe. */
const FOG = 'tw-241' as CardDefinitionId;
/** A second plain environment resource long-event, so a 2-card counter is payable. */
const CLEAR_SKIES = 'tw-203' as CardDefinitionId;
/** Environment resource short-event — a third distinct environment for hand payments. */
const STARS = 'tw-331' as CardDefinitionId;
/** Non-environment resource long-event — the control that must stay playable. */
const ELF_SONG = 'tw-223' as CardDefinitionId;
/** Environment hazard long-event — the hazard-side "cannot be played" probe. */
const CLOUDS = 'tw-22' as CardDefinitionId;
/** Environment hazard permanent-event — an environment that persists in play. */
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;

/** The queued `event-maintenance` resolution, if any. */
function maintenance(state: GameState): PendingResolution | undefined {
  return state.pendingResolutions.find(r => r.kind.type === 'event-maintenance');
}

/** The `event-maintenance` stage/actor/cost currently on offer, for compact assertions. */
function maintenanceStage(state: GameState): { stage: string; actor: PlayerId; remainingToPay: number } | undefined {
  const res = maintenance(state);
  if (!res || res.kind.type !== 'event-maintenance') return undefined;
  return { stage: res.kind.stage, actor: res.actor, remainingToPay: res.kind.remainingToPay };
}

/** Instance id of the first hand card with the given definition. */
function handCardOf(state: GameState, playerIdx: 0 | 1, defId: CardDefinitionId): CardInstanceId {
  const card = state.players[playerIdx].hand.find(c => c.definitionId === defId);
  if (!card) throw new Error(`No ${defId as string} in player ${playerIdx}'s hand`);
  return card.instanceId;
}

/** Instance id of Balance Between Powers in the resource player's `cardsInPlay`. */
function balanceInstance(state: GameState): CardInstanceId {
  const card = state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === BALANCE);
  if (!card) throw new Error('Balance Between Powers is not in play');
  return card.instanceId;
}

/** True while Balance Between Powers is still on the table. */
function balanceInPlay(state: GameState): boolean {
  return state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === BALANCE);
}

/**
 * Untap state with Balance Between Powers in P1's `cardsInPlay`, ready to be
 * driven into P1's organization phase (where the upkeep fires). `p1Hand` /
 * `p2Hand` seed the environments each side can spend on the bidding war.
 */
function untapStateWithBalance(p1Hand: CardDefinitionId[], p2Hand: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Untap,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: p1Hand, siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: p2Hand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return addCardInPlay(base, RESOURCE_PLAYER, BALANCE);
}

/** Drive the untap phase to its end so the organization phase (and the upkeep) begins. */
function enterOrganization(state: GameState): GameState {
  return runActions(state, [
    { type: 'untap', player: PLAYER_1 },
    { type: 'pass', player: PLAYER_2 },
  ]);
}

/** Pay one card of the current maintenance stage from `player`'s hand. */
function payFromHand(state: GameState, player: PlayerId, playerIdx: 0 | 1, defId: CardDefinitionId): GameState {
  return dispatch(state, {
    type: 'pay-event-maintenance',
    player,
    paymentType: 'discard-from-hand',
    cardInstanceId: handCardOf(state, playerIdx, defId),
    sourceInstanceId: balanceInstance(state),
  });
}

describe('Balance Between Powers (dm-118)', () => {
  beforeEach(() => resetMint());

  // ---- Rule 1: "No environment cards can be played." ----

  describe('no environment cards can be played', () => {
    function longEventState(inPlay: boolean): GameState {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.LongEvent,
        players: [
          { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [FOG, ELF_SONG], siteDeck: [MORIA] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        ],
      });
      return inPlay ? addCardInPlay(base, RESOURCE_PLAYER, BALANCE) : base;
    }

    test('an environment resource long-event is playable without Balance in play', () => {
      const actions = viableActions(longEventState(false), PLAYER_1, 'play-long-event');
      const defIds = actions.map(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
      expect(defIds).toHaveLength(2);
    });

    test('the controller may not play an environment while Balance is in play', () => {
      const state = longEventState(true);
      const playable = viableActions(state, PLAYER_1, 'play-long-event')
        .map(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
      const fogId = handCardOf(state, RESOURCE_PLAYER, FOG);
      expect(playable).not.toContain(fogId);
    });

    test('non-environment resource events stay playable', () => {
      const state = longEventState(true);
      const playable = viableActions(state, PLAYER_1, 'play-long-event')
        .map(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
      expect(playable).toEqual([handCardOf(state, RESOURCE_PLAYER, ELF_SONG)]);
    });

    test('the prohibited environment is reported as not-playable, once', () => {
      const state = longEventState(true);
      const fogId = handCardOf(state, RESOURCE_PLAYER, FOG);
      const dimmed = nonViableOfType(computeLegalActions(state, PLAYER_1), 'not-playable')
        .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === fogId);
      expect(dimmed).toHaveLength(1);
      expect(dimmed[0].reason).toContain('prohibited');
    });

    test('the opponent may not play a hazard environment either', () => {
      const base = buildHazardMovingState(MORIA, 'Moria', [CLOUDS]);
      const cloudsId = handCardOf(base, HAZARD_PLAYER, CLOUDS);

      const withoutBalance = viableActions(base, PLAYER_2, 'play-hazard')
        .map(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
      expect(withoutBalance).toContain(cloudsId);

      const withBalance = viableActions(addCardInPlay(base, RESOURCE_PLAYER, BALANCE), PLAYER_2, 'play-hazard')
        .map(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
      expect(withBalance).not.toContain(cloudsId);
    });

    test('playing Balance leaves the environments already in play alone', () => {
      // Unlike a `cardNames` prohibition (The Under-roads as-106), the
      // class-wide filter never sweeps the table on entry.
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        players: [
          { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [BALANCE], siteDeck: [MORIA] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        ],
      });
      const withDoors = addCardInPlay(base, HAZARD_PLAYER, DOORS_OF_NIGHT);

      const play = viableActions(withDoors, PLAYER_1, 'play-permanent-event')
        .find(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === handCardOf(withDoors, RESOURCE_PLAYER, BALANCE));
      expect(play).toBeDefined();

      const after = resolveChain(dispatch(withDoors, play!.action));
      expect(balanceInPlay(after)).toBe(true);
      expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === DOORS_OF_NIGHT)).toBe(true);
    });
  });

  // ---- Rule 2: upkeep at the start of the controller's organization phase ----

  describe('organization-phase upkeep', () => {
    test('an upkeep decision is queued for the controller as their organization phase begins', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG], []));

      expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
      expect(maintenanceStage(afterOrg)).toEqual({ stage: 'upkeep', actor: PLAYER_1, remainingToPay: 1 });
    });

    test('no upkeep fires on the opponent\'s turn', () => {
      const base = buildTestState({
        activePlayer: PLAYER_2,
        phase: Phase.Untap,
        players: [
          { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [FOG], siteDeck: [MORIA] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        ],
      });
      const withBalance = addCardInPlay(base, RESOURCE_PLAYER, BALANCE);
      const afterOrg = runActions(withBalance, [
        { type: 'untap', player: PLAYER_2 },
        { type: 'pass', player: PLAYER_1 },
      ]);

      expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
      expect(maintenance(afterOrg)).toBeUndefined();
      expect(balanceInPlay(afterOrg)).toBe(true);
    });

    test('with no environment in hand the only option is to give the card up', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([ELF_SONG], []));

      const actions = viableActions(afterOrg, PLAYER_1, 'pay-event-maintenance');
      expect(actions).toHaveLength(1);
      expect((actions[0].action as { paymentType: string }).paymentType).toBe('discard-self');

      const afterPay = dispatch(afterOrg, actions[0].action);
      expect(balanceInPlay(afterPay)).toBe(false);
      expectInDiscardPile(afterPay, RESOURCE_PLAYER, BALANCE);
      expect(maintenance(afterPay)).toBeUndefined();
    });

    test('with an environment in hand both keeping and discarding are offered', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG], []));

      const payments = viableActions(afterOrg, PLAYER_1, 'pay-event-maintenance')
        .map(ea => (ea.action as { paymentType: string }).paymentType);
      expect(payments).toEqual(['discard-self', 'discard-from-hand']);
    });

    test('the opponent has nothing to do while the controller decides', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG], []));
      expect(viableFor(afterOrg, PLAYER_2)).toHaveLength(0);
    });

    test('discarding an environment from hand keeps the card in play', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG], []));
      const afterPay = payFromHand(afterOrg, PLAYER_1, RESOURCE_PLAYER, FOG);

      expect(balanceInPlay(afterPay)).toBe(true);
      expectInDiscardPile(afterPay, RESOURCE_PLAYER, FOG);
      expect(afterPay.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === FOG)).toBe(false);
      // Opponent holds no environment, so no challenge follows.
      expect(maintenance(afterPay)).toBeUndefined();
    });

    test('a non-environment hand card cannot pay the upkeep', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG, ELF_SONG], []));
      const result = reduce(afterOrg, {
        type: 'pay-event-maintenance',
        player: PLAYER_1,
        paymentType: 'discard-from-hand',
        cardInstanceId: handCardOf(afterOrg, RESOURCE_PLAYER, ELF_SONG),
        sourceInstanceId: balanceInstance(afterOrg),
      });
      expect(result.error).toBeDefined();
      expect(balanceInPlay(result.state)).toBe(true);
    });

    test('the upkeep fires again on the controller\'s next turn', () => {
      const first = enterOrganization(untapStateWithBalance([FOG, CLEAR_SKIES], []));
      const kept = payFromHand(first, PLAYER_1, RESOURCE_PLAYER, FOG);
      expect(balanceInPlay(kept)).toBe(true);

      // Rewind to another untap phase for the same player and advance again.
      const nextTurn = enterOrganization({
        ...kept,
        phaseState: {
          phase: Phase.Untap,
          untapped: false,
          hazardSideboardDestination: null,
          hazardSideboardFetched: 0,
          hazardSideboardAccessed: false,
          resourcePlayerPassed: false,
          hazardPlayerPassed: false,
        },
      } as GameState);

      expect(maintenanceStage(nextTurn)).toEqual({ stage: 'upkeep', actor: PLAYER_1, remainingToPay: 1 });
    });
  });

  // ---- Rule 3: the counter chain ----

  describe('counter chain', () => {
    test('after the controller pays, the opponent is offered a 1-card challenge', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG], [CLOUDS]));
      const afterPay = payFromHand(afterOrg, PLAYER_1, RESOURCE_PLAYER, FOG);

      expect(maintenanceStage(afterPay)).toEqual({ stage: 'challenge', actor: PLAYER_2, remainingToPay: 1 });
      const payments = viableActions(afterPay, PLAYER_2, 'pay-event-maintenance')
        .map(ea => (ea.action as { paymentType: string }).paymentType);
      expect(payments).toEqual(['decline', 'discard-from-hand']);
      // The controller waits while the opponent bids.
      expect(viableFor(afterPay, PLAYER_1)).toHaveLength(0);
    });

    test('the opponent declining leaves the card in play', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG], [CLOUDS]));
      const afterPay = payFromHand(afterOrg, PLAYER_1, RESOURCE_PLAYER, FOG);

      const afterDecline = dispatch(afterPay, {
        type: 'pay-event-maintenance',
        player: PLAYER_2,
        paymentType: 'decline',
        cardInstanceId: balanceInstance(afterPay),
        sourceInstanceId: balanceInstance(afterPay),
      });

      expect(balanceInPlay(afterDecline)).toBe(true);
      expect(maintenance(afterDecline)).toBeUndefined();
      expect(afterDecline.players[HAZARD_PLAYER].hand.some(c => c.definitionId === CLOUDS)).toBe(true);
    });

    test('an opponent with no environment in hand is never offered a challenge', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG], [ELF_SONG]));
      const afterPay = payFromHand(afterOrg, PLAYER_1, RESOURCE_PLAYER, FOG);

      expect(maintenance(afterPay)).toBeUndefined();
      expect(balanceInPlay(afterPay)).toBe(true);
    });

    test('a challenge the controller cannot counter discards the card', () => {
      // P1 keeps the card with its last environment, so no 2-card counter is left.
      const afterOrg = enterOrganization(untapStateWithBalance([FOG], [CLOUDS]));
      const afterPay = payFromHand(afterOrg, PLAYER_1, RESOURCE_PLAYER, FOG);
      const afterChallenge = payFromHand(afterPay, PLAYER_2, HAZARD_PLAYER, CLOUDS);

      expect(balanceInPlay(afterChallenge)).toBe(false);
      expectInDiscardPile(afterChallenge, RESOURCE_PLAYER, BALANCE);
      expectInDiscardPile(afterChallenge, HAZARD_PLAYER, CLOUDS);
      expect(maintenance(afterChallenge)).toBeUndefined();
    });

    test('a challenge the controller can afford offers a 2-card counter', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG, CLEAR_SKIES, STARS], [CLOUDS]));
      const afterPay = payFromHand(afterOrg, PLAYER_1, RESOURCE_PLAYER, FOG);
      const afterChallenge = payFromHand(afterPay, PLAYER_2, HAZARD_PLAYER, CLOUDS);

      expect(maintenanceStage(afterChallenge)).toEqual({ stage: 'counter', actor: PLAYER_1, remainingToPay: 2 });
      expect(balanceInPlay(afterChallenge)).toBe(true);
    });

    test('declining to counter discards the card', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG, CLEAR_SKIES, STARS], [CLOUDS]));
      const afterChallenge = payFromHand(
        payFromHand(afterOrg, PLAYER_1, RESOURCE_PLAYER, FOG),
        PLAYER_2, HAZARD_PLAYER, CLOUDS,
      );

      const afterDecline = dispatch(afterChallenge, {
        type: 'pay-event-maintenance',
        player: PLAYER_1,
        paymentType: 'decline',
        cardInstanceId: balanceInstance(afterChallenge),
        sourceInstanceId: balanceInstance(afterChallenge),
      });

      expect(balanceInPlay(afterDecline)).toBe(false);
      expectInDiscardPile(afterDecline, RESOURCE_PLAYER, BALANCE);
      // The two counter cards were never spent.
      expect(afterDecline.players[RESOURCE_PLAYER].hand).toHaveLength(2);
    });

    test('the counter is paid one card at a time and cannot be abandoned midway', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG, CLEAR_SKIES, STARS], [CLOUDS]));
      const afterChallenge = payFromHand(
        payFromHand(afterOrg, PLAYER_1, RESOURCE_PLAYER, FOG),
        PLAYER_2, HAZARD_PLAYER, CLOUDS,
      );

      const halfPaid = payFromHand(afterChallenge, PLAYER_1, RESOURCE_PLAYER, CLEAR_SKIES);
      expect(maintenanceStage(halfPaid)).toEqual({ stage: 'counter', actor: PLAYER_1, remainingToPay: 1 });

      // Only the remaining payment is offered — no way out at this point.
      const payments = viableActions(halfPaid, PLAYER_1, 'pay-event-maintenance')
        .map(ea => (ea.action as { paymentType: string }).paymentType);
      expect(payments).toEqual(['discard-from-hand']);

      const declined = reduce(halfPaid, {
        type: 'pay-event-maintenance',
        player: PLAYER_1,
        paymentType: 'decline',
        cardInstanceId: balanceInstance(halfPaid),
        sourceInstanceId: balanceInstance(halfPaid),
      });
      expect(declined.error).toBeDefined();
    });

    test('a completed counter hands the bidding back to the opponent', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG, CLEAR_SKIES, STARS], [CLOUDS, FOG]));
      const afterChallenge = payFromHand(
        payFromHand(afterOrg, PLAYER_1, RESOURCE_PLAYER, FOG),
        PLAYER_2, HAZARD_PLAYER, CLOUDS,
      );
      const countered = payFromHand(
        payFromHand(afterChallenge, PLAYER_1, RESOURCE_PLAYER, CLEAR_SKIES),
        PLAYER_1, RESOURCE_PLAYER, STARS,
      );

      expect(balanceInPlay(countered)).toBe(true);
      expect(countered.players[RESOURCE_PLAYER].hand).toHaveLength(0);
      // Opponent still holds one environment, so he may challenge again for 1.
      expect(maintenanceStage(countered)).toEqual({ stage: 'challenge', actor: PLAYER_2, remainingToPay: 1 });

      // …and this time the controller has nothing left to counter with.
      const secondChallenge = payFromHand(countered, PLAYER_2, HAZARD_PLAYER, FOG);
      expect(balanceInPlay(secondChallenge)).toBe(false);
      expect(maintenance(secondChallenge)).toBeUndefined();
    });

    test('a completed counter with an exhausted opponent ends the exchange', () => {
      const afterOrg = enterOrganization(untapStateWithBalance([FOG, CLEAR_SKIES, STARS], [CLOUDS]));
      const afterChallenge = payFromHand(
        payFromHand(afterOrg, PLAYER_1, RESOURCE_PLAYER, FOG),
        PLAYER_2, HAZARD_PLAYER, CLOUDS,
      );
      const countered = payFromHand(
        payFromHand(afterChallenge, PLAYER_1, RESOURCE_PLAYER, CLEAR_SKIES),
        PLAYER_1, RESOURCE_PLAYER, STARS,
      );

      expect(balanceInPlay(countered)).toBe(true);
      expect(maintenance(countered)).toBeUndefined();
      // The organization phase resumes normally for the controller.
      expect(viableFor(countered, PLAYER_1).length).toBeGreaterThan(0);
    });
  });

  // ---- Rule 4: "Discard when any play deck is exhausted." ----

  test('discarded when the opponent\'s play deck is exhausted', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: [],
          discardPile: [CLOUDS],
        },
      ],
    });
    const atResetHand = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [true, false] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withBalance = addCardInPlay(atResetHand, RESOURCE_PLAYER, BALANCE);

    const afterExhaust = dispatch(withBalance, { type: 'deck-exhaust', player: PLAYER_2 });
    const after = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });

    expect(balanceInPlay(after)).toBe(false);
    expectInDiscardPile(after, RESOURCE_PLAYER, BALANCE);
  });
});
