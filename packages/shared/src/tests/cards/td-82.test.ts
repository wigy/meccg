/**
 * @module td-82.test
 *
 * Card test: Winds of Wrath (td-82)
 * Type: hazard-event (short), not unique
 *
 * Card text: "Playable if Doors of Night is in play and opponent is using
 * the same type of location deck (minion/hero) as yourself. Replace the new
 * site card of a moving company with a Coastal Sea [{c}] in its site path
 * with a card from your location deck that has a Coastal Sea [{c}] in its
 * site path."
 *
 * Effects:
 *   1. play-condition, requires "card-in-play", cardName "Doors of Night".
 *   2. play-condition, requires "player-state",
 *      condition `{ "player.sameLocationDeckTypeAsOpponent": true }`.
 *   3. swap-new-site, requiresDestinationSitePathIncludes: ["coastal"].
 *
 * | # | Effect                                              | Status | Notes                                        |
 * |---|------------------------------------------------------|--------|-----------------------------------------------|
 * | 1 | play-condition card-in-play (Doors of Night)          | OK     | isCardNameInPlayOrCharacters gate             |
 * | 2 | play-condition player-state (same deck type)          | OK     | new player.sameLocationDeckTypeAsOpponent     |
 * | 3 | swap-new-site                                         | OK     | swapNewSiteActions / handleSwapNewSite        |
 *
 * Playable: YES
 * Certified: 2026-08-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MORIA,
  addCardInPlay, makeMHState, pool,
  viableActions, dispatch, reduce, expectInDiscardPile,
} from '../test-helpers.js';
import { Alignment, SiteType } from '../../index.js';
import type { CardDefinitionId, GameState, PlayHazardAction } from '../../index.js';

const WINDS_OF_WRATH = 'td-82' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;

// Hero sites with a Coastal Sea [{c}] in their static site path.
const TOLFALAS = 'tw-433' as CardDefinitionId;         // ruins-and-lairs, ['wilderness','free','coastal']
const SOUTHRON_OASIS = 'tw-426' as CardDefinitionId;    // border-hold, ['wilderness','free','coastal','wilderness']
// Hero sites with NO Coastal Sea in their site path.
const BREE = 'tw-378' as CardDefinitionId;              // border-hold, ['wilderness','wilderness']

/**
 * Movement/hazard-phase play-hazards state: P1 (resource) moving to
 * `destination`, P2 (hazard) holding Winds of Wrath with `hazardSiteDeck` as
 * their own location deck. Doors of Night defaults to in play; alignments
 * default to Wizard/Wizard (same location-deck type).
 */
function windsState(opts: {
  destination: CardDefinitionId | null;
  destinationSiteName?: string;
  hazardSiteDeck: CardDefinitionId[];
  doorsOfNight?: boolean;
  resourceAlignment?: Alignment;
  hazardAlignment?: Alignment;
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: opts.resourceAlignment ?? Alignment.Wizard,
        companies: [{
          site: RIVENDELL,
          characters: [ARAGORN],
          ...(opts.destination ? { destinationSite: opts.destination } : {}),
        }],
        hand: [],
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        alignment: opts.hazardAlignment ?? Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [WINDS_OF_WRATH],
        siteDeck: opts.hazardSiteDeck,
      },
    ],
  });
  const state = opts.doorsOfNight === false ? base : addCardInPlay(base, HAZARD_PLAYER, DOORS_OF_NIGHT);
  const destDef = opts.destination
    ? (pool[opts.destination as string] as { name?: string; siteType?: SiteType } | undefined)
    : undefined;
  return {
    ...state,
    phaseState: makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimitAtReveal: 4,
      destinationSiteName: opts.destination ? (opts.destinationSiteName ?? destDef?.name ?? null) : null,
      ...(destDef?.siteType ? { destinationSiteType: destDef.siteType } : {}),
    }),
  };
}

/** The `play-hazard` actions offering Winds of Wrath, in candidate order. */
function windsActions(state: GameState): PlayHazardAction[] {
  return viableActions(state, PLAYER_2, 'play-hazard')
    .map(a => a.action as PlayHazardAction)
    .filter(a => a.cardInstanceId === state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === WINDS_OF_WRATH)!.instanceId);
}

describe('Winds of Wrath (td-82)', () => {
  beforeEach(() => resetMint());

  // ─── Play-condition gating ─────────────────────────────────────────────

  test('NOT playable without Doors of Night in play', () => {
    const state = windsState({
      destination: TOLFALAS,
      hazardSiteDeck: [SOUTHRON_OASIS],
      doorsOfNight: false,
    });
    expect(windsActions(state)).toHaveLength(0);
  });

  test('NOT playable when the opponent uses a different type of location deck', () => {
    const state = windsState({
      destination: TOLFALAS,
      hazardSiteDeck: [SOUTHRON_OASIS],
      resourceAlignment: Alignment.Wizard,
      hazardAlignment: Alignment.Ringwraith,
    });
    expect(windsActions(state)).toHaveLength(0);
  });

  test('playable when both players use the same type of location deck (both hero)', () => {
    const state = windsState({
      destination: TOLFALAS,
      hazardSiteDeck: [SOUTHRON_OASIS],
      resourceAlignment: Alignment.Wizard,
      hazardAlignment: Alignment.Wizard,
    });
    expect(windsActions(state).length).toBeGreaterThan(0);
  });

  test('NOT playable when the moving company is not actually moving', () => {
    const state = windsState({
      destination: null,
      hazardSiteDeck: [SOUTHRON_OASIS],
    });
    expect(windsActions(state)).toHaveLength(0);
  });

  test('NOT playable when the destination site has no Coastal Sea in its site path', () => {
    const state = windsState({
      destination: BREE,
      hazardSiteDeck: [SOUTHRON_OASIS],
    });
    expect(windsActions(state)).toHaveLength(0);
  });

  // ─── Candidate offering ─────────────────────────────────────────────────

  test('offered once per eligible Coastal-Sea site in the hazard player\'s own location deck', () => {
    const state = windsState({
      destination: TOLFALAS,
      hazardSiteDeck: [SOUTHRON_OASIS, BREE, MORIA],
    });

    const actions = windsActions(state);
    // Only Southron Oasis (coastal) qualifies; Bree and Moria don't.
    expect(actions).toHaveLength(1);
    const offeredInstance = actions[0].replacementSiteInstanceId;
    const offeredDef = state.players[HAZARD_PLAYER].siteDeck.find(s => s.instanceId === offeredInstance)?.definitionId;
    expect(offeredDef).toBe(SOUTHRON_OASIS);
  });

  test('NOT offered when the hazard player\'s own location deck holds no Coastal-Sea site', () => {
    const state = windsState({
      destination: TOLFALAS,
      hazardSiteDeck: [BREE, MORIA],
    });
    expect(windsActions(state)).toHaveLength(0);
  });

  // ─── Taking the swap ────────────────────────────────────────────────────

  test('taking the swap replaces the destination site, updates the phase state, and discards the card', () => {
    const state = windsState({
      destination: TOLFALAS,
      hazardSiteDeck: [SOUTHRON_OASIS],
    });

    const action = windsActions(state)[0];
    const after = dispatch(state, action);

    // The company now moves to Southron Oasis, untapped.
    const destinationSite = after.players[RESOURCE_PLAYER].companies[0].destinationSite;
    expect(destinationSite?.definitionId).toBe(SOUTHRON_OASIS);
    expect(destinationSite?.status).toBe(CardStatus.Untapped);

    // The phase state's cached destination name/type follow the replacement.
    const mhState = after.phaseState as ReturnType<typeof makeMHState>;
    expect(mhState.destinationSiteName).toBe('Southron Oasis');
    expect(mhState.destinationSiteType).toBe(SiteType.BorderHold);

    // Tolfalas (the original, never-entered destination) returns untapped to
    // its own owner's (the mover's) location deck.
    const resourceDeck = after.players[RESOURCE_PLAYER].siteDeck;
    expect(resourceDeck.some(s => s.definitionId === TOLFALAS)).toBe(true);

    // Southron Oasis left the hazard player's own location deck.
    expect(after.players[HAZARD_PLAYER].siteDeck.some(s => s.definitionId === SOUTHRON_OASIS)).toBe(false);

    // Winds of Wrath is discarded and counts against the hazard limit.
    expectInDiscardPile(after, HAZARD_PLAYER, WINDS_OF_WRATH);
    expect(after.players[HAZARD_PLAYER].hand.some(c => c.definitionId === WINDS_OF_WRATH)).toBe(false);
    expect((after.phaseState as ReturnType<typeof makeMHState>).hazardsPlayedThisCompany).toBe(1);
  });

  test('the reducer rejects a forged replacement site with no Coastal Sea in its path', () => {
    const state = windsState({
      destination: TOLFALAS,
      hazardSiteDeck: [SOUTHRON_OASIS, MORIA],
    });
    const moriaInstance = state.players[HAZARD_PLAYER].siteDeck.find(s => s.definitionId === MORIA)!.instanceId;
    const validAction = windsActions(state)[0];
    const forged: PlayHazardAction = { ...validAction, replacementSiteInstanceId: moriaInstance };

    const result = reduce(state, forged);

    expect(result.error).toContain('path');
    // Nothing changed: Winds of Wrath is still in hand, destination unchanged.
    expect(result.state.players[HAZARD_PLAYER].hand.some(c => c.definitionId === WINDS_OF_WRATH)).toBe(true);
    expect(result.state.players[RESOURCE_PLAYER].companies[0].destinationSite?.definitionId).toBe(TOLFALAS);
  });
});
