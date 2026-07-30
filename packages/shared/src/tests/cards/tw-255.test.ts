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
 * | # | Feature                                                | Status        | Notes                                                              |
 * |---|--------------------------------------------------------|---------------|----------------------------------------------------------------------|
 * | 1 | Discard the item to pay the cost, heal wounded target  | IMPLEMENTED   | grant-action heal-company-character, mirrors le-310                |
 * | 2 | Not offered when no one in the company is wounded      | IMPLEMENTED   | scanner returns no action when wounded list is empty                |
 * | 3 | Untap a non-wounded character (alternative ability)    | test.todo     | not yet wired — separate ability from the heal above               |
 *
 * Playable: PARTIAL (heal ability implemented; untap-non-wounded alternative pending)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, dispatch,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
  RESOURCE_PLAYER,
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus, makeSitePhase,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const HEALING_HERBS = 'tw-255' as CardDefinitionId;

describe('Healing Herbs (tw-255)', () => {
  beforeEach(() => resetMint());

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

  test('activating heals the target (inverted → untapped) and discards the item', () => {
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

    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expectCharItemCount(next, RESOURCE_PLAYER, BILBO, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, HEALING_HERBS);
  });

  // ── Bug report: healing with Ioreth in the company (Ioreth "heals everyone") ──
  //
  // Ioreth's healing-affects-all play-flag is currently wired only into the
  // on-event/play-option healing path (e.g. Halfling Strength — see
  // chain-reducer.ts), not into grant-action applies like this one. Whether
  // it should also extend grant-action-sourced healing is a separate,
  // uncorroborated question from this bug report (the reported game log
  // never got as far as a successful heal, since no heal action existed at
  // all — see the fix above). Left as a documented follow-up.
  test.todo('healing via Healing Herbs spreads to all wounded company members when Ioreth is present (grant-action healing-affects-all not yet wired)');

  // ── Rule 2.1.1: any-phase availability ───────────────────────────────────

  test('grant-action available during site phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
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
    const ready = { ...state, phaseState: makeSitePhase() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'heal-company-character');
    expect(actions.length).toBe(1);
  });

  test.todo('bearer can tap and discard this item to untap a character in his company that is not wounded');
});
