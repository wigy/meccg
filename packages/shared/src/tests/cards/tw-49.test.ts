/**
 * @module tw-49.test
 *
 * Card test: Long Winter (tw-49)
 * Type: hazard-event (long / environment), non-unique
 *
 * A reprint of Long Winter (le-117) with identical text and effects.
 *
 * Card text:
 *   "Environment. Each moving company that has at least two Wildernesses [{w}]
 *    in its site path must return to its site of origin unless it contains a
 *    ranger. Additionally, if Doors of Night is in play, each non-Haven/
 *    non-Darkhaven site in play with at least two Wildernesses [{w}] in its
 *    site path is tapped. Cannot be duplicated."
 *
 * Engine Support:
 * | # | Rule                                                  | Status      | Notes                                                          |
 * |---|-------------------------------------------------------|-------------|----------------------------------------------------------------|
 * | 1 | Force moving company (≥2 Wilderness, no ranger) home  | IMPLEMENTED | rule 5.31 force-return-to-origin enforced in endCompanyMH      |
 * | 2 | Doors of Night: tap each non-Haven/non-Darkhaven site | IMPLEMENTED | `tap-sites-in-play` effect, applied on resolution (chain-reducer.ts) |
 * |   | in play with ≥2 Wilderness in its site path           |             |                                                                |
 * | 3 | Cannot be duplicated                                  | IMPLEMENTED | duplication-limit scope game max 1                             |
 *
 * Playable: FULLY — CERTIFIED. Every printed rule is enforced: rule-5.31
 * force-return (with ranger exception), the Doors-of-Night site-tap clause,
 * and the game-scope duplication limit. Generic rule-5.31 coverage lives in
 * rule-5.31-returned-to-origin.test.ts.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, dispatch,
  attachAllyToChar, findCharInstanceId, viableActions,
  addCardInPlay, buildForceReturnMHState, resolveChain,
  mint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
} from '../test-helpers.js';
import { CardStatus, RegionType } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay,
  CancelReturnToOriginAction, MovementHazardPhaseState,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const LONG_WINTER = 'tw-49' as CardDefinitionId;
const GOLDBERRY = 'tw-245' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;

describe('Long Winter (tw-49)', () => {
  beforeEach(() => resetMint());

  const longWinterInPlay: CardInPlay = {
    instanceId: 'long-winter-1' as CardInstanceId,
    definitionId: LONG_WINTER,
    status: CardStatus.Untapped,
  };

  // ─── Rule 3: Cannot be duplicated (duplication-limit scope game max 1) ─────

  test('Long Winter IS playable as a hazard long-event when no copy is in play', () => {
    // Positive control: with the hazard limit available and nothing in play,
    // the hazard player may play Long Winter against the active company.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LONG_WINTER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: MovementHazardPhaseState = makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimitAtReveal: 4,
    });
    const readyState = { ...state, phaseState: mhState };
    const longWinterInstanceId = readyState.players[1].hand[0].instanceId;

    const playActions = viableActions(readyState, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === longWinterInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('a second Long Winter is NOT playable while one is already in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LONG_WINTER], siteDeck: [MINAS_TIRITH], cardsInPlay: [longWinterInPlay] },
      ],
    });
    const mhState: MovementHazardPhaseState = makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimitAtReveal: 4,
    });
    const readyState = { ...state, phaseState: mhState };
    const longWinterInstanceId = readyState.players[1].hand[0].instanceId;

    // No viable play-hazard action for the duplicate copy.
    const viablePlays = viableActions(readyState, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === longWinterInstanceId);
    expect(viablePlays).toHaveLength(0);

    // It is explicitly offered as a non-viable play whose reason cites duplication.
    const blocked = computeLegalActions(readyState, PLAYER_2)
      .filter(ea => !ea.viable
        && ea.action.type === 'play-hazard'
        && (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === longWinterInstanceId);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].reason ?? '').toMatch(/duplicat/i);
  });

  // ─── Rule 1: force-return-to-origin TAG is consumed by Goldberry's cancel ──

  test('Goldberry can cancel a Long Winter return-to-origin chain entry', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);

    const longWinterCard = { instanceId: mint(), definitionId: LONG_WINTER };
    const withChain = initiateChain(
      { ...withGoldberry, phaseState: makeMHState() },
      PLAYER_2,
      longWinterCard,
      { type: 'long-event' },
    );

    // Resource player gets priority to respond.
    expect(withChain.chain!.priority).toBe(PLAYER_1);

    const aragornId = findCharInstanceId(withChain, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId = withChain.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin')
      .map(ea => ea.action as CancelReturnToOriginAction);

    expect(cancelActions.some(a => a.allyInstanceId === goldberryInstanceId
      && a.targetInstanceId === longWinterCard.instanceId)).toBe(true);
  });

  // ─── Rule 1: force-return-to-origin enforcement (rule 5.31) ───────────────

  test('moving company with ≥2 Wildernesses and no ranger is returned to its site of origin', () => {
    // LEGOLAS (tw-168) is not a ranger.
    const { state, originInstanceId } = buildForceReturnMHState(
      [LEGOLAS], [RegionType.Wilderness, RegionType.Wilderness], LONG_WINTER,
    );
    const after = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    const company = after.players[RESOURCE_PLAYER].companies[0];
    expect(company.currentSite?.instanceId).toBe(originInstanceId);
    expect(company.moved).toBe(false);
  });

  test('moving company containing a ranger is NOT returned to its site of origin', () => {
    // ARAGORN (tw-120) is a ranger — the rangerException exempts the company.
    const { state, originInstanceId } = buildForceReturnMHState(
      [ARAGORN], [RegionType.Wilderness, RegionType.Wilderness], LONG_WINTER,
    );
    const after = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    // The company completes its move (its current site is no longer the origin).
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.instanceId).not.toBe(originInstanceId);
  });

  test('a single Wilderness in the site path does NOT trigger the return (needs ≥2)', () => {
    const { state, originInstanceId } = buildForceReturnMHState(
      [LEGOLAS], [RegionType.Wilderness], LONG_WINTER,
    );
    const after = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.instanceId).not.toBe(originInstanceId);
  });

  // ─── Rule 2: Doors-of-Night site-tap (tap-sites-in-play) ──────────────────

  test('Doors of Night in play: a non-Haven site with ≥2 Wildernesses is tapped on resolution; a Haven is not', () => {
    // P1 sits at Moria (shadow-hold, site path [w, w] → ≥2 Wildernesses);
    // P2 sits at Lórien (a Haven, excluded by the non-Haven clause).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    expect(base.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);

    const withDon = addCardInPlay({ ...base, phaseState: makeMHState() }, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const chained = initiateChain(withDon, PLAYER_2, { instanceId: mint(), definitionId: LONG_WINTER }, { type: 'long-event' });
    const resolved = resolveChain(chained);

    // The ≥2-Wilderness shadow-hold is tapped; the Haven is left untapped.
    expect(resolved.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    expect(resolved.players[HAZARD_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
  });

  test('without Doors of Night, the site-tap clause does not fire', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const chained = initiateChain({ ...base, phaseState: makeMHState() }, PLAYER_2, { instanceId: mint(), definitionId: LONG_WINTER }, { type: 'long-event' });
    const resolved = resolveChain(chained);
    expect(resolved.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
  });
});
