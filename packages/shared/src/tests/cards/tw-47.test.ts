/**
 * @module tw-47.test
 *
 * Card test: Khamûl the Easterling (tw-47)
 * Type: hazard-creature (dual creature/permanent-event)
 * Race: Nazgûl. Unique. Nazgûl (2nd). MP: 6 (kill).
 * Base creature stats: one strike, prowess 18, body 8.
 * Canonical keying (`attributes.playable`): {d}{D} — a Dark-domain region
 * type and a Dark-hold site type.
 *
 * Card text:
 *   "Unique. Nazgûl (2nd). May be played as a hazard creature (with one
 *    strike) or as a permanent-event. As a creature, may also be played keyed
 *    to Brown Lands, Heart of Mirkwood, Gorgoroth, and Southern Mirkwood; and
 *    may also be played at sites in these regions. If played as a
 *    permanent-event, it will remain in play until tapped during the
 *    opponent's movement/hazard phase (tapping counts against the hazard
 *    limit). When tapped, Khamûl the Easterling becomes a short-event and
 *    forces opponent to discard one card of his choice for every Nazgûl
 *    permanent-event in play (including this one) at the time of declaration."
 *
 * CRF ruling: "The number of cards discarded is set at the time of
 * declaration. The cards are discarded from your opponent's hand."
 *
 * Cross-card interaction (from the site side, already implemented): the
 * Under-deeps sites The Sulfur-deeps (dm-35) and The Under-courts (dm-36)
 * carry the special rule "If Khamûl the Easterling or Adûnaphel is in play as a
 * permanent-event, one must be used as an additional automatic-attack
 * (attacker's choice, discard after use — ignore result of defeat)". This is
 * modeled by the `permanent-event-auto-attack` effect on Khamûl (siteIds
 * dm-35/dm-36, Nazgûl 1 strike 18/8, discardAfterUse).
 *
 * Engine support:
 * | # | Feature                                                | Status      | Notes                                              |
 * |---|--------------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Dual play: as a hazard creature OR permanent-event     | IMPLEMENTED | creature-alt-event (mode permanent-event)          |
 * | 2 | Creature-mode base keying {d}{D}                       | IMPLEMENTED | regionTypes/siteTypes in keyedTo                   |
 * | 3 | Creature-mode alt keying (Brown Lands, Heart of …)     | IMPLEMENTED | regionNames in keyedTo                             |
 * | 4 | Permanent-event: tapped during opponent's M/H phase    | IMPLEMENTED | tap-alt-permanent-event                            |
 * | 5 | Tapping counts against the hazard limit                | IMPLEMENTED | handleTapAltPermanentEvent                         |
 * | 6 | On tap → short-event: opponent discards N cards        | IMPLEMENTED | force-opponent-discard (match any, dynamic count)  |
 * | 7 | Count = Nazgûl permanent-events in play (incl. self)   | IMPLEMENTED | count fixed at declaration (payload thread)        |
 * | 8 | Adds a Nazgûl auto-attack at dm-35 / dm-36 while in play| IMPLEMENTED | permanent-event-auto-attack (manifestations.ts)    |
 * | 9 | Counts as half a creature for deck construction        | IMPLEMENTED | play-flag: playable-as-event (deck-validation.ts)  |
 *
 * Playable: YES. Re-modeled from a bare (and mistyped) `hazard-event` into a
 * proper dual-mode `hazard-creature` (strikes 1 / prowess 18 / body 8 / kill MP
 * 6 / Nazgûl / `{d}{D}`, per the authoritative card DB), keeping the
 * `permanent-event-auto-attack` (its real cross-card interaction with the
 * Under-deeps sites dm-35/dm-36) and the `playable-as-event` deck-weight flag.
 * The creature mode and the permanent-event mode (enter play → tap during
 * opponent's M/H, counting one against the hazard limit → "becomes a
 * short-event" that forces the opponent to discard one card per Nazgûl
 * permanent-event in play, count fixed at declaration) are implemented via the
 * generic `creature-alt-event` primitive and the generalized
 * `force-opponent-discard` effect (`match: "any"` + a `countCardsInPlay`
 * dynamic count). Tests drive all of #1–#9.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, CardInstanceId, GameState, SiteCard, DeckList, ForceDiscardCardAction } from '../../index.js';
import { validateDeck, Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import {
  buildSimpleTwoPlayerState,
  addCardInPlay,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, viableActions, dispatch, resolveChain,
  PLAYER_1, PLAYER_2, ARAGORN, LEGOLAS, GIMLI, FRODO, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  HAZARD_PLAYER, RESOURCE_PLAYER,
  pool,
  HERO_RESOURCES_30,
} from '../test-helpers.js';

const KHAMUL = 'tw-47' as CardDefinitionId;
const ADUNAPHEL = 'tw-2' as CardDefinitionId;
const THE_SULFUR_DEEPS = 'dm-35' as CardDefinitionId;
const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId;

// 11 ordinary (full) hazard creatures — one short of the 12-creature minimum
// on their own, so a single half-creature category can be exercised on top.
const ELEVEN_FULL_CREATURES = [
  { name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 3 },
  { name: 'Orc-patrol', card: 'tw-074' as CardDefinitionId, qty: 3 },
  { name: 'Barrow-wight', card: 'tw-015' as CardDefinitionId, qty: 3 },
  { name: 'Orc-guard', card: 'tw-072' as CardDefinitionId, qty: 2 },
];

// A full 12-creature hazard section (Orc-guard bumped to 3) — the control
// showing that a 12th *full* creature satisfies the minimum.
const TWELVE_FULL_CREATURES = [
  { name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 3 },
  { name: 'Orc-patrol', card: 'tw-074' as CardDefinitionId, qty: 3 },
  { name: 'Barrow-wight', card: 'tw-015' as CardDefinitionId, qty: 3 },
  { name: 'Orc-guard', card: 'tw-072' as CardDefinitionId, qty: 3 },
];

const baseDeck: DeckList = {
  id: 'tw-47-khamul',
  name: 'Khamûl deck-weight test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 }],
    hazards: [],
    resources: [...HERO_RESOURCES_30],
  },
};

const withHazards = (hazards: DeckList['deck']['hazards']): DeckList => ({
  ...baseDeck,
  deck: { ...baseDeck.deck, hazards },
});

const hasMin12Error = (deck: DeckList): boolean =>
  validateDeck(deck, pool).some(e => e.section === 'hazards' && e.message.includes('min 12'));

/**
 * Build an M/H state with PLAYER_1 (resource) active at Moria and PLAYER_2
 * (hazard) holding a single Khamûl. The resource player's hand is configurable
 * so the discard count can be exercised.
 */
function buildKhamulMH(resourceHand: CardDefinitionId[] = []) {
  const state = buildTestState({
    activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: resourceHand, siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [KHAMUL], siteDeck: [RIVENDELL] },
    ],
  });
  return { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
}

describe('Khamûl the Easterling (tw-47)', () => {
  beforeEach(() => resetMint());

  // ─── #8: permanent-event adds a Nazgûl auto-attack at dm-35 / dm-36 ─────────

  test('The Sulfur-deeps (dm-35) has only its printed Trolls attack when Khamûl is not in play', () => {
    const state = buildSimpleTwoPlayerState();
    const site = state.cardPool[THE_SULFUR_DEEPS] as SiteCard;
    const attacks = getActiveAutoAttacks(state, site);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Trolls', strikes: 2, prowess: 9 });
  });

  test('Khamûl in play adds a Nazgûl auto-attack at The Sulfur-deeps (dm-35)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, KHAMUL);
    const site = state.cardPool[THE_SULFUR_DEEPS] as SiteCard;
    const attacks = getActiveAutoAttacks(state, site);
    // Printed Trolls (2/9) + the Khamûl permanent-event Nazgûl attack (1 strike, 18/8).
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Nazgûl', strikes: 1, prowess: 18, body: 8 });
    expect(attacks[1].sourceInstanceId).toBeDefined();
  });

  test('Khamûl in play adds a Nazgûl auto-attack at The Under-courts (dm-36)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, KHAMUL);
    const site = state.cardPool[THE_UNDER_COURTS] as SiteCard;
    const attacks = getActiveAutoAttacks(state, site);
    // Printed Trolls (3/10) + the Khamûl permanent-event Nazgûl attack (1 strike, 18/8).
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Nazgûl', strikes: 1, prowess: 18, body: 8 });
  });

  test('Khamûl does not augment an unrelated site (Moria)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, KHAMUL);
    const moria = state.cardPool['tw-413' as CardDefinitionId] as SiteCard;
    const attacks = getActiveAutoAttacks(state, moria);
    expect(attacks.every(a => a.creatureType !== 'Nazgûl')).toBe(true);
  });

  // ─── #9: dual creature/event hazard counts as HALF a creature ──────────────

  test('a full 12-creature hazard section meets the 12-creature minimum (control)', () => {
    expect(hasMin12Error(withHazards([...TWELVE_FULL_CREATURES]))).toBe(false);
  });

  test('Khamûl counts as half a creature: 11 full + Khamûl = 11.5 → 11 < 12', () => {
    const deck = withHazards([...ELEVEN_FULL_CREATURES, { name: 'Khamûl the Easterling', card: KHAMUL, qty: 1 }]);
    expect(hasMin12Error(deck)).toBe(true);
  });

  // ─── #2/#3: creature mode keying + combat ──────────────────────────────────

  test('playable as a creature keyed to a Dark-hold; combat is 1 strike at prowess 18', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [KHAMUL], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark], resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold, destinationSiteName: 'Barad-dûr',
    }) };
    const khamulId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(ready, PLAYER_2, khamulId, companyId, { method: 'site-type', value: 'dark-hold' });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(18);
  });

  // ─── #1/#4: permanent-event mode enters play untapped ──────────────────────

  test('played as a permanent-event, enters play untapped', () => {
    const ready = buildKhamulMH();
    const khamulId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);
    const afterChain = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: khamulId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const inPlay = afterChain.players[1].cardsInPlay.find(c => c.instanceId === khamulId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);
  });

  // ─── #5/#6/#7: tap → short-event, opponent discards N cards ─────────────────

  test('tapping the lone Khamûl (1 Nazgûl in play) forces the opponent to discard exactly one card', () => {
    const ready = buildKhamulMH([GIMLI, FRODO, GANDALF]);
    const khamulId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: khamulId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const hazardsBefore = (afterPlay.phaseState as { hazardsPlayedThisCompany: number }).hazardsPlayedThisCompany;

    // Tap Khamûl → it "becomes a short-event".
    const tap = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
      .find(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === khamulId);
    expect(tap).toBeDefined();
    const afterTap = resolveChain(dispatch(afterPlay, tap!.action));

    // Khamûl left play, was discarded, and tapping counted one against the limit.
    expect(afterTap.players[1].cardsInPlay.some(c => c.instanceId === khamulId)).toBe(false);
    expect(afterTap.players[1].discardPile.some(c => c.instanceId === khamulId)).toBe(true);
    expect((afterTap.phaseState as { hazardsPlayedThisCompany: number }).hazardsPlayedThisCompany)
      .toBe(hazardsBefore + 1);

    // A single discard is demanded of the opponent (resource player).
    const pending = afterTap.pendingResolutions.find(r => r.kind.type === 'force-discard-card');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_1);
    expect((pending!.kind as { remaining?: number }).remaining).toBe(1);

    // The opponent chooses freely from their whole hand (match "any").
    const discardActions = viableActions(afterTap, PLAYER_1, 'force-discard-card');
    expect(discardActions).toHaveLength(3);

    const chosen = (discardActions[0].action as ForceDiscardCardAction).cardInstanceId;
    const afterDiscard = dispatch(afterTap, discardActions[0].action);
    // The chosen card moved from hand to the discard pile; the resolution cleared.
    expect(afterDiscard.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === chosen)).toBe(false);
    expect(afterDiscard.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === chosen)).toBe(true);
    expect(afterDiscard.players[RESOURCE_PLAYER].hand).toHaveLength(2);
    expect(afterDiscard.pendingResolutions.some(r => r.kind.type === 'force-discard-card')).toBe(false);
  });

  test('with a second Nazgûl permanent-event in play, the opponent must discard TWO cards, one at a time', () => {
    // Adûnaphel (another Nazgûl permanent-event) is already in play for the
    // hazard player, so tapping Khamûl fixes the count at 2 (Adûnaphel + Khamûl).
    let ready: GameState = buildKhamulMH([GIMLI, FRODO, GANDALF]);
    ready = addCardInPlay(ready, HAZARD_PLAYER, ADUNAPHEL);
    const khamulId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: khamulId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const tap = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
      .find(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === khamulId);
    const afterTap = resolveChain(dispatch(afterPlay, tap!.action));

    // The discard resolution demands two cards (count locked at declaration).
    const pending = afterTap.pendingResolutions.find(r => r.kind.type === 'force-discard-card');
    expect(pending).toBeDefined();
    expect((pending!.kind as { remaining?: number }).remaining).toBe(2);

    // First discard: the resolution stays alive with remaining = 1.
    const first = viableActions(afterTap, PLAYER_1, 'force-discard-card');
    expect(first).toHaveLength(3);
    const firstChosen = (first[0].action as ForceDiscardCardAction).cardInstanceId;
    const afterFirst = dispatch(afterTap, first[0].action);
    const stillPending = afterFirst.pendingResolutions.find(r => r.kind.type === 'force-discard-card');
    expect(stillPending).toBeDefined();
    expect((stillPending!.kind as { remaining?: number }).remaining).toBe(1);
    expect(afterFirst.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === firstChosen)).toBe(true);

    // Second discard: now only the two remaining hand cards are offered, and the
    // resolution clears afterward.
    const second = viableActions(afterFirst, PLAYER_1, 'force-discard-card');
    expect(second).toHaveLength(2);
    const secondChosen = (second[0].action as ForceDiscardCardAction).cardInstanceId;
    const afterSecond = dispatch(afterFirst, second[0].action);
    expect(afterSecond.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === secondChosen)).toBe(true);
    expect(afterSecond.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(afterSecond.pendingResolutions.some(r => r.kind.type === 'force-discard-card')).toBe(false);
  });

  test('the required discards are capped by the opponent\'s hand size (fewer cards than Nazgûl)', () => {
    // Two Nazgûl in play (count 2) but the opponent holds a single card: they
    // discard the one card they have and the resolution then clears.
    let ready: GameState = buildKhamulMH([GIMLI]);
    ready = addCardInPlay(ready, HAZARD_PLAYER, ADUNAPHEL);
    const khamulId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: khamulId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const tap = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
      .find(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === khamulId);
    const afterTap = resolveChain(dispatch(afterPlay, tap!.action));

    // remaining is capped at the hand size (1), not the raw count (2).
    const pending = afterTap.pendingResolutions.find(r => r.kind.type === 'force-discard-card');
    expect((pending!.kind as { remaining?: number }).remaining).toBe(1);

    const actions = viableActions(afterTap, PLAYER_1, 'force-discard-card');
    expect(actions).toHaveLength(1);
    const after = dispatch(afterTap, actions[0].action);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expect(after.pendingResolutions.some(r => r.kind.type === 'force-discard-card')).toBe(false);
  });
});
