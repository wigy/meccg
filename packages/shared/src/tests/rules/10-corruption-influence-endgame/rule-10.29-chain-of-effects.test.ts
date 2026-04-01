/**
 * @module rule-10.29-chain-of-effects
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.29: Chain of Effects
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * When a player declares that they are taking an action, their opponent may declare that they are taking another action in response, prior to resolving any of those actions' effects; this sequence of unresolved declarations is called a chain of effects. When a chain of effects is initiated by a new action being declared, the player who didn't initiate the chain of effects may respond by declaring their own action, and so forth with alternating opportunities to declare additional responses. Once both players confirm that they have no more actions to take in response, the current chain of effects resolves in the reverse order of declaration (i.e. last in, first out). Players cannot take further actions while a chain of effects is resolving, and cannot take actions that would initiate a new chain of effects until a current chain of effects has completely resolved.
 * The resource player always has priority to initiate a new chain of effects.
 * Performing an action as an active condition does not initiate a separate chain of effects.
 * If a rule or effect happens "immediately," it resolves without initiating a chain of effects and without either player being allowed to respond.
 * If a card specifies that multiple separate actions are performed when the card resolves, the actions are considered to have been declared in the reverse order of how they are printed, and thus resolve in the same order as printed.
 * If a card is negated between the declaration of being played and resolving, it is immediately discarded.
 *
 * Tested using Twilight (tw-106), Gates of Morning (tw-243), and Doors of Night (tw-28)
 * as concrete environment cards that interact through the chain.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  TWILIGHT, GATES_OF_MORNING, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  viableActions,
  P1_COMPANY, makeMHState,
} from '../../test-helpers.js';
import { Phase } from '../../../index.js';
import type { CardInPlay, CardInstanceId, GameState } from '../../../index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Both players pass chain priority so the chain resolves. */
function passBothAndResolve(state: GameState): GameState {
  // Priority player passes first
  const p = state.chain!.priority;
  const opp = p === PLAYER_1 ? PLAYER_2 : PLAYER_1;
  let result = reduce(state, { type: 'pass-chain-priority', player: p });
  expect(result.error).toBeUndefined();
  result = reduce(result.state, { type: 'pass-chain-priority', player: opp });
  expect(result.error).toBeUndefined();
  return result.state;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Rule 10.29 — Chain of Effects', () => {
  beforeEach(() => resetMint());

  // ── 10.29: Declaring an action initiates a chain ──────────────────────────

  test('playing a permanent event initiates a chain of effects', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // Chain is created with the card on it
    expect(result.state.chain).not.toBeNull();
    expect(result.state.chain!.mode).toBe('declaring');
    expect(result.state.chain!.entries).toHaveLength(1);
    expect(result.state.chain!.entries[0].card?.instanceId).toBe(gomId);
    expect(result.state.chain!.entries[0].payload.type).toBe('permanent-event');
    expect(result.state.chain!.entries[0].resolved).toBe(false);

    // Card removed from hand, not yet in cardsInPlay (on the chain)
    expect(result.state.players[0].hand).toHaveLength(0);
    expect(result.state.players[0].cardsInPlay).toHaveLength(0);
  });

  // ── 10.29: Opponent gets priority to respond ──────────────────────────────

  test('opponent receives priority after chain is initiated', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // Non-initiator (P2) gets priority to respond
    expect(result.state.chain!.priority).toBe(PLAYER_2);
  });

  // ── 10.29: Alternating response opportunities ─────────────────────────────

  test('priority alternates between players during declaration', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING, TWILIGHT], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const p2Twilight = state.players[1].hand[0].instanceId;

    // P1 plays GoM → P2 gets priority
    let result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.state.chain!.priority).toBe(PLAYER_2);

    // P2 responds with Twilight targeting GoM → P1 gets priority
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });
    expect(result.error).toBeUndefined();
    expect(result.state.chain!.priority).toBe(PLAYER_1);

    // P1 can now respond (has Twilight in hand to target P2's Twilight on chain)
    const p1Actions = viableActions(result.state, PLAYER_1, 'play-short-event');
    expect(p1Actions.length).toBeGreaterThan(0);
  });

  // ── 10.29: LIFO resolution ────────────────────────────────────────────────

  test('chain resolves in reverse order of declaration (LIFO)', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING, TWILIGHT], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const p1Twilight = state.players[0].hand[1].instanceId;
    const p2Twilight = state.players[1].hand[0].instanceId;

    // P1 plays GoM → P2 gets priority
    let result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // P2 responds with Twilight targeting GoM on chain
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // P1 responds with Twilight targeting P2's Twilight on chain
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: p1Twilight, targetInstanceId: p2Twilight });
    expect(result.error).toBeUndefined();

    // Both pass → chain resolves LIFO:
    //   3. P1's Twilight resolves → negates P2's Twilight
    //   2. P2's Twilight resolves → negated, fizzles
    //   1. GoM resolves → enters play, discards DoN
    const s = passBothAndResolve(result.state);

    expect(s.chain).toBeNull();
    // GoM survived and entered play
    expect(s.players[0].cardsInPlay.some(c => c.instanceId === gomId)).toBe(true);
    // Doors of Night was discarded by GoM's enter-play effect
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain('don-1' as CardInstanceId);
  });

  // ── 10.29: Both players must pass to resolve ──────────────────────────────

  test('chain does not resolve until both players pass consecutively', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;

    // P1 plays GoM → P2 gets priority
    let result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // P2 passes → P1 gets priority
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(result.error).toBeUndefined();
    // Chain still active — only one player has passed
    expect(result.state.chain).not.toBeNull();
    expect(result.state.chain!.mode).toBe('declaring');
    expect(result.state.chain!.priority).toBe(PLAYER_1);

    // P1 passes → both passed consecutively → chain resolves
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.chain).toBeNull();
  });

  test('a new declaration resets the pass counter', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const p2Twilight = state.players[1].hand[0].instanceId;

    // P1 plays GoM → P2 gets priority
    let result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // P2 plays Twilight (instead of passing) → P1 gets priority
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });
    expect(result.error).toBeUndefined();
    expect(result.state.chain!.entries).toHaveLength(2);

    // P1 passes → chain still active (only P1 passed since last declaration)
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.chain).not.toBeNull();
    expect(result.state.chain!.mode).toBe('declaring');

    // P2 passes → now both passed → chain resolves
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(result.error).toBeUndefined();
    expect(result.state.chain).toBeNull();
  });

  // ── 10.29: Can respond to events declared earlier in the same chain ───────

  test('Twilight can target an environment declared earlier in the same chain', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;

    // P1 plays GoM → it goes on the chain
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // P2 can target GoM on the chain with Twilight
    const p2Actions = viableActions(result.state, PLAYER_2, 'play-short-event');
    const gomTargets = p2Actions.filter(
      ea => (ea.action as { targetInstanceId: CardInstanceId }).targetInstanceId === gomId,
    );
    expect(gomTargets).toHaveLength(1);
  });

  // ── 10.29.5: Negated card is discarded ────────────────────────────────────

  test('a negated card is discarded and its effects do not resolve', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const p2Twilight = state.players[1].hand[0].instanceId;

    // P1 plays GoM (would discard DoN on resolution)
    let result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // P2 cancels GoM with Twilight
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // Both pass → resolve
    const s = passBothAndResolve(result.state);

    expect(s.chain).toBeNull();
    // GoM was negated → discarded, never enters play
    expect(s.players[0].cardsInPlay).toHaveLength(0);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(gomId);
    // DoN survives since GoM's enter-play effect never fired
    expect(s.players[1].cardsInPlay).toHaveLength(1);
    expect(s.players[1].cardsInPlay[0].instanceId).toBe('don-1' as CardInstanceId);
  });

  // ── 10.29: Hazard permanent events also go through the chain ──────────────

  test('Doors of Night enters the chain when declared as a hazard', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = mhGameState.players[1].hand[0].instanceId;

    // P2 plays DoN as a hazard → chain starts
    const result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBeUndefined();

    expect(result.state.chain).not.toBeNull();
    expect(result.state.chain!.entries).toHaveLength(1);
    expect(result.state.chain!.entries[0].card?.instanceId).toBe(donId);
    // Card on chain, not in hand or cardsInPlay
    expect(result.state.players[1].hand).toHaveLength(0);
    expect(result.state.players[1].cardsInPlay).toHaveLength(0);
    // Resource player gets priority to respond
    expect(result.state.chain!.priority).toBe(PLAYER_1);
  });

  // ── 10.29: Multi-card chain with three declarations ───────────────────────

  test('three-deep chain: GoM → Twilight → Twilight resolves correctly', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING, TWILIGHT], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const p1Twilight = state.players[0].hand[1].instanceId;
    const p2Twilight = state.players[1].hand[0].instanceId;

    // 1. P1 plays GoM
    let result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // 2. P2 plays Twilight targeting GoM
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });
    expect(result.error).toBeUndefined();
    expect(result.state.chain!.entries).toHaveLength(2);

    // 3. P1 plays Twilight targeting P2's Twilight
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: p1Twilight, targetInstanceId: p2Twilight });
    expect(result.error).toBeUndefined();
    expect(result.state.chain!.entries).toHaveLength(3);

    // Both pass → LIFO resolution:
    //   #3 P1 Twilight → negates P2 Twilight
    //   #2 P2 Twilight → negated, fizzles
    //   #1 GoM → resolves, enters play
    const s = passBothAndResolve(result.state);

    expect(s.chain).toBeNull();
    expect(s.players[0].cardsInPlay.some(c => c.instanceId === gomId)).toBe(true);
    // Both Twilights in discard
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(p1Twilight);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain(p2Twilight);
  });

  // ── 10.29: Cannot act during resolution ───────────────────────────────────

  test('no actions available while chain is resolving (auto-resolution)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;

    // Play GoM → both pass → chain resolves automatically
    let result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // P2 passes
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(result.error).toBeUndefined();

    // P1 passes → both passed → chain resolves (auto-resolution means
    // we go straight to null chain, no intermediate 'resolving' state visible)
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.chain).toBeNull();

    // GoM is now in play
    expect(result.state.players[0].cardsInPlay.some(c => c.instanceId === gomId)).toBe(true);
  });

  // ── 10.29: Resource player has priority to initiate ───────────────────────

  test('resource player has priority when hazard player initiates chain in M/H', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = mhGameState.players[1].hand[0].instanceId;

    // P2 (hazard player) plays DoN → P1 (resource player) gets priority
    const result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBeUndefined();
    expect(result.state.chain!.priority).toBe(PLAYER_1);
  });

  // ── 10.29: DoN cancels GoM, response with Twilight saves GoM ──────────────

  test('resource player can cancel Doors of Night with Twilight to save Gates of Morning', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = mhGameState.players[1].hand[0].instanceId;
    const p1Twilight = mhGameState.players[0].hand[0].instanceId;

    // P2 plays DoN → P1 gets priority
    let result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBeUndefined();

    // P1 responds with Twilight targeting DoN on chain
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: p1Twilight, targetInstanceId: donId });
    expect(result.error).toBeUndefined();

    // Both pass → resolve LIFO: Twilight negates DoN
    const s = passBothAndResolve(result.state);

    expect(s.chain).toBeNull();
    // DoN was negated → discarded
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain(donId);
    // GoM survived
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].instanceId).toBe('gom-1' as CardInstanceId);
  });

  // ── 10.29: Only priority player can act ───────────────────────────────────

  test('non-priority player cannot pass or declare during chain', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;

    // P1 plays GoM → P2 gets priority
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();
    expect(result.state.chain!.priority).toBe(PLAYER_2);

    // P1 tries to pass but doesn't have priority
    const wrongPass = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(wrongPass.error).toBeDefined();
  });

  // ── 10.29.5: Negated permanent event goes to declaring player's discard ───

  test('negated permanent event goes to declaring player discard pile', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const p2Twilight = state.players[1].hand[0].instanceId;

    // P1 plays GoM
    let result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // P2 cancels with Twilight
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });
    expect(result.error).toBeUndefined();

    const s = passBothAndResolve(result.state);

    // GoM goes to P1's (declaring player's) discard
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(gomId);
    // Twilight goes to P2's discard (short events always go to discard)
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain(p2Twilight);
  });

  // ── 10.29.2: Active conditions don't start separate chain ─────────────────

  test.todo('performing an action as an active condition does not initiate a separate chain');

  // ── 10.29.3: Immediate effects bypass the chain ───────────────────────────

  test.todo('"immediately" effects resolve without chain and without response window');

  // ── 10.29.4: Multiple actions on card resolve in printed order ────────────

  test.todo('multiple separate actions on a resolved card execute in printed order');
});
