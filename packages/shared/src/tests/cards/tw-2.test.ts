/**
 * @module tw-2.test
 *
 * Card test: Adûnaphel (tw-2)
 * Type: hazard-event (dual creature/permanent-event)
 * Race: Nazgûl. Unique. Nazgûl (7th). MP: 5 (kill).
 * Base creature stats: one strike, prowess 15, body 10.
 * Canonical keying (`attributes.playable`): {d}{D} — a Dark-domain region
 * type and a Dark-hold site type.
 *
 * Card text:
 *   "Unique. Nazgûl (7th). May be played as a hazard creature (with one
 *    strike) or as a permanent-event. As a creature, may also be played
 *    keyed to Brown Lands, Dagorlad, Gorgoroth, and Western Mirkwood; and
 *    may also be played at sites in these regions. If played as a
 *    permanent-event, it will remain in play until tapped during the
 *    opponent's movement/hazard phase (tapping counts against the hazard
 *    limit). When tapped, Adûnaphel becomes a short-event and causes any
 *    one character to tap."
 *
 * Cross-card interaction (from the site side, already implemented): the
 * Under-deeps sites The Sulfur-deeps (dm-35) and The Under-courts (dm-36)
 * carry the special rule "If Khamûl the Easterling or Adûnaphel is in play
 * as a permanent-event, one must be used as an additional automatic-attack
 * (attacker's choice, discard after use — ignore result of defeat)". This
 * is modeled by the `permanent-event-auto-attack` effect on Adûnaphel
 * (siteIds dm-35/dm-36, Nazgûl 1 strike 15/10, discardAfterUse).
 *
 * Engine support:
 * | # | Feature                                                | Status      | Notes                                              |
 * |---|--------------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Dual play: as a hazard creature OR permanent-event     | IMPLEMENTED | creature-alt-event (mode permanent-event)          |
 * | 2 | Creature-mode base keying {d}{D}                       | IMPLEMENTED | regionTypes/siteTypes in keyedTo                   |
 * | 3 | Creature-mode alt keying (Brown Lands, Dagorlad, …)    | IMPLEMENTED | regionNames in keyedTo                             |
 * | 4 | Permanent-event: tapped during opponent's M/H phase    | IMPLEMENTED | tap-alt-permanent-event                            |
 * | 5 | Tapping counts against the hazard limit                | IMPLEMENTED | handleTapAltPermanentEvent                         |
 * | 6 | On tap → short-event: tap any one character            | IMPLEMENTED | tap-character (applyTapCharacter)                  |
 * | 7 | Adds a Nazgûl auto-attack at dm-35 / dm-36 while in play| IMPLEMENTED | permanent-event-auto-attack (manifestations.ts)    |
 * | 8 | Counts as half a creature for deck construction        | IMPLEMENTED | play-flag: playable-as-event (deck-validation.ts)  |
 *
 * Playable: YES. Re-modeled from a bare `hazard-event` into a proper dual-mode
 * `hazard-creature` (strikes 1 / prowess 15 / body 10 / kill MP 5 / Nazgûl /
 * `{d}{D}`, per the authoritative card DB), keeping the `permanent-event-auto-attack`
 * (its real cross-card interaction with the Under-deeps sites dm-35/dm-36) and
 * the `playable-as-event` deck-weight flag. The creature mode and the
 * permanent-event mode (enter play → tap during opponent's M/H, counting one
 * against the hazard limit → "becomes a short-event" that taps any one chosen
 * character) are implemented via the generic `creature-alt-event` primitive and
 * the `tap-character` effect. Tests drive all of #1–#8.
 */

import { describe, test, expect } from 'vitest';
import type { CardDefinitionId, SiteCard, DeckList } from '../../index.js';
import { validateDeck, Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import {
  buildSimpleTwoPlayerState,
  addCardInPlay,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, viableActions, dispatch, resolveChain, reduce,
  PLAYER_1, PLAYER_2, ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  HAZARD_PLAYER, RESOURCE_PLAYER,
  pool,
  HERO_RESOURCES_30,
} from '../test-helpers.js';

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
  id: 'tw-2-adunaphel',
  name: 'Adûnaphel deck-weight test',
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

describe('Adûnaphel (tw-2)', () => {
  // ─── #7: permanent-event adds a Nazgûl auto-attack at dm-35 / dm-36 ─────────

  test('The Sulfur-deeps (dm-35) has only its printed Trolls attack when Adûnaphel is not in play', () => {
    const state = buildSimpleTwoPlayerState();
    const site = state.cardPool[THE_SULFUR_DEEPS] as SiteCard;
    const attacks = getActiveAutoAttacks(state, site);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Trolls', strikes: 2, prowess: 9 });
  });

  test('Adûnaphel in play adds a Nazgûl auto-attack at The Sulfur-deeps (dm-35)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, ADUNAPHEL);
    const site = state.cardPool[THE_SULFUR_DEEPS] as SiteCard;
    const attacks = getActiveAutoAttacks(state, site);
    // Printed Trolls (2/9) + the Adûnaphel permanent-event Nazgûl attack (1 strike, 15/10).
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Nazgûl', strikes: 1, prowess: 15, body: 10 });
    expect(attacks[1].sourceInstanceId).toBeDefined();
  });

  test('Adûnaphel in play adds a Nazgûl auto-attack at The Under-courts (dm-36)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, ADUNAPHEL);
    const site = state.cardPool[THE_UNDER_COURTS] as SiteCard;
    const attacks = getActiveAutoAttacks(state, site);
    // Printed Trolls (3/10) + the Adûnaphel permanent-event Nazgûl attack (1 strike, 15/10).
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Nazgûl', strikes: 1, prowess: 15, body: 10 });
  });

  test('Adûnaphel does not augment an unrelated site (Moria)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, ADUNAPHEL);
    const moria = state.cardPool['tw-413' as CardDefinitionId] as SiteCard;
    const attacks = getActiveAutoAttacks(state, moria);
    expect(attacks.every(a => a.creatureType !== 'Nazgûl')).toBe(true);
  });

  // ─── #8: dual creature/event hazard counts as HALF a creature ──────────────

  test('a full 12-creature hazard section meets the 12-creature minimum (control)', () => {
    expect(hasMin12Error(withHazards([...TWELVE_FULL_CREATURES]))).toBe(false);
  });

  test('Adûnaphel counts as half a creature: 11 full + Adûnaphel = 11.5 → 11 < 12', () => {
    const deck = withHazards([...ELEVEN_FULL_CREATURES, { name: 'Adûnaphel', card: ADUNAPHEL, qty: 1 }]);
    expect(hasMin12Error(deck)).toBe(true);
  });

  // ─── #2/#3: creature mode keying + combat ──────────────────────────────────

  test('playable as a creature keyed to a Dark-hold; combat is 1 strike at prowess 15', () => {
    resetMint();
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ADUNAPHEL], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark], resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold, destinationSiteName: 'Barad-dûr',
    }) };
    const adunId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(ready, PLAYER_2, adunId, companyId, { method: 'site-type', value: 'dark-hold' });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(15);
  });

  // ─── #1/#4/#5/#6: permanent-event mode + tap → tap a character ──────────────

  test('played as a permanent-event, enters play untapped', () => {
    resetMint();
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ADUNAPHEL], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const adunId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);
    const afterChain = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: adunId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const inPlay = afterChain.players[1].cardsInPlay.find(c => c.instanceId === adunId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);
  });

  test('tapping the in-play permanent-event taps a chosen (untapped) character', () => {
    resetMint();
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ADUNAPHEL], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const adunId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const aragornId = ready.players[0].companies[0].characters[0];

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: adunId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    expect(afterPlay.players[0].characters[aragornId].status).toBe(CardStatus.Untapped);

    // Tap the permanent-event, choosing to tap Aragorn.
    const tapAragorn = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
      .find(a => (a.action as { targetCharacterId?: string }).targetCharacterId === (aragornId as unknown as string));
    expect(tapAragorn).toBeDefined();
    const afterTap = resolveChain(dispatch(afterPlay, tapAragorn!.action));

    // Aragorn is now tapped, and the spent Adûnaphel is discarded.
    expect(afterTap.players[0].characters[aragornId].status).toBe(CardStatus.Tapped);
    expect(afterTap.players[1].cardsInPlay.some(c => c.instanceId === adunId)).toBe(false);
    expect(afterTap.players[1].discardPile.some(c => c.instanceId === adunId)).toBe(true);
  });

  // ─── Regression: the hazard player cannot tap their OWN character (CoE 2.1.2) ─
  // As the hazard player, Adûnaphel's on-tap "any one character to tap" is a
  // hazard directed at the opponent, so it may only target the resource
  // (active) player's characters — never the hazard player's own.
  test('tapping the permanent-event may not target the hazard player\'s own character', () => {
    resetMint();
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ADUNAPHEL], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const adunId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    // PLAYER_2 is the hazard player; LEGOLAS is their own character.
    const aragornId = ready.players[0].companies[0].characters[0];
    const legolasId = ready.players[1].companies[0].characters[0];

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: adunId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));

    const tapTargets = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
      .map(a => (a.action as { targetCharacterId?: string }).targetCharacterId);
    // The opponent's Aragorn is offered; the hazard player's own Legolas is not.
    expect(tapTargets).toContain(aragornId as unknown as string);
    expect(tapTargets).not.toContain(legolasId as unknown as string);

    // Even if a self-target action is forged, the reducer rejects it.
    const forged = reduce(afterPlay, {
      type: 'tap-alt-permanent-event', player: PLAYER_2, cardInstanceId: adunId,
      targetCharacterId: legolasId,
    });
    expect(forged.error).toBeDefined();
    // State is unchanged: Legolas stays untapped and Adûnaphel stays in play.
    expect(forged.state.players[1].characters[legolasId].status).toBe(CardStatus.Untapped);
    expect(forged.state.players[1].cardsInPlay.some(c => c.instanceId === adunId)).toBe(true);
  });
});
