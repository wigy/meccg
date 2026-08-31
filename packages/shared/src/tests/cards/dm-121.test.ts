/**
 * @module dm-121.test
 *
 * Card test: Crown of Flowers (dm-121)
 * Type: hero-resource-event (permanent, environment)
 * Keywords: environment
 *
 * "Environment. Crown of Flowers has no effect until you play a resource with
 * it. You can play one resource from your hand with this card. The resource is
 * considered to be played and to be in play as though Gates of Morning were in
 * play and Doors of Night were not. Crown of Flowers does not affect the
 * interpretation of any card except the resource played with it. Discard Crown
 * of Flowers when the resource is discarded. Discard the resource if Crown of
 * Flowers is discarded."
 *
 * | # | Effect Type                  | Status | Notes                                          |
 * |---|------------------------------|--------|------------------------------------------------|
 * | 1 | on-event/offer-resource-play | OK     | Non-blocking org action; does not block org    |
 * | 2 | assumeInPlay/assumeNotInPlay | OK     | Paired resource evaluates as if GoM in play    |
 * | 3 | linkedInstanceId cascade     | OK     | Mutual discard when either card is discarded   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  DOORS_OF_NIGHT, SUN,
  buildTestState, buildSitePhaseState, resetMint, resolveChain,
  viableActions, handCardId, addCardInPlay, dispatch, companyIdAt,
  makeMHState,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  pushCardInPlay, mint,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CardInPlay } from '../../index.js';
import { CardStatus } from '../../index.js';
import { CROWN_OF_FLOWERS } from '../../card-ids.js';

const GOLLUM = 'tw-246' as CardDefinitionId;
const MUSTER = 'tw-288' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Crown of Flowers (dm-121)', () => {
  beforeEach(() => resetMint());

  test('playable as a permanent event during site phase', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [CROWN_OF_FLOWERS],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(1);
  });

  test('after chain resolves, enters cardsInPlay WITHOUT queuing a blocking resolution', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [CROWN_OF_FLOWERS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const afterPlay = dispatch(state, playActions[0].action);
    const resolved = resolveChain(afterPlay);

    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(1);
    // Crown of Flowers must NOT collapse the legal-action menu: no pending
    // resolution is queued, so the player may continue to organize.
    expect(resolved.pendingResolutions).toHaveLength(0);
  });

  // Regression (Bug Report: Organization, game mrs06zup-du4wde seq 84): playing
  // Crown of Flowers used to enqueue a blocking `resource-play-offer` pending
  // resolution that collapsed the menu to "pair or pass", so the player could
  // not play or organize characters during the organization phase.
  test('playing Crown of Flowers does NOT block organizing characters', () => {
    // Two characters in one company at a Haven → split-company is a normal
    // organization action available independent of the Crown offer.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [CROWN_OF_FLOWERS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const afterPlay = dispatch(state, playActions[0].action);
    const resolved = resolveChain(afterPlay);

    // The organization menu still offers ordinary actions (e.g. split-company),
    // proving the phase was not collapsed by the Crown of Flowers offer.
    expect(viableActions(resolved, PLAYER_1, 'split-company').length).toBeGreaterThan(0);
  });

  test('player can still pair a resource from hand with CoF (as an org action)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [CROWN_OF_FLOWERS, SUN], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const afterPlay = dispatch(state, playActions[0].action);
    const resolved = resolveChain(afterPlay);

    const pairActions = viableActions(resolved, PLAYER_1, 'pair-resource-with-cof');
    expect(pairActions).toHaveLength(1);

    const afterPair = dispatch(resolved, pairActions[0].action);

    // Once paired, the Crown is linked and no longer offers a pairing action.
    expect(viableActions(afterPair, PLAYER_1, 'pair-resource-with-cof')).toHaveLength(0);

    // CoF and the paired resource are both in cardsInPlay
    expect(afterPair.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(2);
    // Resource was removed from hand
    expect(afterPair.players[RESOURCE_PLAYER].hand).toHaveLength(0);

    // The paired Sun has linked context (GoM assumed in, DoN assumed out)
    const sunInPlay = afterPair.players[RESOURCE_PLAYER].cardsInPlay.find(
      c => c.definitionId === SUN,
    ) as CardInPlay;
    expect(sunInPlay).toBeDefined();
    expect(sunInPlay.assumeInPlay).toContain('Gates of Morning');
    expect(sunInPlay.assumeNotInPlay).toContain('Doors of Night');

    // CoF is also linked back to the resource
    const cofInPlay = afterPair.players[RESOURCE_PLAYER].cardsInPlay.find(
      c => c.definitionId === CROWN_OF_FLOWERS,
    ) as CardInPlay;
    expect(cofInPlay.linkedInstanceId).toBe(sunInPlay.instanceId);
  });

  // Regression (Bug Report: Crown of Flowers / Gollum, game msf2o9tq-ozptpq
  // seq 34): Crown of Flowers only re-interprets the *text* of the paired
  // resource (as though Gates of Morning were in play and Doors of Night were
  // not) — it does not waive the resource's other play requirements. Gollum
  // (tw-246) is "Playable at Goblin-gate or Moria"; pairing him with an
  // in-play Crown of Flowers while the company sits at Rivendell must not be
  // offered, or the Crown would let any site-restricted ally (or The One
  // Ring) enter play from anywhere for free.
  test('does not offer to pair a site-restricted ally when no company is at a qualifying site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [CROWN_OF_FLOWERS, GOLLUM], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const afterPlay = dispatch(state, playActions[0].action);
    const resolved = resolveChain(afterPlay);

    expect(viableActions(resolved, PLAYER_1, 'pair-resource-with-cof')).toHaveLength(0);
  });

  test('offers and allows pairing a site-restricted ally once a company is at a qualifying site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CROWN_OF_FLOWERS, GOLLUM], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const afterPlay = dispatch(state, playActions[0].action);
    const resolved = resolveChain(afterPlay);

    const pairActions = viableActions(resolved, PLAYER_1, 'pair-resource-with-cof');
    expect(pairActions).toHaveLength(1);

    const afterPair = dispatch(resolved, pairActions[0].action);
    const gollumInPlay = afterPair.players[RESOURCE_PLAYER].cardsInPlay.find(
      c => c.definitionId === GOLLUM,
    ) as CardInPlay;
    expect(gollumInPlay).toBeDefined();
  });

  // Regression (Bug Report: Muster, game mth1ahu8-bqdcqv seq 412): Muster
  // (tw-288) is a short-event (CoE 5.1) that only has an immediate effect
  // during a specific influence check and must be discarded immediately
  // after resolving — it never sits in play as a static resource. Pairing it
  // with Crown of Flowers moved it into cardsInPlay with no target character
  // and no check to modify, leaving it stuck there as though it were a
  // long/permanent event.
  test('does not offer to pair a short-event resource (Muster) with CoF', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [CROWN_OF_FLOWERS, MUSTER], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const afterPlay = dispatch(state, playActions[0].action);
    const resolved = resolveChain(afterPlay);

    expect(viableActions(resolved, PLAYER_1, 'pair-resource-with-cof')).toHaveLength(0);
  });

  test('discarding CoF also discards the paired resource (cascade)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState();
    const stateWithMH = { ...base, phaseState: mhState };

    // Add CoF and a paired resource (Sun) to cardsInPlay with mutual links
    const cofId = mint();
    const sunId = mint();
    const cofCard: CardInPlay = {
      instanceId: cofId,
      definitionId: CROWN_OF_FLOWERS,
      status: CardStatus.Untapped,
      linkedInstanceId: sunId,
    };
    const sunCard: CardInPlay = {
      instanceId: sunId,
      definitionId: SUN,
      status: CardStatus.Untapped,
      linkedInstanceId: cofId,
      assumeInPlay: ['Gates of Morning'],
      assumeNotInPlay: ['Doors of Night'],
    };

    const stateWithCards = pushCardInPlay(
      pushCardInPlay(stateWithMH, RESOURCE_PLAYER, cofCard),
      RESOURCE_PLAYER,
      sunCard,
    );

    // Doors of Night discards CoF (environment keyword) → should cascade to discard Sun
    const donId = handCardId(stateWithCards, HAZARD_PLAYER);
    const companyId = companyIdAt(stateWithCards, RESOURCE_PLAYER);
    const afterPlay = dispatch(stateWithCards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: donId,
      targetCompanyId: companyId,
    });
    const afterResolve = resolveChain(afterPlay);

    // CoF discarded
    expect(afterResolve.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cofId)).toBe(false);
    expect(afterResolve.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cofId)).toBe(true);
    // Sun cascaded to discard
    expect(afterResolve.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === sunId)).toBe(false);
    expect(afterResolve.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === sunId)).toBe(true);
  });

  test('Environment keyword: Doors of Night discards Crown of Flowers (no paired resource)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState();
    const stateWithMH = { ...base, phaseState: mhState };
    const stateWithCOF = addCardInPlay(stateWithMH, RESOURCE_PLAYER, CROWN_OF_FLOWERS);

    const cofInstanceId = stateWithCOF.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    const donId = handCardId(stateWithCOF, HAZARD_PLAYER);
    const companyId = companyIdAt(stateWithCOF, RESOURCE_PLAYER);

    const afterPlay = dispatch(stateWithCOF, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: donId,
      targetCompanyId: companyId,
    });

    const resolved = resolveChain(afterPlay);

    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(0);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(
      c => c.instanceId === cofInstanceId,
    )).toBe(true);
  });
});
