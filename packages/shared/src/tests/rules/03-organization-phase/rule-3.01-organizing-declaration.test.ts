/**
 * @module rule-3.01-organizing-declaration
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.01: Organizing Declaration
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The resource player may declare that they are "organizing" during their organization phase if they have not already done so this turn. While organizing, the resource player may Play (or Discard) a Character (2.II.2) and/or Set Company Composition (2.II.3); no other actions can be taken while organizing.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, viableFor, Phase,
  viablePlayCharacterActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA,
} from '../../test-helpers.js';

/** Action types that constitute "setting company composition" (rule 3.23). */
const COMPOSITION_ACTION_TYPES = new Set([
  'split-company', 'merge-companies',
  'move-to-company', 'move-to-influence', 'move-to-follower',
]);

describe('Rule 3.01 — Organizing Declaration', () => {
  beforeEach(() => resetMint());

  test('While organizing, playing a character and setting company composition are both available — one does not exhaust the other', () => {
    // P1 has an existing two-character company (offers composition actions)
    // AND a playable character in hand — both branches of "Play (or Discard)
    // a Character and/or Set Company Composition" are open simultaneously.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
          hand: [LEGOLAS],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [],
        },
      ],
      recompute: true,
    });

    expect(viablePlayCharacterActions(state, PLAYER_1).length).toBeGreaterThan(0);
    const compositionBefore = viableFor(state, PLAYER_1)
      .filter(a => COMPOSITION_ACTION_TYPES.has(a.action.type));
    expect(compositionBefore.length).toBeGreaterThan(0);

    // Playing the character does not consume the composition permission —
    // it remains available afterward in the same organization phase.
    const play = viablePlayCharacterActions(state, PLAYER_1)[0];
    const after = dispatch(state, play);
    const compositionAfter = viableFor(after, PLAYER_1)
      .filter(a => COMPOSITION_ACTION_TYPES.has(a.action.type));
    expect(compositionAfter.length).toBeGreaterThan(0);
  });
});
