/**
 * @module tw-283.test
 *
 * Card test: Miruvor (tw-283)
 * Type: hero-resource-item (minor, corruption 1)
 *
 * "Discard to give +2 body (to a maximum of 10) for all characters in
 *  bearer's company until the end of the turn."
 *
 * Engine Support:
 * | # | Feature                                       | Status      | Notes                                             |
 * |---|------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Discard to grant company body boost           | IMPLEMENTED | grant-action company-body-boost, cost: discard    |
 * | 2 | +2 body to every character in company         | IMPLEMENTED | add-constraint company-stat-modifier (turn scope) |
 * | 3 | Capped at a maximum of 10                     | IMPLEMENTED | company-stat-modifier constraint now carries `max`, synthesised into a capped stat-modifier effect |
 * | 4 | Bonus isolated to bearer's company            | IMPLEMENTED | constraint target = bearer's company              |
 * | 5 | Activate during any phase (rule 2.1.1)        | IMPLEMENTED | grant-action carries `anyPhase: true` in JSON     |
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

const MIRUVOR = 'tw-283' as CardDefinitionId;

describe('Miruvor (tw-283)', () => {
  beforeEach(() => resetMint());

  // ── Grant-action availability ──

  test('company-body-boost grant-action available when bearer has Miruvor', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [MIRUVOR] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost');
    expect(actions.length).toBe(1);
  });

  test('grant-action absent when no Miruvor in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost');
    expect(actions.length).toBe(0);
  });

  // ── Activation: discard + body boost ──

  test('activating company-body-boost discards Miruvor', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [MIRUVOR] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost')!.action;
    const next = dispatch(state, action);

    expectCharItemCount(next, RESOURCE_PLAYER, ARAGORN, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, MIRUVOR);
  });

  test('activation adds a turn-scoped company-stat-modifier constraint (body, max 10) on bearer company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [MIRUVOR] }, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost')!.action;
    const next = dispatch(state, action);

    const constraint = next.activeConstraints.find(c => c.kind.type === 'company-stat-modifier');
    expect(constraint).toBeDefined();
    if (constraint && constraint.kind.type === 'company-stat-modifier') {
      expect(constraint.kind.stat).toBe('body');
      expect(constraint.kind.value).toBe(2);
      expect(constraint.kind.max).toBe(10);
    }
    expect(constraint!.scope.kind).toBe('turn');
    expect(constraint!.target.kind).toBe('company');
    if (constraint!.target.kind === 'company') {
      expect(constraint!.target.companyId).toBe(next.players[0].companies[0].id);
    }
  });

  test('after activation, every character in bearer company has +2 effective body', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        // Aragorn body 9, Gimli body 8 — neither hits the cap with a single +2.
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [MIRUVOR] }, GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(9);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.body).toBe(8);

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost')!.action;
    const next = dispatch(state, action);

    expect(getCharacter(next, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(10);
    expect(getCharacter(next, RESOURCE_PLAYER, GIMLI).effectiveStats.body).toBe(10);
  });

  test('body bonus is capped at a maximum of 10, not 11', () => {
    // Aragorn's printed body is 9: +2 would be 11 without the cap.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [MIRUVOR] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost')!.action;
    const next = dispatch(state, action);

    expect(getCharacter(next, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(10);
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
            { site: RIVENDELL, characters: [{ defId: ARAGORN, items: [MIRUVOR] }] },
            { site: MORIA, characters: [GIMLI] },
          ],
          hand: [], siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost')!.action;
    const next = dispatch(state, action);

    // Bearer's company: boosted.
    expect(getCharacter(next, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(10);
    // Separate company: unchanged.
    expect(getCharacter(next, RESOURCE_PLAYER, GIMLI).effectiveStats.body).toBe(8);
  });

  test('boost does not leak to the opposing player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [MIRUVOR] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GIMLI] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost')!.action;
    const next = dispatch(state, action);

    expect(getCharacter(next, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(10);
    // Opposing player's character retains base body.
    expect(getCharacter(next, 1, GIMLI).effectiveStats.body).toBe(8);
  });

  // ── Rule 2.1.1: any-phase availability ──

  test('grant-action available during long-event phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [MIRUVOR] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost');
    expect(actions.length).toBe(1);
  });

  test('grant-action available during movement/hazard phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [MIRUVOR] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost');
    expect(actions.length).toBe(1);
  });

  test('grant-action available during site phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [MIRUVOR] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const ready = { ...state, phaseState: makeSitePhase() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost');
    expect(actions.length).toBe(1);
  });

  // ── Multiple copies ──

  test('two Miruvor stack additively but the company total stays capped at 10', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [MIRUVOR, MIRUVOR] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const firstAction = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost')!.action;
    const afterFirst = dispatch(state, firstAction);
    expect(getCharacter(afterFirst, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(10);

    const secondAction = viableActions(afterFirst, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-body-boost')!.action;
    const afterSecond = dispatch(afterFirst, secondAction);
    // Each +2 is independently capped at 10, so the second copy does not push past it.
    expect(getCharacter(afterSecond, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(10);
  });
});
