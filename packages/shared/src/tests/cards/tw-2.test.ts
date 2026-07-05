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
 * | # | Feature                                                | Status          | Notes                                                     |
 * |---|--------------------------------------------------------|-----------------|-----------------------------------------------------------|
 * | 1 | Dual play: as a hazard creature OR permanent-event     | NOT IMPLEMENTED | no play-mode-selection subsystem; card is hazard-event    |
 * | 2 | Creature-mode base keying {d}{D}                       | NOT IMPLEMENTED | depends on #1 (cannot be played as a creature)            |
 * | 3 | Creature-mode alt keying (Brown Lands, Dagorlad, …)    | NOT IMPLEMENTED | depends on #1                                             |
 * | 4 | Permanent-event: tapped during opponent's M/H phase    | NOT IMPLEMENTED | no hazard-player activation window in opponent's M/H      |
 * | 5 | Tapping counts against the hazard limit                | NOT IMPLEMENTED | depends on #4                                             |
 * | 6 | On tap → short-event: tap any one character            | NOT IMPLEMENTED | no tap-to-trigger-short-event mechanic                    |
 * | 7 | Adds a Nazgûl auto-attack at dm-35 / dm-36 while in play| IMPLEMENTED     | permanent-event-auto-attack (manifestations.ts)           |
 * | 8 | Counts as half a creature for deck construction        | IMPLEMENTED     | play-flag: playable-as-event (deck-validation.ts)         |
 *
 * Playable: PARTIALLY. The dual creature/permanent-event play mode (#1–#3)
 * and the "tap during the opponent's M/H phase to tap a character" activation
 * (#4–#6) require large, currently-unimplemented subsystems shared by every
 * Nazgûl (tw-2, tw-12, tw-47, tw-113) and the other dual creature/event
 * hazards (Mouth of Sauron, the manifestation hunters, the Wolf-riders, the
 * Ungoliant spawns). This card is therefore NOT CERTIFIED.
 *
 * The tests below exercise only the two features the engine already supports
 * (#7 and #8) with real engine assertions; the unimplemented rules above are
 * documented rather than asserted (no `test.todo`).
 */

import { describe, test, expect } from 'vitest';
import type { CardDefinitionId, SiteCard, DeckList } from '../../index.js';
import { validateDeck } from '../../index.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import {
  buildSimpleTwoPlayerState,
  addCardInPlay,
  HAZARD_PLAYER,
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
});
