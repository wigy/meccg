/**
 * @module ba-6.test
 *
 * Card test: Crook-legged Orc (ba-6)
 * Type: minion-character (balrog-specific, Ringwraith alignment)
 *
 * Text: "Balrog specific. Discard on a body check result of 7."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology
 * rule): race orc, keywords ["balrog-specific"], prowess 3, body 7, mind 2,
 * directInfluence 0, marshallingPoints 0, skills warrior/ranger, homesite
 * "any non-Dark-hold Under-deeps site", discardBodyCheck [7]. Non-unique.
 *
 * Engine support table:
 * | # | Rule (card text)                       | Status | Notes                                                        |
 * |---|-----------------------------------------|--------|----------------------------------------------------------------|
 * | 1 | "Balrog specific."                     | OK     | keywords includes "balrog-specific" (data marker; deck-legality for avatar-specific cards is not enforced anywhere in this engine, matching every other "specific" card in the pool) |
 * | 2 | "Discard on a body check result of 7." | OK     | discardBodyCheck [7]; combat body check                        |
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. discardBodyCheck [7]: a body-check roll of exactly 7 discards the Orc
 *    (not eliminated); a roll of 8 (> body 7) eliminates it.
 *
 * Fixtures:
 *   CROOK_LEGGED_ORC (ba-6) — subject under test (orc, balrog-specific)
 *   MINAS_MORGUL (le-390)   — minion haven
 *   DOL_GULDUR (le-367)     — minion haven
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  findCharInstanceId, companyIdAt, dispatch, viableActions,
  makeBodyCheckCombat, makeShadowMHState, setCharStatus,
  RESOURCE_PLAYER, CardStatus,
} from '../test-helpers.js';
import { Phase, Alignment } from '../../index.js';
import type {
  CardDefinitionId, GameState,
} from '../../index.js';

const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;

const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven

describe('Crook-legged Orc (ba-6)', () => {
  beforeEach(() => resetMint());

  // ── Rule: "Discard on a body check result of 7." (discardBodyCheck [7]) ────

  test('Body check roll of exactly 7 discards the Orc (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const orcId = findCharInstanceId(state, RESOURCE_PLAYER, CROOK_LEGGED_ORC);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, CROOK_LEGGED_ORC, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: orcId }),
      cheatRollTotal: 7,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === orcId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === orcId)).toBe(false);
  });

  test('Body check roll above 7 (8) eliminates the Orc', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const orcId = findCharInstanceId(state, RESOURCE_PLAYER, CROOK_LEGGED_ORC);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, CROOK_LEGGED_ORC, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: orcId }),
      cheatRollTotal: 8,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === orcId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === orcId)).toBe(false);
  });
});
