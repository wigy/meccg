/**
 * @module wh-4.test
 *
 * Card test: Gandalf (wh-4)
 * Type: hero-character (Fallen-wizard avatar)
 *
 * Printed text:
 *   "Unique. Can use spirit-magic. May untap at the end of your organization
 *    phase. Your characters and hero allies are each worth full marshalling
 *    points. Gandalf may tap to test a gold ring in his company."
 *
 * Card shape (data):
 *   - Fallen-wizard avatar; `race: 'fallen-wizard'`; `skills` includes
 *     `spirit-magic` ("Can use spirit-magic" — a spirit-magic spell's play-target
 *     filter `target.skills $includes spirit-magic` accepts him, exactly as for
 *     the certified Pallando wh-7).
 *   - effects:
 *     1. fw-mp-full (cards: characters) (player-wide, no filter) — every character the FW
 *        controls scores its full printed character MP instead of the MEWH §4
 *        flat-1 clamp ("Your characters … worth full marshalling points").
 *     2. fw-mp-full (cards: allies) (player-wide, filter cardType hero-resource-ally) — the
 *        FW's hero allies score full printed MP instead of the §4 1-MP clamp
 *        ("… and hero allies are each worth full marshalling points").
 *     3. grant-action untap-self — an organization-phase ability (cost-free,
 *        once per turn, gated `when bearer.status tapped`) that sets Gandalf
 *        untapped ("May untap at the end of your organization phase").
 *     4. grant-action test-gold-ring — Gandalf taps to test a gold ring in his
 *        company (2d6 roll then discard the ring), identical to the wizard
 *        Gandalf tw-156.
 *
 * These tests drive the recompute / grant-action / effect-resolver pipelines;
 * the card shape is documented above rather than asserted against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, PRECIOUS_GOLD_RING,
  ISENGARD, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  recomputeDerived, attachAllyToChar,
  dispatch, dispatchResult, viableActions, findCharInstanceId, getCharacter,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import { getEffectiveSkills } from '../../engine/effects/index.js';
import type { CardDefinitionId, GameState, ActivateGrantedAction } from '../../index.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const GANDALF_FW = 'wh-4' as CardDefinitionId; // the card under test
const SARUMAN_FW = 'wh-9' as CardDefinitionId; // a different FW avatar (no full-MP-for-characters/hero-allies rules) — control

// LEGOLAS (tw-168) is a hero character with printed character MP 2 → clamped to
// 1 for a FW without Gandalf, full 2 with him.
// TREEBEARD (tw-353) is a hero ally with printed MP 2 → clamped to 1 without
// Gandalf, full 2 with him.
const TREEBEARD = 'tw-353' as CardDefinitionId; // hero-resource-ally, printed 2

/** A Fallen-wizard (player 0) at Isengard with `avatar` + `others`, plus an idle opponent. */
function fwState(avatar: CardDefinitionId, others: CardDefinitionId[] = []): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: [avatar, ...others] }],
        hand: [],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
    ],
  });
}

/** All viable untap-self grant-action activations for the FW player. */
function untapActions(state: GameState): ActivateGrantedAction[] {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(a => a.action as ActivateGrantedAction)
    .filter(a => a.actionId === 'untap-self');
}

describe('Gandalf (wh-4)', () => {
  beforeEach(() => resetMint());

  // ─── Clause: "Can use spirit-magic" ────────────────────────────────────────
  // Represented by the `spirit-magic` entry in Gandalf's skills; a spirit-magic
  // spell's play-target filter (`target.skills $includes spirit-magic`, resolved
  // through getEffectiveSkills) accepts a caster iff his effective skills include
  // spirit-magic. Assert the resolver recognizes Gandalf and rejects a companion
  // who does not use spirit-magic.

  test('Gandalf is recognized as a spirit-magic user; a non-user companion is not', () => {
    const state = recomputeDerived(fwState(GANDALF_FW, [ARAGORN]));

    const gandalf = getCharacter(state, RESOURCE_PLAYER, GANDALF_FW);
    const gandalfSkills = getEffectiveSkills(state, gandalf, state.cardPool[GANDALF_FW] as { skills?: readonly string[] });
    expect(gandalfSkills).toContain('spirit-magic');

    // Control: Aragorn does not use spirit-magic → a spirit-magic spell could not
    // be cast by him. Proves the caster-eligibility path discriminates.
    const aragorn = getCharacter(state, RESOURCE_PLAYER, ARAGORN);
    const aragornSkills = getEffectiveSkills(state, aragorn, state.cardPool[ARAGORN] as { skills?: readonly string[] });
    expect(aragornSkills).not.toContain('spirit-magic');
  });

  // ─── Clause: "May untap at the end of your organization phase" ──────────────

  test('a tapped Gandalf is offered the untap-self ability during the organization phase', () => {
    let state = fwState(GANDALF_FW);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW);
    // Tap Gandalf.
    state = {
      ...state,
      players: [
        {
          ...state.players[0],
          characters: {
            ...state.players[0].characters,
            [gandalfId]: { ...state.players[0].characters[gandalfId], status: CardStatus.Tapped },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };

    const actions = untapActions(state);
    expect(actions.length).toBe(1);
    expect(actions[0].characterId).toBe(gandalfId);
  });

  test('untap-self sets Gandalf untapped', () => {
    let state = fwState(GANDALF_FW);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW);
    state = {
      ...state,
      players: [
        {
          ...state.players[0],
          characters: {
            ...state.players[0].characters,
            [gandalfId]: { ...state.players[0].characters[gandalfId], status: CardStatus.Tapped },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };

    const actions = untapActions(state);
    expect(actions.length).toBe(1);

    const next = dispatch(state, actions[0]);
    expectCharStatus(next, RESOURCE_PLAYER, GANDALF_FW, CardStatus.Untapped);

    // Once untapped (and once-per-turn locked), the ability is no longer offered.
    expect(untapActions(next).length).toBe(0);
  });

  test('an already-untapped Gandalf is NOT offered the untap-self ability', () => {
    const state = fwState(GANDALF_FW); // Gandalf starts untapped
    expect(untapActions(state).length).toBe(0);
  });

  test('untap-self remains offered while Gandalf (the avatar) is mid CoE 2.II.6 sideboard access', () => {
    // Regression: tapping Gandalf to access the sideboard (CoE 2.II.6) opens a
    // sub-flow that only suspends *organizing* (2.II.1) — it must not also
    // suppress Gandalf's own, independent untap-self grant-action.
    let state = fwState(GANDALF_FW);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW);
    state = {
      ...state,
      players: [
        {
          ...state.players[0],
          characters: {
            ...state.players[0].characters,
            [gandalfId]: { ...state.players[0].characters[gandalfId], status: CardStatus.Tapped },
          },
        },
        state.players[1],
      ] as typeof state.players,
      phaseState: {
        phase: Phase.Organization,
        characterPlayedThisTurn: false,
        sideboardFetchedThisTurn: 1,
        sideboardFetchDestination: 'discard',
      } as GameState['phaseState'],
    };

    const actions = untapActions(state);
    expect(actions.length).toBe(1);
    expect(actions[0].characterId).toBe(gandalfId);
  });

  // ─── Clause: "Your characters … are each worth full marshalling points" ─────

  test('a hero character the FW controls scores full printed character MP (2) with Gandalf', () => {
    // Legolas (hero character, printed character MP 2). Gandalf's avatar MP is 0,
    // so the character total is Legolas's contribution only.
    let state = fwState(GANDALF_FW, [LEGOLAS]);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(2);
  });

  test('control: without Gandalf the same hero character is FW-clamped to 1', () => {
    // Saruman avatar — no fw-mp-full (cards: characters) → §4 clamp → Legolas worth 1.
    let state = fwState(SARUMAN_FW, [LEGOLAS]);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(1);
  });

  // ─── Clause: "… and hero allies are each worth full marshalling points" ─────

  test('a hero ally scores full printed MP (2) while Gandalf is in play', () => {
    // Treebeard (hero-resource-ally, printed 2). MEWH §4 would clamp him to 1;
    // Gandalf's fw-mp-full (cards: allies) lifts hero allies to full printed MP.
    let state = fwState(GANDALF_FW);
    state = attachAllyToChar(state, RESOURCE_PLAYER, GANDALF_FW, TREEBEARD);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(2);
  });

  test('control: without Gandalf the same hero ally is FW-clamped to 1', () => {
    let state = fwState(SARUMAN_FW);
    state = attachAllyToChar(state, RESOURCE_PLAYER, SARUMAN_FW, TREEBEARD);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(1);
  });

  // ─── Clause: "Gandalf may tap to test a gold ring in his company" ───────────

  test('untapped Gandalf with a gold ring in company can activate test-gold-ring', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [{ defId: GANDALF_FW, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'test-gold-ring');
    expect(actions.length).toBe(1);
    expect(actions[0].characterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW));
    const ringInstanceId = getCharacter(state, RESOURCE_PLAYER, GANDALF_FW).items[0].instanceId;
    expect(actions[0].targetCardId).toBe(ringInstanceId);
  });

  test('test-gold-ring taps Gandalf, rolls 2d6, and discards the gold ring', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [{ defId: GANDALF_FW, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(base, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'test-gold-ring');
    expect(actions.length).toBe(1);

    // Tapping enqueues the shared gold-ring test; the roll resolves it.
    const afterActivate = dispatch(base, actions[0]);
    expectCharStatus(afterActivate, RESOURCE_PLAYER, GANDALF_FW, CardStatus.Tapped);

    const cheated = { ...afterActivate, cheatRollTotal: 10 };
    const rolls = viableActions(cheated, PLAYER_1, 'gold-ring-test-roll');
    expect(rolls.length).toBe(1);

    const result = dispatchResult(cheated, rolls[0].action);
    const next = result.state;

    expectCharItemCount(next, RESOURCE_PLAYER, GANDALF_FW, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
    expect(next.players[0].lastDiceRoll).toBeDefined();
    expect(next.players[0].lastDiceRoll!.die1 + next.players[0].lastDiceRoll!.die2).toBe(10);
    expect(result.effects).toBeDefined();
    expect(result.effects!.some(e => e.effect === 'dice-roll')).toBe(true);
  });

  test('MEWH §10: a Fallen-wizard testing a hero gold ring rolls at -1', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [{ defId: GANDALF_FW, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(base, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'test-gold-ring');
    const afterActivate = dispatch(base, actions[0]);
    const rolls = viableActions(afterActivate, PLAYER_1, 'gold-ring-test-roll');
    // Precious Gold Ring makes The One Ring eligible on a 10+. Rolling a raw 10
    // as a Fallen-wizard yields a modified 9, which falls short.
    const afterRoll = dispatch({ ...afterActivate, cheatRollTotal: 10 }, rolls[0].action);

    const pending = afterRoll.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type !== 'ring-play-offer') throw new Error('expected ring-play-offer');
    expect(pending[0].kind.rollTotal).toBe(9);
    expect(pending[0].kind.eligibleCategories).not.toContain('the-one-ring');
    expect(pending[0].kind.eligibleCategories).toContain('dwarven-ring');
  });

  test('sanity: computeLegalActions runs for a Gandalf FW company (no crash)', () => {
    const state = fwState(GANDALF_FW, [LEGOLAS]);
    expect(() => computeLegalActions(state, PLAYER_1)).not.toThrow();
  });
});
