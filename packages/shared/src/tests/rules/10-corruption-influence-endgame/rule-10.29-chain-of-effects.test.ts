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
  reduce, dispatch,
  ARAGORN, LEGOLAS,
  SUN, TWILIGHT, GATES_OF_MORNING, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  viableActions,
  P1_COMPANY, makeMHState,
  handCardId,
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

    const gomId = handCardId(state, 0);
    const nextState = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // Chain is created with the card on it
    expect(nextState.chain).not.toBeNull();
    expect(nextState.chain!.mode).toBe('declaring');
    expect(nextState.chain!.entries).toHaveLength(1);
    expect(nextState.chain!.entries[0].card?.instanceId).toBe(gomId);
    expect(nextState.chain!.entries[0].payload.type).toBe('permanent-event');
    expect(nextState.chain!.entries[0].resolved).toBe(false);

    // Card removed from hand, not yet in cardsInPlay (on the chain)
    expect(nextState.players[0].hand).toHaveLength(0);
    expect(nextState.players[0].cardsInPlay).toHaveLength(0);
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

    const gomId = handCardId(state, 0);
    const nextState = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // Non-initiator (P2) gets priority to respond
    expect(nextState.chain!.priority).toBe(PLAYER_2);
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

    const gomId = handCardId(state, 0);
    const p2Twilight = handCardId(state, 1);

    // P1 plays GoM → P2 gets priority
    const afterGom = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(afterGom.chain!.priority).toBe(PLAYER_2);

    // P2 responds with Twilight targeting GoM → P1 gets priority
    const afterTwilight = dispatch(afterGom, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });
    expect(afterTwilight.chain!.priority).toBe(PLAYER_1);

    // P1 can now respond (has Twilight in hand to target P2's Twilight on chain)
    const p1Actions = viableActions(afterTwilight, PLAYER_1, 'play-short-event');
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

    const gomId = handCardId(state, 0);
    const p1Twilight = handCardId(state, 0, 1);
    const p2Twilight = handCardId(state, 1);

    // P1 plays GoM → P2 gets priority
    const afterGom = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // P2 responds with Twilight targeting GoM on chain
    const afterP2Twilight = dispatch(afterGom, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });

    // P1 responds with Twilight targeting P2's Twilight on chain
    const afterP1Twilight = dispatch(afterP2Twilight, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: p1Twilight, targetInstanceId: p2Twilight });

    // Both pass → chain resolves LIFO:
    //   3. P1's Twilight resolves → negates P2's Twilight
    //   2. P2's Twilight resolves → negated, fizzles
    //   1. GoM resolves → enters play, discards DoN
    const s = passBothAndResolve(afterP1Twilight);

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

    const gomId = handCardId(state, 0);

    // P1 plays GoM → P2 gets priority
    const afterGom = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // P2 passes → P1 gets priority
    const afterP2Pass = dispatch(afterGom, { type: 'pass-chain-priority', player: PLAYER_2 });
    // Chain still active — only one player has passed
    expect(afterP2Pass.chain).not.toBeNull();
    expect(afterP2Pass.chain!.mode).toBe('declaring');
    expect(afterP2Pass.chain!.priority).toBe(PLAYER_1);

    // P1 passes → both passed consecutively → chain resolves
    const afterP1Pass = dispatch(afterP2Pass, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(afterP1Pass.chain).toBeNull();
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

    const gomId = handCardId(state, 0);
    const p2Twilight = handCardId(state, 1);

    // P1 plays GoM → P2 gets priority
    const afterGom = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // P2 plays Twilight (instead of passing) → P1 gets priority
    const afterTwilight = dispatch(afterGom, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });
    expect(afterTwilight.chain!.entries).toHaveLength(2);

    // P1 passes → chain still active (only P1 passed since last declaration)
    const afterP1Pass = dispatch(afterTwilight, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(afterP1Pass.chain).not.toBeNull();
    expect(afterP1Pass.chain!.mode).toBe('declaring');

    // P2 passes → now both passed → chain resolves
    const afterP2Pass = dispatch(afterP1Pass, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(afterP2Pass.chain).toBeNull();
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

    const gomId = handCardId(state, 0);

    // P1 plays GoM → it goes on the chain
    const nextState = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // P2 can target GoM on the chain with Twilight
    const p2Actions = viableActions(nextState, PLAYER_2, 'play-short-event');
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

    const gomId = handCardId(state, 0);
    const p2Twilight = handCardId(state, 1);

    // P1 plays GoM (would discard DoN on resolution)
    const afterGom = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // P2 cancels GoM with Twilight
    const afterTwilight = dispatch(afterGom, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });

    // Both pass → resolve
    const s = passBothAndResolve(afterTwilight);

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
    const donId = handCardId(mhGameState, 1);

    // P2 plays DoN as a hazard → chain starts
    const nextState = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });

    expect(nextState.chain).not.toBeNull();
    expect(nextState.chain!.entries).toHaveLength(1);
    expect(nextState.chain!.entries[0].card?.instanceId).toBe(donId);
    // Card on chain, not in hand or cardsInPlay
    expect(nextState.players[1].hand).toHaveLength(0);
    expect(nextState.players[1].cardsInPlay).toHaveLength(0);
    // Resource player gets priority to respond
    expect(nextState.chain!.priority).toBe(PLAYER_1);
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

    const gomId = handCardId(state, 0);
    const p1Twilight = handCardId(state, 0, 1);
    const p2Twilight = handCardId(state, 1);

    // 1. P1 plays GoM
    const afterGom = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // 2. P2 plays Twilight targeting GoM
    const afterP2Twilight = dispatch(afterGom, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });
    expect(afterP2Twilight.chain!.entries).toHaveLength(2);

    // 3. P1 plays Twilight targeting P2's Twilight
    const afterP1Twilight = dispatch(afterP2Twilight, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: p1Twilight, targetInstanceId: p2Twilight });
    expect(afterP1Twilight.chain!.entries).toHaveLength(3);

    // Both pass → LIFO resolution:
    //   #3 P1 Twilight → negates P2 Twilight
    //   #2 P2 Twilight → negated, fizzles
    //   #1 GoM → resolves, enters play
    const s = passBothAndResolve(afterP1Twilight);

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

    const gomId = handCardId(state, 0);

    // Play GoM → both pass → chain resolves automatically
    const afterGom = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // P2 passes
    const afterP2Pass = dispatch(afterGom, { type: 'pass-chain-priority', player: PLAYER_2 });

    // P1 passes → both passed → chain resolves (auto-resolution means
    // we go straight to null chain, no intermediate 'resolving' state visible)
    const afterP1Pass = dispatch(afterP2Pass, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(afterP1Pass.chain).toBeNull();

    // GoM is now in play
    expect(afterP1Pass.players[0].cardsInPlay.some(c => c.instanceId === gomId)).toBe(true);
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
    const donId = handCardId(mhGameState, 1);

    // P2 (hazard player) plays DoN → P1 (resource player) gets priority
    const nextState = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(nextState.chain!.priority).toBe(PLAYER_1);
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
    const donId = handCardId(mhGameState, 1);
    const p1Twilight = handCardId(mhGameState, 0);

    // P2 plays DoN → P1 gets priority
    const afterDon = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });

    // P1 responds with Twilight targeting DoN on chain
    const afterTwilight = dispatch(afterDon, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: p1Twilight, targetInstanceId: donId });

    // Both pass → resolve LIFO: Twilight negates DoN
    const s = passBothAndResolve(afterTwilight);

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

    const gomId = handCardId(state, 0);

    // P1 plays GoM → P2 gets priority
    const nextState = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(nextState.chain!.priority).toBe(PLAYER_2);

    // P1 tries to pass but doesn't have priority
    const wrongPass = reduce(nextState, { type: 'pass-chain-priority', player: PLAYER_1 });
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

    const gomId = handCardId(state, 0);
    const p2Twilight = handCardId(state, 1);

    // P1 plays GoM
    const afterGom = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // P2 cancels with Twilight
    const afterTwilight = dispatch(afterGom, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });

    const s = passBothAndResolve(afterTwilight);

    // GoM goes to P1's (declaring player's) discard
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(gomId);
    // Twilight goes to P2's discard (short events always go to discard)
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain(p2Twilight);
  });

  // ── 10.29.2: Active conditions don't start separate chain ─────────────────
  //
  // Active conditions are abilities used "in response" to a parent chain (e.g.
  // tap a sage during a strike). The chain machinery currently has no
  // distinct active-condition mode separate from regular declarations; this
  // sub-rule will be exercised once the engine models that distinction.
  test.todo('performing an action as an active condition does not initiate a separate chain');

  // ── 10.29.3: Immediate effects bypass the chain ───────────────────────────

  test('"immediately" rule transitions resolve without opening a chain', () => {
    // Rule 4.01 says the resource player's resource long-events are
    // discarded "immediately" at the start of the long-event phase. That
    // discard is performed by the phase transition itself — no chain is
    // ever opened, and neither player is given a window to respond.
    const sun: CardInPlay = {
      instanceId: 'sun-1' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          cardsInPlay: [sun],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    expect(state.chain).toBeNull();

    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // Phase advanced and Sun was discarded — but no chain was opened
    // for either player to respond to during the transition.
    expect(next.phaseState.phase).toBe(Phase.LongEvent);
    expect(next.chain).toBeNull();
    expect(next.players[0].cardsInPlay.some(c => c.instanceId === 'sun-1')).toBe(false);
    expect(next.players[0].discardPile.some(c => c.instanceId === 'sun-1')).toBe(true);
  });

  // ── 10.29.4: Multiple actions on card resolve in printed order ────────────
  //
  // The DSL currently models a card's resolve effect as a single `apply`
  // value rather than an ordered list of "separately printed" actions, so
  // there is no in-pool card whose ordering can be observed from outside.
  // This will be exercised once a multi-action resolve is supported.
  test.todo('multiple separate actions on a resolved card execute in printed order');
});
