/**
 * @module le-52.test
 *
 * Card test: Dwar the Ringwraith (le-52)
 * Type: minion-character (ringwraith avatar), alignment ringwraith.
 * Stats: prowess 9, body 10, direct influence 5, mind null.
 * Skills: warrior, scout, sage. Homesite: Any site in Udûn.
 *
 * Card text:
 *   "Unique. Manifestation of Dwar of Waw. Can use sorcery. -3 direct influence
 *    in Heralded Lord mode. -1 prowess in Fell Rider mode. As your Ringwraith,
 *    if at a Darkhaven [{DH}], he may tap to give +1 prowess and +1 body to all
 *    characters in any one of your companies until the end of the turn."
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                                                    |
 * |---|------------------------------------------------------|-------------|----------------------------------------------------------|
 * | 1 | Darkhaven tap → +1 prowess+body to a chosen company  | IMPLEMENTED | grant-action company-stat-boost (player-companies scope) |
 * | 2 | One activation per company (player chooses)          | IMPLEMENTED | targets.scope = player-companies → per-company actions   |
 * | 3 | +1 prowess + +1 body via sequence of add-constraint  | IMPLEMENTED | two company-stat-modifier constraints (turn scope)       |
 * | 4 | Gated on bearer.atHaven                              | IMPLEMENTED | when condition evaluated before emitting actions         |
 * | 5 | Can use sorcery                                      | FLAVOR      | No certified sorcery consumer today; deferred            |
 * | 6 | -3 DI in Heralded Lord / -1 prowess in Fell Rider    | IMPLEMENTED | per-mode stat-modifiers on the avatar gated on `bearer.ringwraithMode` |
 * | 7 | Manifestation of Dwar of Waw (tw-31)                 | IMPLEMENTED | `manifestId` chain + on-event self-enters-play discard (rule 3.06) |
 * | 8 | Activate during any phase of the player's turn (2.1.1) | IMPLEMENTED | grant-action carries `anyPhase: true` in JSON           |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch,
  findCharInstanceId, getCharacter, companyIdAt, addCardInPlay, recomputeDerived,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  makeMHState,
} from '../test-helpers.js';
import { Alignment, CardStatus } from '../../index.js';
import type {
  ActivateGrantedAction,
  CardDefinitionId,
} from '../../index.js';

const DWAR = 'le-52' as CardDefinitionId;

// Ringwraith mode cards that establish the company's mode.
const HERALDED_LORD = 'le-190' as CardDefinitionId;
const FELL_RIDER = 'le-183' as CardDefinitionId;

// Non-avatar minion companion for multi-character company tests.
const LUITPRAND = 'le-23' as CardDefinitionId;
// Second non-avatar for a second company.
const GORBAG = 'le-11' as CardDefinitionId;

// Darkhaven (siteType: haven, ringwraith alignment).
const DOL_GULDUR = 'le-367' as CardDefinitionId;
// Second Darkhaven to pad site decks when needed.
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// Non-haven minion shadow-hold.
const GOBLIN_GATE_MINION = 'le-378' as CardDefinitionId;

// Hero site so the opposing player has a legal starting position.
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;
// Second hero site.
const RIVENDELL = 'tw-404' as CardDefinitionId;

describe('Dwar the Ringwraith (le-52)', () => {
  beforeEach(() => resetMint());

  // ── Positive: Darkhaven + untapped Dwar ────────────────────────────────────

  test('company-stat-boost grant-action available when Dwar is untapped at a Darkhaven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [DWAR] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [LUITPRAND] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-stat-boost');
    expect(actions.length).toBe(1);
  });

  test('one action per company when player has two companies', () => {
    // Dwar's ability targets "any one of your companies", so two companies → two actions.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [DWAR] },
            { site: GOBLIN_GATE_MINION, characters: [GORBAG] },
          ],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [LUITPRAND] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-stat-boost');
    expect(actions.length).toBe(2);
  });

  // ── Rule 2.1.1: any-phase availability ───────────────────────────────────

  test('company-stat-boost grant-action available during movement/hazard phase, not just organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [DWAR] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [LUITPRAND] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready = { ...state, phaseState: makeMHState() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-stat-boost');
    expect(actions.length).toBe(1);
  });

  // ── Negative: gates ────────────────────────────────────────────────────────

  test('company-stat-boost NOT available when Dwar is at a non-Darkhaven site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE_MINION, characters: [DWAR] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [LUITPRAND] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-stat-boost');
    expect(actions.length).toBe(0);
  });

  test('company-stat-boost NOT available when Dwar is tapped', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [DWAR] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [LUITPRAND] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Manually tap Dwar.
    const dwarId = findCharInstanceId(state, RESOURCE_PLAYER, DWAR);
    const dwarChar = state.players[RESOURCE_PLAYER].characters[dwarId];
    const updatedChars = {
      ...state.players[RESOURCE_PLAYER].characters,
      [dwarId as string]: { ...dwarChar, status: CardStatus.Tapped },
    };
    state = {
      ...state,
      players: [
        { ...state.players[RESOURCE_PLAYER], characters: updatedChars },
        state.players[HAZARD_PLAYER],
      ] as typeof state.players,
    };

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-stat-boost');
    expect(actions.length).toBe(0);
  });

  // ── Activation effects ──────────────────────────────────────────────────────

  test('activating taps Dwar', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [DWAR] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [LUITPRAND] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-stat-boost')!.action;
    const next = dispatch(state, action);

    expect(getCharacter(next, RESOURCE_PLAYER, DWAR).status).toBe(CardStatus.Tapped);
  });

  test('activation adds two turn-scoped company-stat-modifier constraints (prowess+1, body+1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [DWAR, LUITPRAND] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [GORBAG] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-stat-boost')!.action;
    const next = dispatch(state, action);

    const prowessConstraint = next.activeConstraints.find(
      c => c.kind.type === 'company-stat-modifier' && c.kind.stat === 'prowess',
    );
    const bodyConstraint = next.activeConstraints.find(
      c => c.kind.type === 'company-stat-modifier' && c.kind.stat === 'body',
    );

    expect(prowessConstraint).toBeDefined();
    expect(bodyConstraint).toBeDefined();

    if (prowessConstraint?.kind.type === 'company-stat-modifier') {
      expect(prowessConstraint.kind.value).toBe(1);
    }
    if (bodyConstraint?.kind.type === 'company-stat-modifier') {
      expect(bodyConstraint.kind.value).toBe(1);
    }

    expect(prowessConstraint!.scope.kind).toBe('turn');
    expect(bodyConstraint!.scope.kind).toBe('turn');
    expect(prowessConstraint!.target.kind).toBe('company');
    expect(bodyConstraint!.target.kind).toBe('company');
  });

  test('after activation, characters in targeted company gain +1 prowess and +1 body', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [DWAR, LUITPRAND] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [GORBAG] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Baseline effective stats before activation.
    expect(getCharacter(state, RESOURCE_PLAYER, DWAR).effectiveStats.prowess).toBe(9);
    expect(getCharacter(state, RESOURCE_PLAYER, LUITPRAND).effectiveStats.prowess).toBe(3);

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'company-stat-boost')!.action;
    const next = dispatch(state, action);

    // Both characters in the targeted company get +1 prowess and +1 body.
    expect(getCharacter(next, RESOURCE_PLAYER, DWAR).effectiveStats.prowess).toBe(10);
    expect(getCharacter(next, RESOURCE_PLAYER, LUITPRAND).effectiveStats.prowess).toBe(4);
    expect(getCharacter(next, RESOURCE_PLAYER, DWAR).effectiveStats.body).toBe(11);
    expect(getCharacter(next, RESOURCE_PLAYER, LUITPRAND).effectiveStats.body).toBe(8);
  });

  test('boost targets the chosen company and does not leak to other companies', () => {
    // Two ringwraith companies. Dwar activates to boost company 2 (containing Gorbag).
    // Company 1 (Dwar + Luitprand) must remain unboosted.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [DWAR, LUITPRAND] },
            { site: GOBLIN_GATE_MINION, characters: [GORBAG] },
          ],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Two actions, one per company. Pick the one targeting company 2.
    const allActions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'company-stat-boost');
    expect(allActions.length).toBe(2);

    // The targeted company is carried on `targetCompanyId`.
    const gorbagCompanyId = state.players[RESOURCE_PLAYER].companies[1].id;
    const targetCompanyAction = allActions.find(
      ea => (ea.action as ActivateGrantedAction).targetCompanyId === gorbagCompanyId,
    )!.action;

    const next = dispatch(state, targetCompanyAction);

    // Gorbag (in targeted company) gets the boost.
    expect(getCharacter(next, RESOURCE_PLAYER, GORBAG).effectiveStats.prowess).toBe(7);
    // Dwar and Luitprand (in other company) do not get the boost.
    expect(getCharacter(next, RESOURCE_PLAYER, DWAR).effectiveStats.prowess).toBe(9);
    expect(getCharacter(next, RESOURCE_PLAYER, LUITPRAND).effectiveStats.prowess).toBe(3);
  });

  // ─── Rule #6: per-mode stat changes to the Ringwraith ─────────────────────────

  test('-3 direct influence in Heralded Lord mode (prowess unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DWAR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyIdAt(state, RESOURCE_PLAYER)));
    const dwar = getCharacter(state, RESOURCE_PLAYER, DWAR);
    expect(dwar.effectiveStats.directInfluence).toBe(2); // 5 - 3
    expect(dwar.effectiveStats.prowess).toBe(9); // Fell Rider bonus does not apply
  });

  test('-1 prowess in Fell Rider mode (direct influence unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DWAR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyIdAt(state, RESOURCE_PLAYER)));
    const dwar = getCharacter(state, RESOURCE_PLAYER, DWAR);
    expect(dwar.effectiveStats.prowess).toBe(8); // 9 - 1
    expect(dwar.effectiveStats.directInfluence).toBe(5); // Heralded Lord bonus does not apply
  });
});
