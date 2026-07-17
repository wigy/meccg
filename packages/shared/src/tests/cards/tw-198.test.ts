/**
 * @module tw-198.test
 *
 * Card test: Bill the Pony (tw-198)
 * Type: hero-resource-ally
 * Stats: prowess -2, body 10, mind 1, MP 1 (ally)
 *
 * Card text:
 *   "Unique. Playable at Bree or Bag End; playable even if the site is tapped.
 *    If at a non-Haven/non-Under-deeps site and if his company's size is three
 *    or less, you may discard Bill the Pony at the end of his company's turn and
 *    replace its site with the nearest Haven [{H}]."
 *
 * Per the CRF card errata the run-home is considered movement with no
 * movement/hazard phase; for a Fallen-wizard player it targets the hero
 * version's nearest haven.
 *
 * Engine support:
 * | # | Feature                                              | Status      | Notes                                        |
 * |---|------------------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Unique — one copy in play                            | IMPLEMENTED | standard uniqueness check                    |
 * | 2 | Playable at Bree / Bag End (name-matched)            | IMPLEMENTED | playableAt [{site:"Bree"},{site:"Bag End"}]  |
 * | 3 | Playable even if the site is tapped                  | IMPLEMENTED | play-flag: playable-at-tapped-site           |
 * | 4 | Run home: discard + move company to nearest haven    | IMPLEMENTED | run-home-to-haven effect + run-home action   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachAllyToChar,
  viableActions,
  setCompanySiteStatus,
  makeSitePhase,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, GIMLI, FRODO, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE,
} from '../test-helpers.js';
import { CardStatus, BAG_END } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, RunHomeAction } from '../../index.js';
import { reduce } from '../../engine/reducer.js';

const BILL = 'tw-198' as CardDefinitionId;
// The Under-courts (as-163) — a canonical Under-deeps site.
const UNDER_COURTS = 'as-163' as CardDefinitionId;

describe('Bill the Pony (tw-198)', () => {
  beforeEach(() => resetMint());

  // ─── Playability: Bree / Bag End, even if tapped ─────────────────────────

  test('Bill IS playable at Bree (untapped)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [BILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const billId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === billId);
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('Bill IS playable at Bree even when the site is TAPPED', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [BILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const tapped = setCompanySiteStatus(base, RESOURCE_PLAYER, 0, CardStatus.Tapped);
    const state = { ...tapped, phaseState: makeSitePhase() };
    const billId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === billId);
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('Bill IS playable at Bag End even when the site is TAPPED', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: BAG_END, characters: [ARAGORN] }], hand: [BILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const tapped = setCompanySiteStatus(base, RESOURCE_PLAYER, 0, CardStatus.Tapped);
    const state = { ...tapped, phaseState: makeSitePhase() };
    const billId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === billId);
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('Bill is NOT playable at a site that is not Bree or Bag End', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [BILL], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const billId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === billId);
    expect(plays).toHaveLength(0);
  });

  // ─── Run home: end-of-turn discard + move to nearest haven ───────────────

  test('run-home IS offered at a non-Haven, non-Under-deeps site with company size ≤ 3', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withBill = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, BILL);
    const allyId = Object.values(withBill.players[RESOURCE_PLAYER].characters)[0].allies[0].instanceId;
    const companyId = withBill.players[RESOURCE_PLAYER].companies[0].id;

    const runHome = viableActions(withBill, PLAYER_1, 'run-home')
      .map(ea => ea.action as RunHomeAction);
    expect(runHome.some(a => a.companyId === companyId && a.allyInstanceId === allyId)).toBe(true);
  });

  test('run-home is NOT offered when the company is at a Haven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withBill = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, BILL);
    const runHome = viableActions(withBill, PLAYER_1, 'run-home');
    expect(runHome).toHaveLength(0);
  });

  test('run-home is NOT offered when the company size is four', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS, GIMLI, FRODO] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withBill = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, BILL);
    const runHome = viableActions(withBill, PLAYER_1, 'run-home');
    expect(runHome).toHaveLength(0);
  });

  test('run-home is NOT offered at an Under-deeps site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: UNDER_COURTS, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withBill = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, BILL);
    const runHome = viableActions(withBill, PLAYER_1, 'run-home');
    expect(runHome).toHaveLength(0);
  });

  test('run-home is NOT offered to the non-active (hazard) player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // Bill attached in player 2's company (index 1), but P2 is not the active player.
    const withBill = attachAllyToChar(base, 1, ARAGORN, BILL);
    const runHome = viableActions(withBill, PLAYER_2, 'run-home');
    expect(runHome).toHaveLength(0);
  });

  test('dispatching run-home discards Bill and moves the company to its nearest haven (untapped site returns to deck)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withBill = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, BILL);
    const p1 = withBill.players[RESOURCE_PLAYER];
    const companyId = p1.companies[0].id;
    const allyId = Object.values(p1.characters)[0].allies[0].instanceId;
    const departureInstanceId = p1.companies[0].currentSite!.instanceId;

    const action: RunHomeAction = { type: 'run-home', player: PLAYER_1, companyId, allyInstanceId: allyId };
    const result = reduce(withBill, action);
    expect(result.error).toBeUndefined();

    const after = result.state.players[RESOURCE_PLAYER];
    // Company now at Lórien (the nearest haven of Moria).
    const newSite = after.companies[0].currentSite!;
    expect(result.state.cardPool[newSite.definitionId].name).toBe('Lórien');
    expect(after.companies[0].siteCardOwned).toBe(true);
    // Bill has left play and is in the discard pile.
    const stillOnChar = Object.values(after.characters)[0].allies.some(a => a.instanceId === allyId);
    expect(stillOnChar).toBe(false);
    expect(after.discardPile.some(c => c.definitionId === BILL)).toBe(true);
    // Departure site (Moria, untapped) returned to the location deck.
    expect(after.siteDeck.some(c => c.instanceId === departureInstanceId)).toBe(true);
    // Characters remain in the company.
    expect(after.companies[0].characters).toHaveLength(1);
  });

  test('dispatching run-home from a TAPPED departure site sends that site to the site discard pile', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withBill = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, BILL);
    const tapped = setCompanySiteStatus(withBill, RESOURCE_PLAYER, 0, CardStatus.Tapped);
    const p1 = tapped.players[RESOURCE_PLAYER];
    const companyId = p1.companies[0].id;
    const allyId = Object.values(p1.characters)[0].allies[0].instanceId;
    const departureInstanceId = p1.companies[0].currentSite!.instanceId;

    const action: RunHomeAction = { type: 'run-home', player: PLAYER_1, companyId, allyInstanceId: allyId };
    const result = reduce(tapped, action);
    expect(result.error).toBeUndefined();

    const after = result.state.players[RESOURCE_PLAYER];
    expect(result.state.cardPool[after.companies[0].currentSite!.definitionId].name).toBe('Lórien');
    // Tapped departure site went to the site discard pile, not the location deck.
    expect(after.siteDiscardPile.some(c => c.instanceId === departureInstanceId)).toBe(true);
    expect(after.siteDeck.some(c => c.instanceId === departureInstanceId)).toBe(false);
  });
});
