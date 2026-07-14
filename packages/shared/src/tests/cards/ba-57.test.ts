/**
 * @module ba-57.test
 *
 * Card test: Eddy in Fate's Tide (ba-57)
 * Type: minion-resource-event (permanent), alignment ringwraith, Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable during the site phase on an untapped site if The
 *    Balrog is there; the site cannot be an Under-deeps site or surface site
 *    thereof. Tap The Balrog and the site. This site is never discarded and
 *    never untaps for you. Before a company can play any ally or item at any
 *    version of this site, it must tap two characters during the site phase."
 *
 * Effects:
 *   1. play-flag untapped-site-required                       — site.ts
 *   2. play-flag tap-site-on-play                             — chain-reducer.ts
 *   3. play-target site (not under-deeps, not surface)        — site.ts filter
 *   4. play-condition company-context (The Balrog present)    — site.ts
 *   5. eddy-lock (taxTapCharacters 2)                         — the three ongoing rules:
 *        a. permanence ("never discarded")                   — cardKeepsBoundSitePermanent
 *        b. never untaps for the owner (re-placed tapped)     — mh-hazard-play.ts step 8
 *        c. two-character tax on ally/item play               — site.ts + reducer-site.ts
 *      Balrog is tapped on play by the eddy-lock handler in chain-reducer.ts.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildMinionSitePhaseState, buildTestState, makeMHState,
  resetMint, mint,
  viableActions, dispatch,
  playPermanentEventAndResolve,
  findCharInstanceId,
  addP1CardsInPlay, addP2CardsInPlay,
} from '../test-helpers.js';
import { computeLegalActions, reduce, Phase, CardStatus, Alignment, RegionType } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState,
  PlayPermanentEventAction, PaySiteTaxAction,
} from '../../index.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';

const EDDY = 'ba-57' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;          // balrog avatar

// Sites (minion / LE pool).
const SARN = 'le-401' as CardDefinitionId;              // shadow-hold, allows minor items, NOT a surface site
const ETTENMOORS = 'le-373' as CardDefinitionId;        // ruins-and-lairs, NOT a surface site (movement origin)
const MORIA = 'le-392' as CardDefinitionId;             // shadow-hold, surface site of The Under-gates (ba-100 roll 0)
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId;    // under-deeps site
const MINAS_MORGUL = 'le-390' as CardDefinitionId;      // opponent's Darkhaven

// Non-Balrog minion characters for the tax company.
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;

// A plain minion minor item (no effects) — the tax gate target.
const ORC_LIQUOR = 'le-329' as CardDefinitionId;

describe("Eddy in Fate's Tide (ba-57)", () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playability keying ──

  test('playable at an untapped non-Under-deeps site with The Balrog present', () => {
    const state = buildMinionSitePhaseState({ site: SARN, characters: [THE_BALROG], hand: [EDDY] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    expect((actions[0].action as PlayPermanentEventAction).targetSiteDefinitionId).toBe(SARN);
  });

  test('NOT playable when the site is already tapped (untapped-site-required)', () => {
    const state = buildMinionSitePhaseState({
      site: SARN, characters: [THE_BALROG], hand: [EDDY], siteStatus: CardStatus.Tapped,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at an Under-deeps site', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [EDDY] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at a surface site of an Under-deeps site (Moria)', () => {
    const state = buildMinionSitePhaseState({ site: MORIA, characters: [THE_BALROG], hand: [EDDY] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable when The Balrog is not in the company', () => {
    const state = buildMinionSitePhaseState({ site: SARN, characters: [GORBAG, SHAGRAT], hand: [EDDY] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 2: cost — tap The Balrog and the site; card attaches to the site ──

  test('playing the card taps The Balrog and the site, and attaches to the site', () => {
    const state = buildMinionSitePhaseState({ site: SARN, characters: [THE_BALROG], hand: [EDDY] });
    const cardId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, undefined, { targetSiteDefinitionId: SARN });

    // The Balrog is tapped.
    const balrogId = findCharInstanceId(after, RESOURCE_PLAYER, THE_BALROG);
    expect(after.players[RESOURCE_PLAYER].characters[balrogId].status).toBe(CardStatus.Tapped);
    // The site is tapped.
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    // The card is in play, bound to the site definition.
    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === EDDY);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(SARN);
  });

  // ── Rule 3a: permanence — "This site is never discarded" ──

  test('the bound card is exempt from the site-attached orphan sweep while the site is unoccupied', () => {
    const base = buildMinionSitePhaseState({ site: SARN, characters: [THE_BALROG], hand: [] });
    // Move the company off the bound site so no company occupies it.
    const withCard = addP1CardsInPlay({
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], companies: [{ ...base.players[RESOURCE_PLAYER].companies[0], currentSite: null }] },
        base.players[1],
      ] as typeof base.players,
    }, [{ instanceId: mint(), definitionId: EDDY, status: CardStatus.Untapped, attachedToSite: SARN }]);

    const swept = discardOrphanedSiteAttachedEvents(withCard);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === EDDY)).toBe(true);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === EDDY)).toBe(false);
  });

  // ── Rule 3b: never untaps for the owner — re-entering the site arrives tapped ──

  test('when the owner re-enters the bound site definition, it arrives tapped (never untaps for you)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ETTENMOORS, characters: [THE_BALROG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const destInstance = mint();
    const moving: GameState = {
      ...base,
      phaseState: makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [RegionType.Shadow] }),
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: [{
            ...base.players[RESOURCE_PLAYER].companies[0],
            siteCardOwned: true,
            destinationSite: { instanceId: destInstance, definitionId: SARN, status: CardStatus.Untapped },
          }],
        },
        base.players[1],
      ] as typeof base.players,
    };

    // Baseline: no eddy-lock — the destination arrives untapped.
    const baseArrived = dispatch(dispatch(moving, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    const baseSite = baseArrived.players[RESOURCE_PLAYER].companies[0].currentSite!;
    expect(baseSite.definitionId).toBe(SARN);
    expect(baseSite.status).toBe(CardStatus.Untapped);

    // With the owner's eddy-lock bound to SARN — the destination arrives tapped.
    const withLock = addP1CardsInPlay(moving, [
      { instanceId: mint(), definitionId: EDDY, status: CardStatus.Untapped, attachedToSite: SARN },
    ]);
    const lockedArrived = dispatch(dispatch(withLock, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    const lockedSite = lockedArrived.players[RESOURCE_PLAYER].companies[0].currentSite!;
    expect(lockedSite.definitionId).toBe(SARN);
    expect(lockedSite.status).toBe(CardStatus.Tapped);
  });

  // ── Rule 4: two-character tax before any ally or item at any version of the site ──

  test('a company at a locked version of the site must tap two characters before playing an item', () => {
    // Active company (P1) is at an untapped version of SARN; the *opponent* (P2)
    // holds an eddy-lock bound to that site definition — so "any version" of the
    // site taxes this company.
    const base = buildMinionSitePhaseState({
      site: SARN,
      characters: [GORBAG, SHAGRAT, ORC_CAPTAIN, LUITPRAND],
      hand: [ORC_LIQUOR],
    });
    const state = addP2CardsInPlay(base, [
      { instanceId: mint(), definitionId: EDDY, status: CardStatus.Untapped, attachedToSite: SARN },
    ]);
    const itemId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    // Tax unpaid: the item is not playable, and the not-playable entry names Eddy.
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(0);
    const gated = computeLegalActions(state, PLAYER_1)
      .find(ea => !ea.viable && (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === itemId);
    expect(gated?.reason).toMatch(/Eddy/);

    // Two pay-site-tax actions are offered (one per untapped character in the company).
    const taxActions = viableActions(state, PLAYER_1, 'pay-site-tax');
    expect(taxActions.length).toBe(4);

    // Pay the tax by tapping two characters.
    const firstTap = taxActions[0].action as PaySiteTaxAction;
    const afterOne = dispatch(state, firstTap);
    // One character down — still not enough, item still gated.
    expect(afterOne.players[RESOURCE_PLAYER].characters[firstTap.characterId].status).toBe(CardStatus.Tapped);
    expect(viableActions(afterOne, PLAYER_1, 'play-hero-resource').length).toBe(0);

    const secondTap = viableActions(afterOne, PLAYER_1, 'pay-site-tax')[0].action as PaySiteTaxAction;
    const afterTwo = dispatch(afterOne, secondTap);

    // Tax met: the item is now playable, and no further tax actions are offered.
    expect(viableActions(afterTwo, PLAYER_1, 'play-hero-resource').length).toBeGreaterThan(0);
    expect(viableActions(afterTwo, PLAYER_1, 'pay-site-tax').length).toBe(0);
  });

  test('pay-site-tax is rejected for a character outside the active company', () => {
    const base = buildMinionSitePhaseState({
      site: SARN, characters: [GORBAG, SHAGRAT], hand: [],
    });
    const state = addP2CardsInPlay(base, [
      { instanceId: mint(), definitionId: EDDY, status: CardStatus.Untapped, attachedToSite: SARN },
    ]);
    // A character that is not an untapped member of the active company is an
    // illegal tax target — the reducer rejects it.
    const res = reduce(state, { type: 'pay-site-tax', player: PLAYER_1, characterId: mint() });
    expect(res.error).toBeDefined();
  });

  test('with no eddy-lock in play, an item at the same site needs no tax', () => {
    const state = buildMinionSitePhaseState({
      site: SARN,
      characters: [GORBAG, SHAGRAT, ORC_CAPTAIN, LUITPRAND],
      hand: [ORC_LIQUOR],
    });
    expect(viableActions(state, PLAYER_1, 'pay-site-tax').length).toBe(0);
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBeGreaterThan(0);
  });
});
