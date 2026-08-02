/**
 * @module tw-255.test
 *
 * Card test: Healing Herbs (tw-255)
 * Type: hero-resource-item (minor, corruption 1)
 *
 * "The bearer can tap and discard this item to heal a character in his
 *  company, changing the character's status from wounded to well and
 *  untapped. Alternatively, the bearer can tap and discard this item to
 *  untap a character in his company that is not wounded."
 *
 * Engine support:
 * | # | Feature                                                        | Status      | Notes                                                                     |
 * |---|-----------------------------------------------------------------|-------------|-----------------------------------------------------------------------------|
 * | 1 | Tap bearer AND discard the item to pay the cost                  | IMPLEMENTED | grant-action cost `{ tap: "bearer", discard: "self" }` — `applyCost` now pays both instead of the tap short-circuiting the discard |
 * | 2 | Heal a wounded character in the bearer's company (mode A)        | IMPLEMENTED | `heal-company-character` — apply set-character-status target target-character status untapped, mirrors le-310 |
 * | 3 | Untap a non-wounded character in the bearer's company (mode B)   | IMPLEMENTED | `untap-company-character` (new action) — targets Tapped, non-Inverted company members |
 * | 4 | One activation per eligible candidate per mode                   | IMPLEMENTED | legal-actions/organization scans inverted / tapped company members |
 * | 5 | Not offered when no candidate exists for a mode                  | IMPLEMENTED | scanner returns no action when the candidate list is empty |
 * | 6 | Bearer must be untapped to activate either mode                  | IMPLEMENTED | `canPayCost` gates on `tap: "bearer"` — a tapped bearer cannot activate |
 * | 7 | Activate during any phase of the player's turn (2.1.1)           | IMPLEMENTED | grant-action carries `anyPhase: true` in JSON |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, dispatch,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
  findCharInstanceId,
  RESOURCE_PLAYER,
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus, makeMHState, makeSitePhase,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const HEALING_HERBS = 'tw-255' as CardDefinitionId;

describe('Healing Herbs (tw-255)', () => {
  beforeEach(() => resetMint());

  // ── heal-company-character (mode A: wounded → well and untapped) ─────────

  test('heal-company-character available when a company member is wounded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS] },
            { defId: ARAGORN, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character');
    expect(actions.length).toBe(1);
  });

  test('heal-company-character NOT available when nobody in the company is wounded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS] },
            ARAGORN,
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character');
    expect(actions.length).toBe(0);
  });

  test('one action per wounded candidate in the bearer company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS] },
            { defId: ARAGORN, status: CardStatus.Inverted },
            { defId: LEGOLAS, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [MINAS_TIRITH] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character');
    expect(actions.length).toBe(2);

    const targets = actions.map(ea => (ea.action as ActivateGrantedAction).targetCardId).sort();
    expect(targets).toEqual([aragornId, legolasId].sort());
  });

  test('activating heal-company-character heals target (inverted → untapped), taps bearer, and discards item', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS] },
            { defId: ARAGORN, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character')!.action;
    const next = dispatch(state, action);

    // Aragorn is healed: inverted → untapped.
    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    // The item is removed from Bilbo and lies in the resource discard pile.
    expectCharItemCount(next, RESOURCE_PLAYER, BILBO, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, HEALING_HERBS);
    // Bilbo (the bearer) paid the tap cost.
    expectCharStatus(next, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
  });

  // ── untap-company-character (mode B: untap a non-wounded character) ──────

  test('untap-company-character available when a company member is tapped (not wounded)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS] },
            { defId: ARAGORN, status: CardStatus.Tapped },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-company-character');
    expect(actions.length).toBe(1);
    expect((actions[0].action as ActivateGrantedAction).targetCardId).toBe(aragornId);
  });

  test('untap-company-character NOT available when nobody in the company is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS] },
            ARAGORN,
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-company-character');
    expect(actions.length).toBe(0);
  });

  test('untap-company-character does NOT target a wounded (inverted) character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS] },
            { defId: ARAGORN, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-company-character');
    expect(actions.length).toBe(0);
  });

  test('the bearer itself is never an eligible untap-company-character target (must be untapped to pay the tap cost)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS] },
            { defId: ARAGORN, status: CardStatus.Tapped },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-company-character');
    expect(actions.every(ea => (ea.action as ActivateGrantedAction).targetCardId !== bilboId)).toBe(true);
  });

  test('activating untap-company-character untaps target, taps bearer, and discards item', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS] },
            { defId: ARAGORN, status: CardStatus.Tapped },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-company-character')!.action;
    const next = dispatch(state, action);

    // Aragorn is untapped by the effect.
    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    // The item is removed from Bilbo and lies in the resource discard pile.
    expectCharItemCount(next, RESOURCE_PLAYER, BILBO, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, HEALING_HERBS);
    // Bilbo (the bearer) paid the tap cost.
    expectCharStatus(next, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
  });

  // ── Cost gating: bearer must be untapped to activate either mode ─────────

  test('neither mode is offered when the bearer is already tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS], status: CardStatus.Tapped },
            { defId: ARAGORN, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => {
        const a = ea.action as ActivateGrantedAction;
        return a.actionId === 'heal-company-character' || a.actionId === 'untap-company-character';
      });
    expect(actions.length).toBe(0);
  });

  // ── Rule 2.1.1: any-phase availability ────────────────────────────────────

  test('heal-company-character available during movement/hazard phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS] },
            { defId: ARAGORN, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character');
    expect(actions.length).toBe(1);
  });

  test('untap-company-character available during site phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [HEALING_HERBS] },
            { defId: ARAGORN, status: CardStatus.Tapped },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...state, phaseState: makeSitePhase() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-company-character');
    expect(actions.length).toBe(1);
  });
});
