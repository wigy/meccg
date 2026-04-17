/**
 * @module rule-metd-dragon-mp-attribution
 *
 * METD §4.1: only the **opponent** of the player who played a Dragon
 * manifestation may earn marshalling points from defeating it. If the
 * player who played it defeats their own manifestation, no MPs are
 * awarded. Owner is derivable from the {@link CardInstanceId} prefix
 * (`<playerId>-<counter>`).
 */

import { describe, expect, test } from 'vitest';
import { ARAGORN, BILBO, LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH } from '../../../index.js';
import type { CardDefinitionId, CardInstance, CardInstanceId } from '../../../index.js';
import { Phase } from '../../../index.js';
import { recomputeDerived } from '../../../engine/recompute-derived.js';
import { PLAYER_1, PLAYER_2, buildTestState } from '../../test-helpers.js';

const SMAUG = 'tw-90' as CardDefinitionId;
const CAVE_DRAKE = 'tw-020' as CardDefinitionId; // non-manifestation dragon-race creature for control

function baseState() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

function placeInKillPile(
  state: ReturnType<typeof baseState>,
  killerIdx: 0 | 1,
  card: CardInstance,
) {
  const newPlayer = { ...state.players[killerIdx], killPile: [...state.players[killerIdx].killPile, card] };
  const players = killerIdx === 0
    ? [newPlayer, state.players[1]]
    : [state.players[0], newPlayer];
  return { ...state, players: players as typeof state.players };
}

describe('METD §4.1 — Dragon manifestation MP attribution', () => {
  test('opponent who defeats your Smaug earns the kill MPs', () => {
    // P1 played Smaug → instance prefix is p1; P2 defeats it → P2's killPile.
    const smaugFromP1: CardInstance = { instanceId: 'p1-7' as CardInstanceId, definitionId: SMAUG };
    const state = recomputeDerived(placeInKillPile(baseState(), 1, smaugFromP1));
    // Smaug killMP = 5.
    expect(state.players[1].marshallingPoints.kill).toBe(5);
    expect(state.players[0].marshallingPoints.kill).toBe(0);
  });

  test('defeating your own Smaug earns no MPs', () => {
    // P1 played Smaug, P1 also defeats it → P1's killPile, but owner=P1.
    const smaugFromP1: CardInstance = { instanceId: 'p1-7' as CardInstanceId, definitionId: SMAUG };
    const state = recomputeDerived(placeInKillPile(baseState(), 0, smaugFromP1));
    expect(state.players[0].marshallingPoints.kill).toBe(0);
    expect(state.players[1].marshallingPoints.kill).toBe(0);
  });

  test('non-manifestation creatures award MP regardless of who minted them', () => {
    // Cave-drake has no manifestId. P1 plays it; P1 also defeats it (e.g.
    // friendly fire via some effect) — P1 still scores it normally,
    // because the §4.1 carve-out only applies to manifestations.
    const drakeFromP1: CardInstance = { instanceId: 'p1-7' as CardInstanceId, definitionId: CAVE_DRAKE };
    const state = recomputeDerived(placeInKillPile(baseState(), 0, drakeFromP1));
    // Cave-drake killMP = 1.
    expect(state.players[0].marshallingPoints.kill).toBe(1);
  });
});
