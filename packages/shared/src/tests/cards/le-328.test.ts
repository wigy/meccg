/**
 * @module le-328.test
 *
 * Card test: Orc-draughts (le-328)
 * Type: minion-resource-item (minor, corruption 1)
 *
 * "Discard to give +1 prowess to all characters in bearer's company until
 *  the end of the turn."
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                                             |
 * |---|--------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Discard to grant company prowess boost     | IMPLEMENTED | grant-action company-prowess-boost, cost: discard |
 * | 2 | +1 prowess to every character in company   | IMPLEMENTED | add-constraint company-stat-modifier (turn scope) |
 * | 3 | Bonus isolated to bearer's company         | IMPLEMENTED | constraint target = bearer's company              |
 * | 4 | Activate during any phase (rule 2.1.1)     | IMPLEMENTED | action added to ANY_PHASE_GRANT_ACTIONS           |
 *
 * Playable: YES
 *
 * Fixture alignment: minion-resource-item (ringwraith). Tests use minion
 * characters (LE) so the item sits on a legal bearer and the company
 * contains ringwraith-aligned entities only.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, dispatch,
  expectCharItemCount, expectInDiscardPile,
  findCharInstanceId, getCharacter,
  RESOURCE_PLAYER, makeMHState, makeSitePhase,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const ORC_DRAUGHTS = 'le-328' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;      // orc, prowess 6
const GRISHNAKH = 'le-12' as CardDefinitionId;   // orc, prowess 4
const LUITPRAND = 'le-23' as CardDefinitionId;   // man, no effects

const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold

describe('Orc-draughts (le-328)', () => {
  beforeEach(() => resetMint());

  // ── Grant-action availability ──

  test('company-prowess-boost grant-action available when bearer has Orc-draughts', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [ORC_DRAUGHTS] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost');
    expect(actions.length).toBe(1);
  });

  test('grant-action absent when no Orc-draughts in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost');
    expect(actions.length).toBe(0);
  });

  // ── Activation: discard + prowess boost ──

  test('activating company-prowess-boost discards Orc-draughts', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [ORC_DRAUGHTS] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const next = dispatch(state, action);

    expectCharItemCount(next, RESOURCE_PLAYER, GORBAG, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, ORC_DRAUGHTS);
  });

  test('activation adds a turn-scoped company-stat-modifier constraint on bearer company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [ORC_DRAUGHTS] }, GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const next = dispatch(state, action);

    const constraint = next.activeConstraints.find(c => c.kind.type === 'company-stat-modifier');
    expect(constraint).toBeDefined();
    if (constraint && constraint.kind.type === 'company-stat-modifier') {
      expect(constraint.kind.stat).toBe('prowess');
      expect(constraint.kind.value).toBe(1);
    }
    expect(constraint!.scope.kind).toBe('turn');
    expect(constraint!.target.kind).toBe('company');
    if (constraint!.target.kind === 'company') {
      expect(constraint!.target.companyId).toBe(next.players[0].companies[0].id);
    }
  });

  test('after activation, every character in bearer company has +1 effective prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [ORC_DRAUGHTS] }, GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    // Baseline prowess before activation.
    expect(getCharacter(state, RESOURCE_PLAYER, GORBAG).effectiveStats.prowess).toBe(6);
    expect(getCharacter(state, RESOURCE_PLAYER, GRISHNAKH).effectiveStats.prowess).toBe(4);

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const next = dispatch(state, action);

    expect(getCharacter(next, RESOURCE_PLAYER, GORBAG).effectiveStats.prowess).toBe(7);
    expect(getCharacter(next, RESOURCE_PLAYER, GRISHNAKH).effectiveStats.prowess).toBe(5);
  });

  test('boost does not leak to characters outside the bearer company', () => {
    // Two minion companies under the same player. Only the company holding
    // Orc-draughts gets the +1.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [ORC_DRAUGHTS] }] },
            { site: MORIA_MINION, characters: [GRISHNAKH] },
          ],
          hand: [], siteDeck: [BARAD_DUR],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const next = dispatch(state, action);

    // Bearer's company: boosted.
    expect(getCharacter(next, RESOURCE_PLAYER, GORBAG).effectiveStats.prowess).toBe(7);
    // Separate company: unchanged.
    expect(getCharacter(next, RESOURCE_PLAYER, GRISHNAKH).effectiveStats.prowess).toBe(4);
  });

  test('boost does not leak to the opposing player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [ORC_DRAUGHTS] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const next = dispatch(state, action);

    expect(getCharacter(next, RESOURCE_PLAYER, GORBAG).effectiveStats.prowess).toBe(7);
    // Opposing player's character retains base prowess.
    expect(getCharacter(next, 1, GRISHNAKH).effectiveStats.prowess).toBe(4);
  });

  // ── Rule 2.1.1: any-phase availability ──

  test('grant-action available during long-event phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [ORC_DRAUGHTS] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost');
    expect(actions.length).toBe(1);
  });

  test('grant-action available during movement/hazard phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [ORC_DRAUGHTS] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost');
    expect(actions.length).toBe(1);
  });

  test('grant-action available during site phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [ORC_DRAUGHTS] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const ready = { ...state, phaseState: makeSitePhase() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost');
    expect(actions.length).toBe(1);
  });

  // ── Multiple copies ──

  test('two Orc-draughts stack: each activation adds a separate +1 boost', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [ORC_DRAUGHTS, ORC_DRAUGHTS] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const firstAction = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const afterFirst = dispatch(state, firstAction);
    expect(getCharacter(afterFirst, RESOURCE_PLAYER, GORBAG).effectiveStats.prowess).toBe(7);

    const secondAction = viableActions(afterFirst, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const afterSecond = dispatch(afterFirst, secondAction);
    expect(getCharacter(afterSecond, RESOURCE_PLAYER, GORBAG).effectiveStats.prowess).toBe(8);
  });

  // Sanity check: the bearer instance ID resolves (no rebinding regression).
  test('Orc-draughts instance resolves to the item definition while attached', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [ORC_DRAUGHTS] }] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const gorbag = state.players[RESOURCE_PLAYER].characters[gorbagId as string];
    expect(gorbag.items.map(i => i.definitionId)).toContain(ORC_DRAUGHTS);
  });
});
