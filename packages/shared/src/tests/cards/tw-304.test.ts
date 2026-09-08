/**
 * @module tw-304.test
 *
 * Card test: Potion of Prowess (tw-304)
 * Type: hero-resource-item (minor, corruption 1)
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
 * | 4 | Activate during any phase (rule 2.1.1)     | IMPLEMENTED | grant-action carries `anyPhase: true` in JSON     |
 *
 * Playable: YES
 *
 * Fixture alignment: hero-resource-item. Tests use hero characters (TW) and
 * hero sites (TW) so the item sits on a legal bearer.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, dispatch,
  expectCharItemCount, expectInDiscardPile,
  getCharacter,
  RESOURCE_PLAYER, makeMHState, makeSitePhase,
  ARAGORN, LEGOLAS, GIMLI, GANDALF,
  RIVENDELL, MINAS_TIRITH, MORIA,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const POTION_OF_PROWESS = 'tw-304' as CardDefinitionId;

describe('Potion of Prowess (tw-304)', () => {
  beforeEach(() => resetMint());

  // ── Grant-action availability ──

  test('company-prowess-boost grant-action available when bearer has Potion of Prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [POTION_OF_PROWESS] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost');
    expect(actions.length).toBe(1);
  });

  test('grant-action absent when no Potion of Prowess in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost');
    expect(actions.length).toBe(0);
  });

  // ── Activation: discard + prowess boost ──

  test('activating company-prowess-boost discards Potion of Prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [POTION_OF_PROWESS] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const next = dispatch(state, action);

    expectCharItemCount(next, RESOURCE_PLAYER, ARAGORN, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, POTION_OF_PROWESS);
  });

  test('activation adds a turn-scoped company-stat-modifier constraint on bearer company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [POTION_OF_PROWESS] }, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [POTION_OF_PROWESS] }, GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(6);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(5);

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const next = dispatch(state, action);

    expect(getCharacter(next, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(7);
    expect(getCharacter(next, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(6);
  });

  test('boost does not leak to characters outside the bearer company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [{ defId: ARAGORN, items: [POTION_OF_PROWESS] }] },
            { site: MORIA, characters: [GIMLI] },
          ],
          hand: [], siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const next = dispatch(state, action);

    // Bearer's company: boosted.
    expect(getCharacter(next, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(7);
    // Separate company: unchanged.
    expect(getCharacter(next, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(5);
  });

  test('boost does not leak to the opposing player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [POTION_OF_PROWESS] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GIMLI] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const next = dispatch(state, action);

    expect(getCharacter(next, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(7);
    // Opposing player's character retains base prowess.
    expect(getCharacter(next, 1, GIMLI).effectiveStats.prowess).toBe(5);
  });

  // ── Rule 2.1.1: any-phase availability ──

  test('grant-action available during long-event phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [POTION_OF_PROWESS] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [POTION_OF_PROWESS] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [POTION_OF_PROWESS] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const ready = { ...state, phaseState: makeSitePhase() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost');
    expect(actions.length).toBe(1);
  });

  // ── Multiple copies ──

  test('two Potions of Prowess stack: each activation adds a separate +1 boost', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [POTION_OF_PROWESS, POTION_OF_PROWESS] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const firstAction = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const afterFirst = dispatch(state, firstAction);
    expect(getCharacter(afterFirst, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(7);

    const secondAction = viableActions(afterFirst, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-prowess-boost')!.action;
    const afterSecond = dispatch(afterFirst, secondAction);
    expect(getCharacter(afterSecond, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(8);
  });
});
