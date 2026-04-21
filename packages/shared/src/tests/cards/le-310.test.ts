/**
 * @module le-310.test
 *
 * Card test: Foul-smelling Paste (le-310)
 * Type: minion-resource-item (minor, corruption 1)
 * Playable at: ruins-and-lairs, shadow-hold, dark-hold, border-hold
 *
 * "The bearer can discard this item to heal a wounded character in his
 *  company—change the character's status from wounded to well and untapped."
 *
 * Engine support:
 * | # | Feature                                                | Status      | Notes                                                                 |
 * |---|--------------------------------------------------------|-------------|-----------------------------------------------------------------------|
 * | 1 | Discard the item to pay the cost                       | IMPLEMENTED | grant-action cost: discard self (reducer-organization)                |
 * | 2 | Heal a wounded character in the bearer's company       | IMPLEMENTED | apply set-character-status target target-character status untapped    |
 * | 3 | One activation per wounded candidate (target choice)   | IMPLEMENTED | legal-actions/organization scans inverted company members             |
 * | 4 | Not offered when no one in the company is wounded      | IMPLEMENTED | scanner returns no action when wounded list is empty                  |
 * | 5 | Activate during any phase of the player's turn (2.1.1) | IMPLEMENTED | grant-action carries `anyPhase: true` in JSON                         |
 *
 * Playable: YES
 *
 * Fixture alignment: minion-resource-item (ringwraith). Tests use minion
 * characters and minion sites (LE) so the item sits on a legal minion
 * bearer, per project convention for minion card tests.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, dispatch,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
  findCharInstanceId,
  RESOURCE_PLAYER, makeMHState, makeSitePhase,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';
import { CardStatus } from '../../index.js';

const FOUL_SMELLING_PASTE = 'le-310' as CardDefinitionId;

// Minion characters (orc race, no relevant effects for this test).
const GORBAG = 'le-11' as CardDefinitionId;
const GRISHNAKH = 'le-12' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;

// Minion sites.
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;
const BARAD_DUR = 'le-352' as CardDefinitionId;

describe('Foul-smelling Paste (le-310)', () => {
  beforeEach(() => resetMint());

  // ── Availability ──────────────────────────────────────────────────────────

  test('heal-company-character available when a company member is wounded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [
            { defId: GORBAG, items: [FOUL_SMELLING_PASTE] },
            { defId: GRISHNAKH, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
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
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [
            { defId: GORBAG, items: [FOUL_SMELLING_PASTE] },
            GRISHNAKH,
          ] }],
          hand: [], siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
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
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [
            { defId: GORBAG, items: [FOUL_SMELLING_PASTE] },
            { defId: GRISHNAKH, status: CardStatus.Inverted },
            { defId: LUITPRAND, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const grishId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);
    const luitId = findCharInstanceId(state, RESOURCE_PLAYER, LUITPRAND);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character');
    expect(actions.length).toBe(2);

    const targets = actions.map(ea => (ea.action as ActivateGrantedAction).targetCardId).sort();
    expect(targets).toEqual([grishId, luitId].sort());
  });

  test('wounded characters in a different company are not valid targets', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [FOUL_SMELLING_PASTE] }] },
            { site: MORIA_MINION, characters: [{ defId: GRISHNAKH, status: CardStatus.Inverted }] },
          ],
          hand: [], siteDeck: [BARAD_DUR],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character');
    expect(actions.length).toBe(0);
  });

  test('bearer may heal himself when he is the wounded one', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [
            { defId: GORBAG, items: [FOUL_SMELLING_PASTE], status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character');
    expect(actions.length).toBe(1);
    expect((actions[0].action as ActivateGrantedAction).targetCardId).toBe(gorbagId);
  });

  // ── Resolution ────────────────────────────────────────────────────────────

  test('activating heals the target (inverted → untapped) and discards the item', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [
            { defId: GORBAG, items: [FOUL_SMELLING_PASTE] },
            { defId: GRISHNAKH, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character')!.action;
    const next = dispatch(state, action);

    // Grishnakh is now healed: status untapped.
    expectCharStatus(next, RESOURCE_PLAYER, GRISHNAKH, CardStatus.Untapped);
    // Paste is removed from Gorbag and lies in the minion's discard pile.
    expectCharItemCount(next, RESOURCE_PLAYER, GORBAG, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, FOUL_SMELLING_PASTE);
    // Gorbag's status was untapped and remains untapped (he is not the target).
    expectCharStatus(next, RESOURCE_PLAYER, GORBAG, CardStatus.Untapped);
  });

  test('bearer healing himself transitions bearer inverted → untapped and discards item', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [
            { defId: GORBAG, items: [FOUL_SMELLING_PASTE], status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character')!.action;
    const next = dispatch(state, action);

    expectCharStatus(next, RESOURCE_PLAYER, GORBAG, CardStatus.Untapped);
    expectCharItemCount(next, RESOURCE_PLAYER, GORBAG, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, FOUL_SMELLING_PASTE);
  });

  test('healing one wounded character leaves another wounded character untouched', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [
            { defId: GORBAG, items: [FOUL_SMELLING_PASTE] },
            { defId: GRISHNAKH, status: CardStatus.Inverted },
            { defId: LUITPRAND, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const grishId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);
    const healGrish = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => {
        const a = ea.action as ActivateGrantedAction;
        return a.actionId === 'heal-company-character' && a.targetCardId === grishId;
      })!.action;

    const next = dispatch(state, healGrish);

    expectCharStatus(next, RESOURCE_PLAYER, GRISHNAKH, CardStatus.Untapped);
    // Luitprand (the other wounded character) remains wounded — paste heals only one.
    expectCharStatus(next, RESOURCE_PLAYER, LUITPRAND, CardStatus.Inverted);
    expectInDiscardPile(next, RESOURCE_PLAYER, FOUL_SMELLING_PASTE);
  });

  // ── Rule 2.1.1: any-phase availability ───────────────────────────────────

  test('grant-action available during movement/hazard phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [
            { defId: GORBAG, items: [FOUL_SMELLING_PASTE] },
            { defId: GRISHNAKH, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character');
    expect(actions.length).toBe(1);
  });

  test('grant-action available during site phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [
            { defId: GORBAG, items: [FOUL_SMELLING_PASTE] },
            { defId: GRISHNAKH, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const ready = { ...state, phaseState: makeSitePhase() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character');
    expect(actions.length).toBe(1);
  });

  test('grant-action available during long-event phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [
            { defId: GORBAG, items: [FOUL_SMELLING_PASTE] },
            { defId: GRISHNAKH, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character');
    expect(actions.length).toBe(1);
  });
});
