/**
 * @module tw-113.test
 *
 * Card test: Witch-king of Angmar (tw-113)
 * Type: hazard-creature (dual creature/permanent-event)
 * Race: Nazgûl (ringwraith). Unique. Nazgûl (1st). MP: 6 (kill).
 * Base creature stats: one strike, prowess 17, body 12.
 * Canonical keying (`attributes.playable`): {d}{D} — a Dark-domain region
 * type and a Dark-hold site type.
 *
 * Card text:
 *   "Unique. Nazgûl (1st). May be played as a hazard creature (with one
 *    strike) or as a permanent-event. As a creature, may also be played keyed
 *    to Angmar, Gundabad, Gorgoroth, and Imlad Morgul; and may also be played
 *    at sites in these regions. If played as a permanent-event, it will remain
 *    in play until tapped during the opponent's movement/hazard phase (tapping
 *    counts against the hazard limit). When tapped, Witch-king of Angmar
 *    becomes a long-event and causes all Shadow-holds [{S}] to become
 *    Dark-holds [{D}]. When resolved, the long-event effect will remain and
 *    this card is discarded."
 *
 * CRF 22 (Witch-king of Angmar): "Although he becomes a long-event when tapped,
 * he is discarded when the effect resolves just like other Nazgûl. The
 * long-event effect will remain until the appropriate time." — i.e. the card
 * goes straight to the discard pile while the retype lasts exactly as long as a
 * hazard long-event owned by his controller would ([2.III.3]).
 *
 * Cross-card interaction (from the site side, already implemented): the
 * Under-deeps sites The Iron-deeps (dm-33) and The Under-leas (dm-40) carry
 * "If the Witch-king of Angmar is in play as a permanent-event, it must be used
 * as an additional automatic-attack (discard after use — ignore result of
 * defeat)", and The Under-courts (dm-36) the same for any Nazgûl
 * permanent-event. Modeled by the `permanent-event-auto-attack` effect on the
 * Witch-king (siteIds dm-33/dm-40/dm-36, Nazgûl 1 strike 17/12, discardAfterUse).
 *
 * Engine support:
 * | # | Feature                                                  | Status      | Notes                                                |
 * |---|----------------------------------------------------------|-------------|------------------------------------------------------|
 * | 1 | Dual play: as a hazard creature OR permanent-event       | IMPLEMENTED | creature-alt-event (mode permanent-event)            |
 * | 2 | Creature-mode base keying {d}{D}                         | IMPLEMENTED | regionTypes/siteTypes in keyedTo                     |
 * | 3 | Creature-mode alt keying (Angmar, Gundabad, …)           | IMPLEMENTED | regionNames in keyedTo                               |
 * | 4 | Permanent-event: tapped during opponent's M/H phase      | IMPLEMENTED | tap-alt-permanent-event                              |
 * | 5 | Tapping counts against the hazard limit                  | IMPLEMENTED | handleTapAltPermanentEvent                           |
 * | 6 | On tap → long-event: all Shadow-holds become Dark-holds  | IMPLEMENTED | site-type-remap (applySiteTypeRemap)                 |
 * | 7 | Card discarded on resolution, effect remains             | IMPLEMENTED | short-event chain path + constraint outlives card    |
 * | 8 | Effect lasts as long as a hazard long-event would        | IMPLEMENTED | scope next-long-event-phase / long-event-phase-end   |
 * | 9 | Adds a Nazgûl auto-attack at dm-33 / dm-36 / dm-40       | IMPLEMENTED | permanent-event-auto-attack (manifestations.ts)      |
 * |10 | Counts as half a creature for deck construction          | IMPLEMENTED | play-flag: playable-as-event (deck-validation.ts)    |
 * |11 | Rule 5.24 sideboarding with a Nazgûl permanent-event     | IMPLEMENTED | isNazgulPermanentEvent (reducer-utils.ts)            |
 *
 * Playable: YES. Re-modeled from a bare `hazard-event` into a proper dual-mode
 * `hazard-creature` (strikes 1 / prowess 17 / body 12 / kill MP 6 / Nazgûl /
 * `{d}{D}`, per the authoritative card DB), keeping the
 * `permanent-event-auto-attack` and the `playable-as-event` deck-weight flag,
 * and adding the generic `creature-alt-event` permanent-event mode. The on-tap
 * long-event is the new `site-type-remap` primitive: a `site.type` override
 * filtered by the sites' *printed* type (so it retypes a whole class of sites
 * at once, bound to no definition) with the `next-long-event-phase` constraint
 * scope carrying the duration after the card is discarded.
 *
 * Rule interaction: the MEAS §6(d) Under-deeps type-immutability short-circuit
 * in `getEffectiveSiteType` still applies — an Under-deeps Shadow-hold
 * (The Under-leas dm-40) keeps its printed type. Asserted below.
 */

import { describe, test, expect } from 'vitest';
import type { CardDefinitionId, SiteCard, DeckList, GameState } from '../../index.js';
import { validateDeck, computeLegalActions, Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { getEffectiveSiteType } from '../../engine/effective.js';
import {
  buildSimpleTwoPlayerState,
  buildHazardMovingState,
  addCardInPlay,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  playAltPermanentEventAndResolve,
  tapAltPermanentEventAndResolve,
  findHandCardId, handCardId, companyIdAt, viableActions, nonViableOfType, dispatch,
  PLAYER_1, PLAYER_2, ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  HAZARD_PLAYER, RESOURCE_PLAYER,
  pool,
  HERO_RESOURCES_30,
} from '../test-helpers.js';

const WITCH_KING = 'tw-113' as CardDefinitionId;
/** The Great Goblin — a creature keyed to Dark-holds [{D}] and nothing else. */
const THE_GREAT_GOBLIN = 'tw-95' as CardDefinitionId;
/** Goblin-gate — a second printed Shadow-hold, for "all Shadow-holds". */
const GOBLIN_GATE = 'tw-398' as CardDefinitionId;
const CARN_DUM = 'tw-380' as CardDefinitionId;
const BREE = 'tw-378' as CardDefinitionId;
const THE_IRON_DEEPS = 'dm-33' as CardDefinitionId;
const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId;
const THE_UNDER_LEAS = 'dm-40' as CardDefinitionId;
const ASSASSIN = 'tw-9' as CardDefinitionId;

// 11 ordinary (full) hazard creatures — one short of the 12-creature minimum on
// their own, so a single half-creature category can be exercised on top.
const ELEVEN_FULL_CREATURES = [
  { name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 3 },
  { name: 'Orc-patrol', card: 'tw-074' as CardDefinitionId, qty: 3 },
  { name: 'Barrow-wight', card: 'tw-015' as CardDefinitionId, qty: 3 },
  { name: 'Orc-guard', card: 'tw-072' as CardDefinitionId, qty: 2 },
];

const TWELVE_FULL_CREATURES = [
  { name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 3 },
  { name: 'Orc-patrol', card: 'tw-074' as CardDefinitionId, qty: 3 },
  { name: 'Barrow-wight', card: 'tw-015' as CardDefinitionId, qty: 3 },
  { name: 'Orc-guard', card: 'tw-072' as CardDefinitionId, qty: 3 },
];

const baseDeck: DeckList = {
  id: 'tw-113-witch-king',
  name: 'Witch-king deck-weight test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Moria', card: MORIA, qty: 1 }],
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
 * The M/H phase state shared by the permanent-event tests: the resource
 * player's company is moving to Moria, a printed Shadow-hold, through a
 * Wilderness (so nothing about the path itself makes a {D}-keyed creature
 * playable).
 */
const MORIA_MH = {
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Redhorn Gate'],
  destinationSiteType: SiteType.ShadowHold,
  destinationSiteName: 'Moria',
};

describe('Witch-king of Angmar (tw-113)', () => {
  // ─── #9: permanent-event adds a Nazgûl auto-attack at the Under-deeps ───────

  test('The Iron-deeps (dm-33) has only its printed Trolls attack when the Witch-king is not in play', () => {
    const state = buildSimpleTwoPlayerState();
    const attacks = getActiveAutoAttacks(state, state.cardPool[THE_IRON_DEEPS] as SiteCard);
    expect(attacks.every(a => a.creatureType !== 'Nazgûl')).toBe(true);
  });

  test('the Witch-king in play adds a Nazgûl auto-attack at The Iron-deeps, The Under-leas and The Under-courts', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, WITCH_KING);
    for (const siteId of [THE_IRON_DEEPS, THE_UNDER_LEAS, THE_UNDER_COURTS]) {
      const attacks = getActiveAutoAttacks(state, state.cardPool[siteId] as SiteCard);
      const nazgul = attacks.find(a => a.creatureType === 'Nazgûl');
      expect(nazgul).toBeDefined();
      expect(nazgul).toMatchObject({ strikes: 1, prowess: 17, body: 12 });
      expect(nazgul!.sourceInstanceId).toBeDefined();
    }
  });

  test('the Witch-king does not augment an unrelated site (Moria)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, WITCH_KING);
    const attacks = getActiveAutoAttacks(state, state.cardPool[MORIA] as SiteCard);
    expect(attacks.every(a => a.creatureType !== 'Nazgûl')).toBe(true);
  });

  // ─── #10: dual creature/event hazard counts as HALF a creature ─────────────

  test('a full 12-creature hazard section meets the 12-creature minimum (control)', () => {
    expect(hasMin12Error(withHazards([...TWELVE_FULL_CREATURES]))).toBe(false);
  });

  test('the Witch-king counts as half a creature: 11 full + Witch-king = 11.5 → 11 < 12', () => {
    const deck = withHazards([...ELEVEN_FULL_CREATURES, { name: 'Witch-king of Angmar', card: WITCH_KING, qty: 1 }]);
    expect(hasMin12Error(deck)).toBe(true);
  });

  // ─── #2: creature mode, base keying {d}{D} ────────────────────────────────

  test('playable as a creature keyed to a Dark-hold; combat is 1 strike at prowess 17', () => {
    resetMint();
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WITCH_KING], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark], resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold, destinationSiteName: 'Barad-dûr',
    }) };
    const wkId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(ready, PLAYER_2, wkId, companyId, { method: 'site-type', value: 'dark-hold' });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(17);
  });

  // ─── #3: creature mode, alternative keying to the four named regions ──────

  test('playable as a creature keyed to Angmar — a named alt region that is not a Dark-domain', () => {
    resetMint();
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WITCH_KING], siteDeck: [RIVENDELL] },
      ],
    });
    // Angmar is a Shadow-land, so the {d}{D} base keying cannot reach this
    // path — only the named-region clause can.
    const ready = { ...state, phaseState: makeMHState({
      resolvedSitePath: [RegionType.Shadow], resolvedSitePathNames: ['Angmar'],
      destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Carn Dûm',
    }) };
    const wkId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(ready, PLAYER_2, wkId, companyId, { method: 'region-name', value: 'Angmar' });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(17);
  });

  test('not playable as a creature keyed to a region outside {d} and the four named regions', () => {
    resetMint();
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WITCH_KING], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Wold & Foothills'],
      destinationSiteType: SiteType.BorderHold, destinationSiteName: 'Lake-town',
    }) };
    const wkId = handCardId(ready, HAZARD_PLAYER);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => (a.action as { cardInstanceId?: string }).cardInstanceId === (wkId as unknown as string))
      .filter(a => (a.action as { keyedBy?: unknown }).keyedBy !== undefined);
    expect(creaturePlays).toHaveLength(0);
  });

  // ─── #1: permanent-event mode ────────────────────────────────────────────

  test('played as a permanent-event, enters play untapped and does not yet retype anything', () => {
    const built = buildHazardMovingState(MORIA, 'Moria', [WITCH_KING], [ARAGORN], { origin: LORIEN });
    const ready = { ...built, phaseState: makeMHState(MORIA_MH) };
    const wkId = findHandCardId(ready, HAZARD_PLAYER, WITCH_KING);

    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);

    const state = playAltPermanentEventAndResolve(ready, PLAYER_2, wkId, companyIdAt(ready, RESOURCE_PLAYER));
    const inPlay = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === wkId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);
    // Entering play is not the trigger — the retype only happens on tap.
    expect(getEffectiveSiteType(state, MORIA, SiteType.ShadowHold)).toBe(SiteType.ShadowHold);
  });

  // ─── #5: tapping counts against the hazard limit ─────────────────────────

  test('tapping counts one against the hazard limit', () => {
    const built = buildHazardMovingState(MORIA, 'Moria', [WITCH_KING], [ARAGORN], { origin: LORIEN });
    const ready = { ...built, phaseState: makeMHState(MORIA_MH) };
    const wkId = findHandCardId(ready, HAZARD_PLAYER, WITCH_KING);
    const state = playAltPermanentEventAndResolve(ready, PLAYER_2, wkId, companyIdAt(ready, RESOURCE_PLAYER));

    const before = (state.phaseState as ReturnType<typeof makeMHState>).hazardsPlayedThisCompany;
    const afterTap = tapAltPermanentEventAndResolve(state, PLAYER_2, wkId);
    const after = (afterTap.phaseState as ReturnType<typeof makeMHState>).hazardsPlayedThisCompany;
    expect(after).toBe(before + 1);
  });

  test('tapping is not offered once the hazard limit for the company is reached', () => {
    const built = buildHazardMovingState(MORIA, 'Moria', [WITCH_KING], [ARAGORN], { origin: LORIEN });
    const ready = { ...built, phaseState: makeMHState(MORIA_MH) };
    const wkId = findHandCardId(ready, HAZARD_PLAYER, WITCH_KING);
    const state = playAltPermanentEventAndResolve(ready, PLAYER_2, wkId, companyIdAt(ready, RESOURCE_PLAYER));

    const mh = state.phaseState as ReturnType<typeof makeMHState>;
    const atLimit = { ...state, phaseState: { ...mh, hazardsPlayedThisCompany: mh.hazardLimitAtReveal } };
    expect(viableActions(atLimit, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);
    expect(nonViableOfType(computeLegalActions(atLimit, PLAYER_2), 'tap-alt-permanent-event')
      .some(a => a.reason === 'Hazard limit reached')).toBe(true);
  });

  // ─── #4/#6/#7: the on-tap long-event ─────────────────────────────────────

  test('when tapped, all Shadow-holds become Dark-holds and the card is discarded', () => {
    const built = buildHazardMovingState(MORIA, 'Moria', [WITCH_KING], [ARAGORN], { origin: LORIEN });
    const ready = { ...built, phaseState: makeMHState(MORIA_MH) };
    const wkId = findHandCardId(ready, HAZARD_PLAYER, WITCH_KING);
    const state = playAltPermanentEventAndResolve(ready, PLAYER_2, wkId, companyIdAt(ready, RESOURCE_PLAYER));
    expect(getEffectiveSiteType(state, MORIA, SiteType.ShadowHold)).toBe(SiteType.ShadowHold);

    const afterTap = tapAltPermanentEventAndResolve(state, PLAYER_2, wkId);

    // The retype applies to every Shadow-hold, not just one bound site.
    expect(getEffectiveSiteType(afterTap, MORIA, SiteType.ShadowHold)).toBe(SiteType.DarkHold);
    expect(getEffectiveSiteType(afterTap, GOBLIN_GATE, SiteType.ShadowHold)).toBe(SiteType.DarkHold);
    // Sites of other printed types are untouched.
    expect(getEffectiveSiteType(afterTap, CARN_DUM, SiteType.DarkHold)).toBe(SiteType.DarkHold);
    expect(getEffectiveSiteType(afterTap, BREE, SiteType.BorderHold)).toBe(SiteType.BorderHold);

    // "…and this card is discarded" — it leaves play the moment the effect
    // resolves, while the long-event effect above stays behind.
    expect(afterTap.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === wkId)).toBe(false);
    expect(afterTap.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === wkId)).toBe(true);
  });

  test('MEAS §6(d): an Under-deeps Shadow-hold (The Under-leas) keeps its printed type', () => {
    const built = buildHazardMovingState(MORIA, 'Moria', [WITCH_KING], [ARAGORN], { origin: LORIEN });
    const ready = { ...built, phaseState: makeMHState(MORIA_MH) };
    const wkId = findHandCardId(ready, HAZARD_PLAYER, WITCH_KING);
    const state = playAltPermanentEventAndResolve(ready, PLAYER_2, wkId, companyIdAt(ready, RESOURCE_PLAYER));
    const afterTap = tapAltPermanentEventAndResolve(state, PLAYER_2, wkId);

    expect(getEffectiveSiteType(afterTap, THE_UNDER_LEAS, SiteType.ShadowHold)).toBe(SiteType.ShadowHold);
  });

  test('after the retype, a creature keyed only to Dark-holds is playable at a Shadow-hold', () => {
    const built = buildHazardMovingState(MORIA, 'Moria', [WITCH_KING, THE_GREAT_GOBLIN], [ARAGORN], { origin: LORIEN });
    const ready = { ...built, phaseState: makeMHState(MORIA_MH) };
    const wkId = findHandCardId(ready, HAZARD_PLAYER, WITCH_KING);
    const goblinId = findHandCardId(ready, HAZARD_PLAYER, THE_GREAT_GOBLIN);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const state = playAltPermanentEventAndResolve(ready, PLAYER_2, wkId, companyId);

    // Moria is a printed Shadow-hold: {D}-only keying does not reach it.
    expect(viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => (a.action as { cardInstanceId?: string }).cardInstanceId === (goblinId as unknown as string)))
      .toHaveLength(0);

    const afterTap = tapAltPermanentEventAndResolve(state, PLAYER_2, wkId);

    const offered = viableActions(afterTap, PLAYER_2, 'play-hazard')
      .filter(a => (a.action as { cardInstanceId?: string }).cardInstanceId === (goblinId as unknown as string));
    expect(offered.some(a => {
      const keyedBy = (a.action as { keyedBy?: { method: string; value: string } }).keyedBy;
      return keyedBy?.method === 'site-type' && keyedBy.value === SiteType.DarkHold;
    })).toBe(true);

    // And the reducer agrees: the play goes through and starts combat.
    const combatState = playCreatureHazardAndResolve(
      afterTap, PLAYER_2, goblinId, companyId, { method: 'site-type', value: SiteType.DarkHold },
    );
    expect(combatState.combat).not.toBeNull();
  });

  // ─── #8: the effect lasts exactly as long as a hazard long-event would ────

  test('the retype survives the intervening long-event phase and expires at the owner\'s next one', () => {
    const built = buildHazardMovingState(MORIA, 'Moria', [WITCH_KING], [ARAGORN], { origin: LORIEN });
    const ready = { ...built, phaseState: makeMHState(MORIA_MH) };
    const wkId = findHandCardId(ready, HAZARD_PLAYER, WITCH_KING);
    const state = playAltPermanentEventAndResolve(ready, PLAYER_2, wkId, companyIdAt(ready, RESOURCE_PLAYER));
    const afterTap = tapAltPermanentEventAndResolve(state, PLAYER_2, wkId);
    expect(getEffectiveSiteType(afterTap, MORIA, SiteType.ShadowHold)).toBe(SiteType.DarkHold);

    // Turn 2 is the Witch-king controller's own turn: PLAYER_1 is the hazard
    // player there, so the [2.III.3] sweep does not touch PLAYER_2's effect.
    const turn2LongEvent: GameState = {
      ...afterTap, chain: null, activePlayer: PLAYER_2, turnNumber: 2,
      phaseState: { phase: Phase.LongEvent } as GameState['phaseState'],
    };
    const afterTurn2 = dispatch(turn2LongEvent, { type: 'pass', player: PLAYER_2 });
    expect(getEffectiveSiteType(afterTurn2, MORIA, SiteType.ShadowHold)).toBe(SiteType.DarkHold);

    // Turn 3 is the opponent's turn again — PLAYER_2 is the hazard player, so
    // this is when his hazard long-events (and this effect) are discarded.
    const turn3LongEvent: GameState = {
      ...afterTurn2, chain: null, activePlayer: PLAYER_1, turnNumber: 3,
      phaseState: { phase: Phase.LongEvent } as GameState['phaseState'],
    };
    const afterTurn3 = dispatch(turn3LongEvent, { type: 'pass', player: PLAYER_1 });
    expect(getEffectiveSiteType(afterTurn3, MORIA, SiteType.ShadowHold)).toBe(SiteType.ShadowHold);
  });

  // ─── #11: rule 5.24 — sideboarding with a Nazgûl permanent-event ──────────

  test('the in-play permanent-event may be tapped and discarded to access the sideboard (rule 5.24)', () => {
    resetMint();
    const built = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: MORIA }],
          hand: [], siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [WITCH_KING], siteDeck: [RIVENDELL], sideboard: [ASSASSIN],
        },
      ],
    });
    const ready = { ...built, phaseState: makeMHState(MORIA_MH) };
    const wkId = findHandCardId(ready, HAZARD_PLAYER, WITCH_KING);
    const state = playAltPermanentEventAndResolve(ready, PLAYER_2, wkId, companyIdAt(ready, RESOURCE_PLAYER));

    expect(viableActions(state, PLAYER_2, 'sideboard-with-nazgul')
      .some(a => (a.action as { cardInstanceId?: string; destination?: string }).cardInstanceId === (wkId as unknown as string)
        && (a.action as { destination?: string }).destination === 'discard')).toBe(true);

    const after = dispatch(state, {
      type: 'sideboard-with-nazgul', player: PLAYER_2,
      cardInstanceId: wkId, destination: 'discard',
    });
    // Discarded outright — the normal tap effect (the long-event) does not apply.
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === wkId)).toBe(true);
    expect(after.chain).toBeNull();
    expect(getEffectiveSiteType(after, MORIA, SiteType.ShadowHold)).toBe(SiteType.ShadowHold);
  });
});
