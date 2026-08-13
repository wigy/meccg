/**
 * @module rule-7.03-eot-passive-condition-order
 *
 * CoE Rules — Section 7: End-of-Turn Phase
 * Rule 7.03: Step 3 — order of end-of-turn passive-condition actions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Ending the Turn, Step 3) The resource player signals the end of the turn.
 * Actions with end-of-turn passive conditions are declared and resolved in
 * an order chosen by the resource player. No other action can be taken
 * during this step unless it is specifically allowed at the end of the turn
 * (which does not include actions that may be taken during the end-of-turn
 * phase generally).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve,
  addCardToDiscardPile,
  grantedActionsFor,
  dispatch,
} from '../../test-helpers.js';
import type { CardDefinitionId, GameState } from '../../../index.js';
import { Phase, Alignment } from '../../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──────

/** Pallando — Fallen-wizard avatar that can carry both items below at once,
 *  giving one player two independent end-of-turn-only grant-actions live at
 *  the same time (the scenario the ordering clause under test governs). */
const PALLANDO = 'wh-7' as CardDefinitionId;
/** Pallando's Hood — end-of-turn fetch of one of three named cards. */
const PALLANDOS_HOOD = 'wh-105' as CardDefinitionId;
/** Stave of Pallando — end-of-turn fetch of a faction card. */
const STAVE_OF_PALLANDO = 'wh-107' as CardDefinitionId;
/** Fetch target for Pallando's Hood. */
const GIFTS_AS_GIVEN_OF_OLD = 'le-188' as CardDefinitionId;
/** Fetch target for Stave of Pallando (any faction card). */
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven (haven site). */
const ISENGARD = 'wh-56' as CardDefinitionId;

const HOOD_FETCH = 'pallandos-hood-fetch';
const STAVE_FETCH = 'stave-of-pallando-fetch';

// ── Builders ─────────────────────────────────────────────────────────────────

/** Organization-phase state: FallenWizard P1 (avatar Pallando) with both
 *  end-of-turn-only items in hand. */
function pallandoOrgState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: [PALLANDO] }],
        hand: [PALLANDOS_HOOD, STAVE_OF_PALLANDO],
        siteDeck: [ISENGARD],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: ISENGARD, characters: [] }],
        hand: [],
        siteDeck: [ISENGARD],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

/** Attach both items to Pallando, seed the discard pile with both fetch
 *  targets, and enter the end-of-turn signal-end step (CRF 22 — after hand
 *  size has been reconciled, mirroring wh-92.test.ts). */
function pallandoSignalEndWithBothItems(): GameState {
  const org = pallandoOrgState();
  const pallandoId = findCharInstanceId(org, RESOURCE_PLAYER, PALLANDO);
  const hoodId = findHandCardId(org, RESOURCE_PLAYER, PALLANDOS_HOOD);
  const afterHood = playPermanentEventAndResolve(org, PLAYER_1, hoodId, pallandoId);
  const staveId = findHandCardId(afterHood, RESOURCE_PLAYER, STAVE_OF_PALLANDO);
  const afterStave = playPermanentEventAndResolve(afterHood, PLAYER_1, staveId, pallandoId);

  const withGifts = addCardToDiscardPile(afterStave, RESOURCE_PLAYER, GIFTS_AS_GIVEN_OF_OLD);
  const withBoth = addCardToDiscardPile(withGifts, RESOURCE_PLAYER, GOBLINS_OF_GOBLIN_GATE);

  return {
    ...withBoth,
    phaseState: { phase: Phase.EndOfTurn, step: 'signal-end', discardDone: [true, true], resetHandDone: [true, true] },
  } as GameState;
}

describe('Rule 7.03 — Step 3: order of end-of-turn passive-condition actions', () => {
  beforeEach(() => resetMint());

  // The engine has no distinct "declare order" step between reset-hand and
  // signal-end (see rule 7.01) — instead, end-of-turn-only grant-actions are
  // offered concurrently via the normal action-dispatch loop, and the
  // resource player picks which to invoke first simply by choosing which
  // action to dispatch. Pallando's Hood (wh-105) and Stave of Pallando
  // (wh-107) are both `endOfTurnOnly` grant-actions that can be attached to
  // the same avatar simultaneously, giving a concrete two-trigger scenario
  // to assert the "order chosen by the resource player" clause against.

  test('two simultaneous end-of-turn-only grant-actions are both offered at signal-end', () => {
    const state = pallandoSignalEndWithBothItems();
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    expect(grantedActionsFor(state, pallandoId, HOOD_FETCH, PLAYER_1)).toHaveLength(1);
    expect(grantedActionsFor(state, pallandoId, STAVE_FETCH, PLAYER_1)).toHaveLength(1);
  });

  test('the resource player may resolve the triggers in either order — Hood then Stave', () => {
    const state = pallandoSignalEndWithBothItems();
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    const hoodGrant = grantedActionsFor(state, pallandoId, HOOD_FETCH, PLAYER_1)[0];
    const afterHood = dispatch(state, hoodGrant);

    // Resolving the Hood first does not consume or hide the Stave's trigger.
    const staveGrant = grantedActionsFor(afterHood, pallandoId, STAVE_FETCH, PLAYER_1)[0];
    expect(staveGrant).toBeDefined();
    const afterBoth = dispatch(afterHood, staveGrant);

    expect(afterBoth.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === GIFTS_AS_GIVEN_OF_OLD)).toBe(true);
    expect(afterBoth.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === GOBLINS_OF_GOBLIN_GATE)).toBe(true);
  });

  test('the resource player may resolve the triggers in either order — Stave then Hood', () => {
    const state = pallandoSignalEndWithBothItems();
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    const staveGrant = grantedActionsFor(state, pallandoId, STAVE_FETCH, PLAYER_1)[0];
    const afterStave = dispatch(state, staveGrant);

    // Resolving the Stave first does not consume or hide the Hood's trigger.
    const hoodGrant = grantedActionsFor(afterStave, pallandoId, HOOD_FETCH, PLAYER_1)[0];
    expect(hoodGrant).toBeDefined();
    const afterBoth = dispatch(afterStave, hoodGrant);

    expect(afterBoth.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === GIFTS_AS_GIVEN_OF_OLD)).toBe(true);
    expect(afterBoth.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === GOBLINS_OF_GOBLIN_GATE)).toBe(true);
  });
});
