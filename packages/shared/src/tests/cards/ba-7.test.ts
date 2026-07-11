/**
 * @module ba-7.test
 *
 * Card test: Hill-troll (ba-7)
 * Type: minion-character (balrog-specific, Ringwraith alignment)
 *
 * Text: "Balrog specific. Discard on a body check result of 7."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology
 * rule): race troll, keywords ["balrog-specific"], prowess 5, body 7, mind 3,
 * directInfluence 0, marshallingPoints 1, skills warrior, homesite
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
 *    Hill-troll (not eliminated); a roll of 8 (> body 7) eliminates it.
 *
 * Fixtures:
 *   HILL_TROLL (ba-7)      — subject under test (troll, balrog-specific)
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

const HILL_TROLL = 'ba-7' as CardDefinitionId;

const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven

describe('Hill-troll (ba-7)', () => {
  beforeEach(() => resetMint());

  // ── Rule: "Discard on a body check result of 7." (discardBodyCheck [7]) ────

  test('Body check roll of exactly 7 discards the Hill-troll (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HILL_TROLL] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const trollId = findCharInstanceId(state, RESOURCE_PLAYER, HILL_TROLL);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, HILL_TROLL, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: trollId }),
      cheatRollTotal: 7,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === trollId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === trollId)).toBe(false);
  });

  test('Body check roll above 7 (8) eliminates the Hill-troll', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HILL_TROLL] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const trollId = findCharInstanceId(state, RESOURCE_PLAYER, HILL_TROLL);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, HILL_TROLL, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: trollId }),
      cheatRollTotal: 8,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === trollId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === trollId)).toBe(false);
  });
});
