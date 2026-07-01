/**
 * @module rule-8.31-orc-troll-body-check
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.31: Orc/Troll Body Check Discard
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If an Orc or Troll character would be both discarded and eliminated as the result of a body check, discard the character instead of eliminating it.
 * Effects that modify a character's body also modify the number on which an Orc or Troll is discarded. An applied maximum to an Orc's or Troll's body also applies to its discard number.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, Alignment } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint,
  dispatch, viableActions, findCharInstanceId, companyIdAt,
  makeShadowMHState, makeBodyCheckCombat, setCharStatus,
  RESOURCE_PLAYER, CardStatus, LEGOLAS, RIVENDELL, LORIEN,
} from '../../test-helpers.js';

const GORBAG = 'le-11' as CardDefinitionId;  // orc, body=9, discardBodyCheck=[9]

// Minion sites
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL_LE = 'le-390' as CardDefinitionId;

describe('Rule 8.31 — Orc/Troll Body Check Discard', () => {
  beforeEach(() => resetMint());

  test('Orc discarded (not eliminated) when body check roll matches discardBodyCheck value', () => {
    // Gorbag (le-11): orc, body=9, discardBodyCheck=[9].
    // Roll 9 matches discardBodyCheck → goes to discardPile (not outOfPlayPile).
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM, characters: [GORBAG] }],
          hand: [],
          siteDeck: [MINAS_MORGUL_LE],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, GORBAG, CardStatus.Inverted);
    const readyState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: gorbagId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === gorbagId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === gorbagId)).toBe(false);
  });

  test('Orc eliminated when body check roll exceeds body', () => {
    // Gorbag (le-11): orc, body=9. Roll 10 > 9 → eliminated to outOfPlayPile.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM, characters: [GORBAG] }],
          hand: [],
          siteDeck: [MINAS_MORGUL_LE],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, GORBAG, CardStatus.Inverted);
    const readyState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: gorbagId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === gorbagId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === gorbagId)).toBe(false);
  });

  test('A body-reducing effect shifts the discardBodyCheck threshold down by the same amount', () => {
    // Gorbag (le-11): orc, body=9, discardBodyCheck=[9]. A -1 strike-event body
    // penalty (e.g. Risky Blow) drops effective body to 8, so the discard
    // number must also shift to 8 (not stay fixed at the printed 9).
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM, characters: [GORBAG] }],
          hand: [],
          siteDeck: [MINAS_MORGUL_LE],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, GORBAG, CardStatus.Inverted);
    const baseCombat = makeBodyCheckCombat({ companyId, characterId: gorbagId });
    const combatWithPenalty = {
      ...baseCombat,
      strikeAssignments: [{ ...baseCombat.strikeAssignments[0], strikeBodyPenalty: -1 }],
    };

    // Roll 8 now matches the shifted discard number (9 - 1) — discarded, not eliminated.
    const atShiftedDiscard = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: combatWithPenalty,
      cheatRollTotal: 8,
    };
    const [discardAction] = viableActions(atShiftedDiscard, PLAYER_2, 'body-check-roll');
    const afterDiscard = dispatch(atShiftedDiscard, discardAction.action);
    expect(afterDiscard.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === gorbagId)).toBe(true);
    expect(afterDiscard.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === gorbagId)).toBe(false);

    // Roll 9 (the old, unshifted printed discard number) now exceeds the
    // reduced body (8) — eliminated, not discarded.
    const atOldPrintedValue = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: combatWithPenalty,
      cheatRollTotal: 9,
    };
    const [eliminateAction] = viableActions(atOldPrintedValue, PLAYER_2, 'body-check-roll');
    const afterEliminate = dispatch(atOldPrintedValue, eliminateAction.action);
    expect(afterEliminate.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === gorbagId)).toBe(true);
    expect(afterEliminate.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === gorbagId)).toBe(false);
  });
});
