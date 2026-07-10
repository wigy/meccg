/**
 * @module ba-8.test
 *
 * Card test: Mountain-maggot (ba-8)
 * Type: minion-character (balrog-specific, Ringwraith alignment)
 *
 * Text: "Balrog specific. Discard on a body check result of 7."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology
 * rule): race orc, keywords ["balrog-specific"], prowess 3, body 7, mind 1,
 * directInfluence 0, marshallingPoints 0, skills warrior, homesite
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
 * 1. discardBodyCheck [7]: a body-check roll of exactly 7 discards the
 *    Mountain-maggot (not eliminated); a roll of 8 (> body 7) eliminates it.
 *
 * Fixtures:
 *   MOUNTAIN_MAGGOT (ba-8) — subject under test (orc, balrog-specific)
 *   MINAS_MORGUL (le-390)  — minion haven
 *   DOL_GULDUR (le-367)    — minion haven
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

const MOUNTAIN_MAGGOT = 'ba-8' as CardDefinitionId;

const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven

describe('Mountain-maggot (ba-8)', () => {
  beforeEach(() => resetMint());

  // ── Rule: "Discard on a body check result of 7." (discardBodyCheck [7]) ────

  test('Body check roll of exactly 7 discards the Mountain-maggot (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [MOUNTAIN_MAGGOT] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const maggotId = findCharInstanceId(state, RESOURCE_PLAYER, MOUNTAIN_MAGGOT);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, MOUNTAIN_MAGGOT, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: maggotId }),
      cheatRollTotal: 7,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === maggotId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === maggotId)).toBe(false);
  });

  test('Body check roll above 7 (8) eliminates the Mountain-maggot', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [MOUNTAIN_MAGGOT] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const maggotId = findCharInstanceId(state, RESOURCE_PLAYER, MOUNTAIN_MAGGOT);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, MOUNTAIN_MAGGOT, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: maggotId }),
      cheatRollTotal: 8,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === maggotId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === maggotId)).toBe(false);
  });
});
