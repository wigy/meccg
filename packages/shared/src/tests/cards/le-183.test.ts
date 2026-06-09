/**
 * @module le-183.test
 *
 * Card test: Fell Rider (le-183)
 * Type: minion-resource-event (permanent), alignment ringwraith. Non-unique.
 *
 * Card text:
 *   "Fell Rider mode. Playable at a Darkhaven [{DH}] during the organization
 *    phase on your Ringwraith's own company. +2 prowess, -3 direct influence to
 *    your Ringwraith. Discard all allies and Ringwraith followers in the
 *    company; none may join the company. Your Ringwraith may move to a
 *    non-Darkhaven site. Discard this card during any of your following
 *    organization phases your Ringwraith is at a Darkhaven [{DH}]. Cannot be
 *    duplicated on a given company. Cannot be included in a Balrog's deck."
 *
 * Fell Rider is one of the three Ringwraith *mode* cards (with Black Rider
 * le-170 and Heralded Lord le-190). A mode card is a permanent-event resource
 * bound to the Ringwraith's company via `CardInPlay.companyId`; the bound mode
 * is surfaced to the effective-stats resolver as `bearer.ringwraithMode` and
 * gates the Ringwraith's movement out of its Darkhaven.
 *
 * Engine Support:
 * | # | Rule                                                      | Status          | Notes                                                                 |
 * |---|-----------------------------------------------------------|-----------------|-----------------------------------------------------------------------|
 * | 1 | Fell Rider mode established on the company                 | IMPLEMENTED     | `ringwraith-mode` effect read by `resolveCompanyRingwraithMode`       |
 * | 2 | Playable at a Darkhaven on a company, binds via companyId  | IMPLEMENTED     | `play-target` company + `target.siteType: haven` filter               |
 * | 3 | Ringwraith may move to a non-Darkhaven site               | IMPLEMENTED     | `ringwraithHasModeCard` lifts the Darkhaven-only movement gate         |
 * | 4 | Cannot be duplicated on a given company                   | IMPLEMENTED     | `duplication-limit` scope "company", max 1                            |
 * | 5 | Discard at a following organization phase at a Darkhaven   | IMPLEMENTED     | `on-event: organization-phase-start` + `discard-self` when `atHaven`   |
 * | 6 | +2 prowess / -3 direct influence to your Ringwraith       | NOT IMPLEMENTED | mode-card plain `stat-modifier`s are not applied to the Ringwraith     |
 * | 7 | Discard all allies & Ringwraith followers; none may join  | NOT IMPLEMENTED | no on-play mass discard, no ongoing ally/follower join restriction     |
 * | 8 | Cannot be included in a Balrog's deck                     | NOT IMPLEMENTED | deck-construction restriction; not enforced by the game engine         |
 * | 9 | Playable only on a company containing the Ringwraith       | PARTIAL         | filter checks Darkhaven site only, not Ringwraith presence             |
 *
 * NOT CERTIFIED: rules #6, #7 and #8 require engine mechanics that do not yet
 * exist (Ringwraith-only stat modifiers sourced from a company-bound mode card;
 * an on-play discard of all allies + Ringwraith followers plus an ongoing
 * "none may join" constraint; and a Balrog deck-construction restriction). The
 * tests below cover only the mechanics that are implemented.
 *
 * Playable: PARTIALLY.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, runActions, Phase, Alignment,
  addCardInPlay, companyIdAt,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  LEGOLAS, LORIEN,
} from '../test-helpers.js';
import type { CardDefinitionId, GameAction } from '../../index.js';
import type { PlanMovementAction, PlayPermanentEventAction } from '../../types/actions-organization.js';

const FELL_RIDER = 'le-183' as CardDefinitionId;
// le-58: The Witch-king — Ringwraith avatar (mind null, race ringwraith).
const THE_WITCH_KING = 'le-58' as CardDefinitionId;
// le-367 / le-390: Dol Guldur / Minas Morgul — Darkhavens (siteType: haven).
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// le-364: Dead Marshes — shadow-hold (not a Darkhaven); nearestHaven Dol Guldur,
// so reachable from Dol Guldur via starter movement for a non-Ringwraith company.
const DEAD_MARSHES = 'le-364' as CardDefinitionId;

/** A Ringwraith company at Dol Guldur opposed by a hero company at Lórien. */
function ringwraithAtDolGuldur(opts: {
  phase: Phase;
  hand?: CardDefinitionId[];
  siteDeck?: CardDefinitionId[];
  site?: CardDefinitionId;
}) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: opts.phase,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: opts.site ?? DOL_GULDUR, characters: [THE_WITCH_KING] }],
        hand: opts.hand ?? [],
        siteDeck: opts.siteDeck ?? [MINAS_MORGUL, DEAD_MARSHES],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [],
      },
    ],
  });
}

describe('Fell Rider (le-183)', () => {
  beforeEach(() => resetMint());

  // ─── Rule #3: mode card lifts the Darkhaven-only movement restriction ────────

  test('without Fell Rider, the Ringwraith may only plan movement to a Darkhaven', () => {
    const state = ringwraithAtDolGuldur({ phase: Phase.Organization });
    const minasInst = state.players[0].siteDeck.find(s => s.definitionId === MINAS_MORGUL)!.instanceId;
    const deadInst = state.players[0].siteDeck.find(s => s.definitionId === DEAD_MARSHES)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    // Minas Morgul (Darkhaven) is reachable; Dead Marshes (shadow-hold) is gated out.
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === minasInst)).toBe(true);
    expect(plans.every(ea => (ea.action as PlanMovementAction).destinationSite !== deadInst)).toBe(true);
  });

  test('with Fell Rider bound, the Ringwraith may plan movement to a non-Darkhaven site', () => {
    let state = ringwraithAtDolGuldur({ phase: Phase.Organization });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyId);

    const minasInst = state.players[0].siteDeck.find(s => s.definitionId === MINAS_MORGUL)!.instanceId;
    const deadInst = state.players[0].siteDeck.find(s => s.definitionId === DEAD_MARSHES)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    // The mode card now allows the non-Darkhaven destination, and the Darkhaven
    // destination remains available.
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === deadInst)).toBe(true);
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === minasInst)).toBe(true);
  });

  // ─── Rule #2: playable at a Darkhaven, bound to the company ──────────────────

  test('playable on the company while at a Darkhaven, carrying the company binding', () => {
    const state = ringwraithAtDolGuldur({ phase: Phase.Organization, hand: [FELL_RIDER] });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
  });

  test('not playable while the company is at a non-Darkhaven site', () => {
    // Same company stationed at Dead Marshes (shadow-hold) instead of a Darkhaven.
    const state = ringwraithAtDolGuldur({
      phase: Phase.Organization,
      hand: [FELL_RIDER],
      site: DEAD_MARSHES,
      siteDeck: [DOL_GULDUR],
    });

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(0);
  });

  // ─── Rule #4: cannot be duplicated on a given company ────────────────────────

  test('a second copy cannot be played on a company that already has Fell Rider', () => {
    let state = ringwraithAtDolGuldur({ phase: Phase.Organization, hand: [FELL_RIDER] });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    // One copy already bound to the company.
    state = addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyId);

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === state.players[0].hand[0].instanceId);

    expect(plays).toHaveLength(0);
  });

  // ─── Rule #5: self-discard at a following Darkhaven organization phase ────────

  test('discarded at the next organization phase while the company is at a Darkhaven', () => {
    let state = ringwraithAtDolGuldur({ phase: Phase.Untap, siteDeck: [MINAS_MORGUL] });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyId);

    const afterOrg = runActions(state, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ] as GameAction[]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(afterOrg.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === FELL_RIDER)).toBe(false);
    expect(afterOrg.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === FELL_RIDER)).toBe(true);
  });

  test('not discarded at the organization phase while the company is at a non-Darkhaven site', () => {
    let state = ringwraithAtDolGuldur({ phase: Phase.Untap, site: DEAD_MARSHES, siteDeck: [DOL_GULDUR] });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyId);

    const afterOrg = runActions(state, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ] as GameAction[]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(afterOrg.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === FELL_RIDER)).toBe(true);
    expect(afterOrg.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === FELL_RIDER)).toBe(false);
  });
});
