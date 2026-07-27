/**
 * @module as-48.test
 *
 * Card test: Farmer Maggot (as-48)
 * Type: hero-resource-event (permanent, unique, 0 MP)
 *
 * Card text: "Unique. If one of your companies faces an attack while at a site
 * in The Shire, Arthedain, or Cardolan, you may immediately replace its site
 * card with another site card in The Shire, Arthedain, or Cardolan (from your
 * location deck). If your company takes this option, the attack is canceled and
 * this card is discarded."
 *
 * Effects:
 *   1. cancel-attack, cost `{ discard: "self" }`, with the new `siteSwap`
 *      payload `{ regions: ["The Shire", "Arthedain", "Cardolan"] }`.
 *
 * Rules interpretation:
 *   - "while at a site" — a company in the middle of a move is not *at* a site
 *     (its `currentSite` is only the origin it is leaving), so the option is
 *     offered only to a company with no `destinationSite`.
 *   - The replaced site card is disposed exactly as a departure site is
 *     (CoE 2.IV.viii): a tapped non-haven goes to the site discard pile, an
 *     untapped site or a haven returns to the location deck. The replacement is
 *     pulled out of the location deck and arrives untapped.
 *   - The company is *placed* at the replacement rather than moving to it, so it
 *     never enters that site and faces none of its automatic-attacks: the
 *     site-phase automatic-attack sequence for the company is abandoned
 *     (`SitePhaseState.autoAttacksSkipped`).
 *
 * Engine support: `siteSwapCancelActions` (legal-actions/combat.ts) offers one
 * `cancel-attack` per candidate replacement site; `handleCancelAttackBySiteSwap`
 * (combat-cancel.ts) performs the swap, discards the host and cancels the attack
 * through `resolveCancelAttackEntry`; `reducer-site.ts` honours
 * `autoAttacksSkipped`.
 *
 * Playable: YES
 * Certified: 2026-07-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS, ARAGORN, RIVENDELL, LORIEN,
  makeSitePhase, makeCancelWindowCombat, setCompanySiteStatus,
  viableActions, dispatch, expectInDiscardPile,
} from '../test-helpers.js';
import { reduce } from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, GameState,
  CancelAttackAction, SitePhaseState,
} from '../../index.js';

const FARMER_MAGGOT = 'as-48' as CardDefinitionId;

// Hero sites inside the three named regions.
const BARROW_DOWNS = 'tw-375' as CardDefinitionId;   // Cardolan, ruins-and-lairs, Undead 1 strike / 8 prowess
const WEATHERTOP = 'tw-436' as CardDefinitionId;     // Arthedain, ruins-and-lairs, Wolves 2 strikes / 6 prowess
const BREE = 'tw-378' as CardDefinitionId;           // Arthedain, border-hold, no automatic-attacks
const BAG_END = 'tw-372' as CardDefinitionId;        // The Shire, free-hold, no automatic-attacks

// Hero sites outside the three named regions (never eligible).
const MORIA = 'tw-413' as CardDefinitionId;          // Redhorn Gate, shadow-hold

/** Farmer Maggot as an in-play permanent event for the hero player. */
function maggotInPlay(): CardInPlay {
  return {
    instanceId: 'as48-inplay' as CardInstanceId,
    definitionId: FARMER_MAGGOT,
    status: CardStatus.Untapped,
  };
}

/**
 * Hero company at `site` with Farmer Maggot in play and `siteDeck` as the
 * location deck. Phase defaults to movement/hazard (a stationary company facing
 * a hazard creature); `destination` makes the company a moving one.
 */
function maggotState(opts: {
  site: CardDefinitionId;
  siteDeck: CardDefinitionId[];
  destination?: CardDefinitionId;
  inPlay?: boolean;
  hand?: CardDefinitionId[];
  phase?: Phase;
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: opts.phase ?? Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: opts.site,
          characters: [LEGOLAS],
          ...(opts.destination ? { destinationSite: opts.destination } : {}),
        }],
        hand: opts.hand ?? [],
        siteDeck: opts.siteDeck,
        cardsInPlay: opts.inPlay === false ? [] : [maggotInPlay()],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

/** The cancel-attack actions Farmer Maggot offers, in candidate-site order. */
function maggotCancels(state: GameState): CancelAttackAction[] {
  return viableActions(state, PLAYER_1, 'cancel-attack')
    .map(a => a.action as CancelAttackAction)
    .filter(a => a.cardInstanceId === ('as48-inplay' as CardInstanceId));
}

/** The definition id of the site a company currently stands on. */
function currentSiteDef(state: GameState, playerIdx: number): CardDefinitionId | undefined {
  return state.players[playerIdx].companies[0].currentSite?.definitionId;
}

describe('Farmer Maggot (as-48)', () => {
  beforeEach(() => resetMint());

  // ─── Playing the permanent event (Unique) ─────────────────────────────────

  test('playable as a permanent event during the organization phase', () => {
    const state = maggotState({
      site: BARROW_DOWNS, siteDeck: [BREE], inPlay: false,
      hand: [FARMER_MAGGOT], phase: Phase.Organization,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(1);
  });

  test('Unique: a second copy is not playable while one is already in play', () => {
    const state = maggotState({
      site: BARROW_DOWNS, siteDeck: [BREE],
      hand: [FARMER_MAGGOT], phase: Phase.Organization,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ─── Offer gating ─────────────────────────────────────────────────────────

  test('offered once per eligible location-deck site while at a Cardolan site', () => {
    const base = maggotState({ site: BARROW_DOWNS, siteDeck: [BREE, BAG_END, MORIA, RIVENDELL] });
    const state = makeCancelWindowCombat(base, { creatureRace: 'undead', attackSourceType: 'automatic-attack' });

    const cancels = maggotCancels(state);
    // Bree (Arthedain) and Bag End (The Shire) qualify; Moria (Redhorn Gate)
    // and Rivendell (Rhudaur) do not.
    expect(cancels).toHaveLength(2);
    const offered = cancels.map(a => {
      const inst = state.players[RESOURCE_PLAYER].siteDeck
        .find(s => s.instanceId === a.replacementSiteInstanceId);
      return inst?.definitionId;
    });
    expect(new Set(offered)).toEqual(new Set([BREE, BAG_END]));
  });

  test('NOT offered while the company is at a site outside the three regions', () => {
    const base = maggotState({ site: MORIA, siteDeck: [BREE, BAG_END] });
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc', attackSourceType: 'automatic-attack' });
    expect(maggotCancels(state)).toHaveLength(0);
  });

  test('NOT offered when the location deck holds no site in the three regions', () => {
    const base = maggotState({ site: BARROW_DOWNS, siteDeck: [MORIA, RIVENDELL] });
    const state = makeCancelWindowCombat(base, { creatureRace: 'undead', attackSourceType: 'automatic-attack' });
    expect(maggotCancels(state)).toHaveLength(0);
  });

  test('NOT offered to a MOVING company (it is not "at" a site)', () => {
    const base = maggotState({ site: BARROW_DOWNS, siteDeck: [BREE, BAG_END], destination: WEATHERTOP });
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc', attackSourceType: 'creature' });
    expect(maggotCancels(state)).toHaveLength(0);
  });

  test('NOT offered while Farmer Maggot is only in hand (it must be in play)', () => {
    const base = maggotState({ site: BARROW_DOWNS, siteDeck: [BREE], inPlay: false, hand: [FARMER_MAGGOT] });
    const state = makeCancelWindowCombat(base, { creatureRace: 'undead', attackSourceType: 'automatic-attack' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  // ─── Taking the option ────────────────────────────────────────────────────

  test('taking the option swaps the site, cancels the attack and discards Farmer Maggot', () => {
    const base = maggotState({ site: BARROW_DOWNS, siteDeck: [BREE, MORIA] });
    const state = makeCancelWindowCombat(base, { creatureRace: 'undead', attackSourceType: 'automatic-attack' });

    const action = maggotCancels(state)[0];
    const after = dispatch(state, action);

    // Attack canceled immediately (in-play source, no chain).
    expect(after.combat).toBeNull();
    // The company now stands on Bree, untapped, and owns the card.
    expect(currentSiteDef(after, RESOURCE_PLAYER)).toBe(BREE);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].siteCardOwned).toBe(true);
    // Bree left the location deck; the untapped Barrow-downs returned to it.
    const deck = after.players[RESOURCE_PLAYER].siteDeck.map(s => s.definitionId);
    expect(deck).not.toContain(BREE);
    expect(deck).toContain(BARROW_DOWNS);
    expect(after.players[RESOURCE_PLAYER].siteDiscardPile).toHaveLength(0);
    // Farmer Maggot left play for the discard pile.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === FARMER_MAGGOT)).toBe(false);
    expectInDiscardPile(after, RESOURCE_PLAYER, FARMER_MAGGOT);
  });

  test('the player chooses which eligible site to flee to', () => {
    const base = maggotState({ site: BARROW_DOWNS, siteDeck: [BREE, BAG_END] });
    const state = makeCancelWindowCombat(base, { creatureRace: 'undead', attackSourceType: 'automatic-attack' });

    const bagEndInstance = state.players[RESOURCE_PLAYER].siteDeck
      .find(s => s.definitionId === BAG_END)!.instanceId;
    const action = maggotCancels(state).find(a => a.replacementSiteInstanceId === bagEndInstance)!;
    const after = dispatch(state, action);

    expect(currentSiteDef(after, RESOURCE_PLAYER)).toBe(BAG_END);
  });

  test('a TAPPED replaced site is discarded to the site discard pile, not returned to the deck', () => {
    const base = maggotState({ site: BARROW_DOWNS, siteDeck: [BREE] });
    const tapped = setCompanySiteStatus(base, RESOURCE_PLAYER, 0, CardStatus.Tapped);
    const state = makeCancelWindowCombat(tapped, { creatureRace: 'undead', attackSourceType: 'automatic-attack' });

    const after = dispatch(state, maggotCancels(state)[0]);

    expect(currentSiteDef(after, RESOURCE_PLAYER)).toBe(BREE);
    expect(after.players[RESOURCE_PLAYER].siteDiscardPile.map(s => s.definitionId)).toEqual([BARROW_DOWNS]);
    expect(after.players[RESOURCE_PLAYER].siteDeck.map(s => s.definitionId)).not.toContain(BARROW_DOWNS);
  });

  test('the reducer rejects a replacement site outside the three regions', () => {
    const base = maggotState({ site: BARROW_DOWNS, siteDeck: [BREE, MORIA] });
    const state = makeCancelWindowCombat(base, { creatureRace: 'undead', attackSourceType: 'automatic-attack' });

    const moriaInstance = state.players[RESOURCE_PLAYER].siteDeck
      .find(s => s.definitionId === MORIA)!.instanceId;
    const forged: CancelAttackAction = {
      ...maggotCancels(state)[0],
      replacementSiteInstanceId: moriaInstance,
    };
    const result = reduce(state, forged);

    // Rejected: combat still live, card still in play, company still at Barrow-downs.
    expect(result.error).toContain('The Shire, Arthedain, Cardolan');
    expect(result.state.combat).not.toBeNull();
    expect(currentSiteDef(result.state, RESOURCE_PLAYER)).toBe(BARROW_DOWNS);
    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === FARMER_MAGGOT)).toBe(true);
  });

  // ─── Site-phase automatic attacks ─────────────────────────────────────────

  test('cancels a site automatic-attack and faces none at the replacement site', () => {
    const base = maggotState({ site: BARROW_DOWNS, siteDeck: [WEATHERTOP], phase: Phase.Site });
    const atAttacks: GameState = {
      ...base,
      phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: false, automaticAttacksResolved: 0 }),
    };

    // Barrow-downs' Undead attack initiates.
    const inCombat = dispatch(atAttacks, { type: 'pass', player: PLAYER_1 });
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.creatureRace).toBe('undead');

    // Farmer Maggot swaps Barrow-downs for Weathertop and cancels the attack.
    const swapped = dispatch(inCombat, maggotCancels(inCombat)[0]);
    expect(swapped.combat).toBeNull();
    expect(currentSiteDef(swapped, RESOURCE_PLAYER)).toBe(WEATHERTOP);
    expect((swapped.phaseState as SitePhaseState).autoAttacksSkipped).toBe(true);

    // The company was placed at Weathertop, not entered: its Wolves attack is
    // never faced and the site phase moves on.
    const advanced = dispatch(swapped, { type: 'pass', player: PLAYER_1 });
    expect(advanced.combat).toBeNull();
    expect((advanced.phaseState as SitePhaseState).step).not.toBe('automatic-attacks');
  });

  test('a new company selected later in the site phase faces its own automatic-attacks again', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: BARROW_DOWNS, characters: [LEGOLAS] },
            { site: WEATHERTOP, characters: [ARAGORN] },
          ],
          hand: [],
          siteDeck: [BREE],
          cardsInPlay: [maggotInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const atAttacks: GameState = {
      ...base,
      phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: false, automaticAttacksResolved: 0 }),
    };

    const inCombat = dispatch(atAttacks, { type: 'pass', player: PLAYER_1 });
    const swapped = dispatch(inCombat, maggotCancels(inCombat)[0]);
    expect((swapped.phaseState as SitePhaseState).autoAttacksSkipped).toBe(true);

    // Selecting the second company clears the abandonment flag, so Weathertop's
    // Wolves attack is still faced by that company.
    const secondCompanyId = swapped.players[RESOURCE_PLAYER].companies[1].id;
    const selected = dispatch(
      { ...swapped, phaseState: { ...(swapped.phaseState as SitePhaseState), step: 'select-company' } },
      { type: 'select-company', player: PLAYER_1, companyId: secondCompanyId },
    );
    expect((selected.phaseState as SitePhaseState).autoAttacksSkipped).toBeUndefined();
  });
});
