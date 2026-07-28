/**
 * @module tw-46.test
 *
 * Card test: Indûr Dawndeath (tw-46)
 * Type: hazard-creature (dual creature / permanent-event)
 * Race: Nazgûl. Unique. Nazgûl (4th). One strike at prowess 15, body 10, 5 kill MP.
 *
 * Card text:
 *   "Unique. Nazgûl (4th). May be played as a hazard creature (with one
 *    strike) or as a permanent-event.
 *    As a creature, may also be played keyed to Harondor, Imlad Morgul,
 *    Gorgoroth, and Khand; and may also be played at sites in these regions.
 *    If played as a permanent-event, it will remain in play until tapped
 *    during the opponent's movement/hazard phase (tapping counts against the
 *    hazard limit). When tapped, Indûr Dawndeath becomes a short-event and
 *    makes any wounded character discard an item of his choice (but not a
 *    ring)."
 *
 * Keying (canonical `playable` = {d}{D}):
 *   - Base: a Dark-domain region {d} in the site path and a Dark-hold {D}
 *     destination.
 *   - Alt: named regions Harondor, Imlad Morgul, Gorgoroth, Khand — a single
 *     `regionNames` keyedTo entry, which also covers "may also be played at
 *     sites in these regions" (the destination region name is part of the
 *     resolved path; tw-107/tw-83 precedent).
 *
 * Engine support:
 * | # | Feature                                          | Status      | Notes                                            |
 * |---|--------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | One strike, prowess 15, body 10                  | IMPLEMENTED | structural data                                  |
 * | 2 | Keying: base {d}{D}                              | IMPLEMENTED | regionTypes/siteTypes in keyedTo                 |
 * | 3 | Keying: named Harondor/Imlad Morgul/…            | IMPLEMENTED | regionNames in keyedTo                           |
 * | 4 | Permanent-event play mode (dual creature/PE)     | IMPLEMENTED | creature-alt-event (mode permanent-event)        |
 * | 5 | Tapped by opponent in their M/H (vs haz limit)   | IMPLEMENTED | tap-alt-permanent-event (counts vs haz limit)    |
 * | 6 | On tap → a wounded character is picked as victim | IMPLEMENTED | force-discard-target-item `targetFilter`         |
 * | 7 | The victim's controller chooses which item       | IMPLEMENTED | discard-one-company-item narrowed by characterId |
 * | 8 | "but not a ring"                                 | IMPLEMENTED | force-discard-target-item `itemFilter`           |
 * | 9 | dm-36 "any Nazgûl permanent-event" auto-attack   | IMPLEMENTED | permanent-event-auto-attack (tw-2/tw-83 prec.)   |
 *
 * Cross-card interaction (from the site side): The Under-courts (dm-36) reads
 * "If any Nazgûl permanent-event is in play, one must be used as an additional
 * automatic-attack (attacker's choice, discard after use — ignore result of
 * defeat)" — modeled per-Nazgûl via `permanent-event-auto-attack` (siteIds
 * [dm-36], Nazgûl 1 strike 15/10, discardAfterUse), the tw-2/tw-47/tw-83
 * precedent. The Sulfur-deeps (dm-35) names only Khamûl and Adûnaphel, so Indûr
 * carries no dm-35 entry.
 *
 * Playable: YES. Both play modes ride the generic dual-mode primitive
 * (tw-107/tw-2/tw-83 precedent). The on-tap conversion resolves the new
 * `force-discard-target-item` effect through the ordinary short-event chain
 * path: the card-player names a *wounded* character bearing a discardable item
 * (`targetFilter: { "target.status": "inverted" }`), and the victim's own
 * controller then picks which item to give up via the shared
 * `discard-one-company-item` pending resolution, narrowed to that character and
 * filtered by `itemFilter` so rings are never eligible.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO, BILBO,
  GLAMDRING, STING, PRECIOUS_GOLD_RING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  buildSimpleTwoPlayerState, addCardInPlay,
  attachItemToChar, setCharStatus,
  makeMHState,
  playCreatureHazardAndResolve,
  findHandCardId, findCharInstanceId, findItemInstanceId,
  viableActions, dispatch, reduce, resolveChain,
  companyIdAt,
  HAZARD_PLAYER, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, CardStatus, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, SiteCard, MovementHazardPhaseState, DiscardItemFromCompanyAction } from '../../index.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';

const INDUR = 'tw-46' as CardDefinitionId;
const THE_SULFUR_DEEPS = 'dm-35' as CardDefinitionId;
const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId;

/**
 * Two-company M/H setup with Indûr in the hazard player's hand. The resource
 * player's Aragorn is wounded and bears Glamdring plus a Precious Gold Ring;
 * Legolas is unwounded and bears Sting.
 */
const setup = () => {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO, BILBO] }], hand: [INDUR], siteDeck: [RIVENDELL] },
    ],
  });
  let state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, GLAMDRING);
  state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
  state = attachItemToChar(state, RESOURCE_PLAYER, LEGOLAS, STING);
  return setCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
};

/** Put Indûr into play as a permanent-event; returns the post-chain state. */
const playAsPermanentEvent = (state: ReturnType<typeof setup>) => {
  const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
  const indurId = findHandCardId(ready, HAZARD_PLAYER, INDUR);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER, 0);
  const afterPlay = resolveChain(dispatch(ready, {
    type: 'play-hazard', player: PLAYER_2, cardInstanceId: indurId,
    targetCompanyId: companyId, altEventMode: 'permanent-event',
  }));
  return { afterPlay, indurId };
};

/** Play Indûr as a permanent-event and tap it, naming `victimId`. */
const playAndTap = (state: ReturnType<typeof setup>, victimId: CardInstanceId) => {
  const { afterPlay, indurId } = playAsPermanentEvent(state);
  const playedCount = (afterPlay.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
  const tap = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
    .find(a => (a.action as { targetCharacterId?: string }).targetCharacterId === (victimId as unknown as string));
  expect(tap).toBeDefined();
  return { afterTap: resolveChain(dispatch(afterPlay, tap!.action)), indurId, playedCount };
};

describe('Indûr Dawndeath (tw-46)', () => {
  beforeEach(() => resetMint());

  // ─── Creature-mode keying ───────────────────────────────────────────────────

  test('playable as a creature keyed to a Dark-hold in a Dark-domain path', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    }) };
    const indurId = findHandCardId(ready, HAZARD_PLAYER, INDUR);
    const plays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === indurId);
    expect(plays.length).toBeGreaterThan(0);
  });

  test('playable as a creature keyed to a named region (Khand) and at its sites', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Khand'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    }) };
    const indurId = findHandCardId(ready, HAZARD_PLAYER, INDUR);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === indurId
        && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(creaturePlays.length).toBeGreaterThan(0);
  });

  test('NOT playable as a keyed creature on a neutral path (no Dark-domain, no named region)', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    }) };
    const indurId = findHandCardId(ready, HAZARD_PLAYER, INDUR);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === indurId
        && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(creaturePlays).toHaveLength(0);
  });

  // ─── Creature mode combat ───────────────────────────────────────────────────

  test('creature combat initiates with one strike at prowess 15', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Minas Morgul',
    }) };
    const indurId = findHandCardId(ready, HAZARD_PLAYER, INDUR);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER, 0);
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, indurId, companyId,
      { method: 'region-name', value: 'Gorgoroth' },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(15);
  });

  // ─── Permanent-event mode ───────────────────────────────────────────────────

  test('offered as a permanent-event and enters play untapped (no combat)', () => {
    const state = setup();
    const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);

    const { afterPlay, indurId } = playAsPermanentEvent(state);
    expect(afterPlay.combat).toBeNull();
    const inPlay = afterPlay.players[1].cardsInPlay.find(c => c.instanceId === indurId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);
  });

  // ─── On tap: who may be named as the victim ─────────────────────────────────

  test('only a WOUNDED opponent character bearing a discardable item is offered as the victim', () => {
    const { afterPlay } = playAsPermanentEvent(setup());
    const aragorn = findCharInstanceId(afterPlay, RESOURCE_PLAYER, ARAGORN);
    const legolas = findCharInstanceId(afterPlay, RESOURCE_PLAYER, LEGOLAS);

    const targets = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
      .map(a => (a.action as { targetCharacterId?: string }).targetCharacterId);
    // Aragorn is wounded and bears Glamdring → a legal victim.
    expect(targets).toContain(aragorn as unknown as string);
    // Legolas bears Sting but is untapped (not wounded) → never offered.
    expect(targets).not.toContain(legolas as unknown as string);
  });

  test('a wounded character bearing ONLY a ring is not a legal victim (nor is an item-less one)', () => {
    // Aragorn: wounded, ring only. Legolas: wounded, no items at all.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO, BILBO] }], hand: [INDUR], siteDeck: [RIVENDELL] },
      ],
    });
    let state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    state = setCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    state = setCharStatus(state, RESOURCE_PLAYER, LEGOLAS, CardStatus.Inverted);

    const { afterPlay, indurId } = playAsPermanentEvent(state);
    // No viable tap at all — every candidate fails the "but not a ring" filter
    // or bears nothing; the tap is surfaced as explicitly not viable.
    expect(viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);
    const blocked = computeLegalActions(afterPlay, PLAYER_2)
      .find(a => a.action.type === 'tap-alt-permanent-event'
        && (a.action as { cardInstanceId?: string }).cardInstanceId === (indurId as unknown as string));
    expect(blocked).toBeDefined();
    expect(blocked!.viable).toBe(false);
    expect(blocked!.reason).toContain('discardable item');
  });

  test('the hazard player may not name their OWN wounded character (CoE 2.1.2)', () => {
    let state = setup();
    // Give the hazard player a wounded, item-bearing character of their own.
    state = attachItemToChar(state, HAZARD_PLAYER, FRODO, GLAMDRING);
    state = setCharStatus(state, HAZARD_PLAYER, FRODO, CardStatus.Inverted);

    const { afterPlay, indurId } = playAsPermanentEvent(state);
    const frodo = findCharInstanceId(afterPlay, HAZARD_PLAYER, FRODO);
    const targets = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
      .map(a => (a.action as { targetCharacterId?: string }).targetCharacterId);
    expect(targets).not.toContain(frodo as unknown as string);

    // Forging the self-target is rejected by the reducer; nothing moves.
    const forged = reduce(afterPlay, {
      type: 'tap-alt-permanent-event', player: PLAYER_2, cardInstanceId: indurId, targetCharacterId: frodo,
    });
    expect(forged.error).toBeDefined();
    expect(forged.state.players[1].cardsInPlay.some(c => c.instanceId === indurId)).toBe(true);
  });

  // ─── On tap: the forced discard ─────────────────────────────────────────────

  test('tapping counts against the hazard limit, discards Indûr, and queues the victim\'s item choice', () => {
    const state = setup();
    const aragorn = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap, indurId, playedCount } = playAndTap(state, aragorn);

    // Indûr is spent and the tap consumed one MORE hazard-limit slot on top of
    // the permanent-event play itself.
    expect(afterTap.players[1].cardsInPlay.some(c => c.instanceId === indurId)).toBe(false);
    expect(afterTap.players[1].discardPile.some(c => c.instanceId === indurId)).toBe(true);
    expect((afterTap.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(playedCount + 1);

    // The choice belongs to the victim's controller, not the card-player.
    const pending = afterTap.pendingResolutions.filter(r => r.kind.type === 'discard-one-company-item');
    expect(pending).toHaveLength(1);
    expect(pending[0].actor).toBe(PLAYER_1);
    expect(viableActions(afterTap, PLAYER_2, 'discard-item-from-company')).toHaveLength(0);
  });

  test('the victim chooses among his own NON-ring items only', () => {
    const state = setup();
    const aragorn = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap } = playAndTap(state, aragorn);

    const glamdring = findItemInstanceId(afterTap, RESOURCE_PLAYER, GLAMDRING);
    const ring = findItemInstanceId(afterTap, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
    const sting = findItemInstanceId(afterTap, RESOURCE_PLAYER, STING);

    const offered = viableActions(afterTap, PLAYER_1, 'discard-item-from-company')
      .map(a => (a.action as DiscardItemFromCompanyAction).itemInstanceId);
    // Only Aragorn's Glamdring: the ring is excluded by "but not a ring", and
    // Legolas's Sting belongs to a character who was not the named victim.
    expect(offered).toEqual([glamdring]);
    expect(offered).not.toContain(ring);
    expect(offered).not.toContain(sting);
  });

  test('resolving the choice moves the chosen item to its owner\'s discard pile', () => {
    const state = setup();
    const aragorn = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap } = playAndTap(state, aragorn);
    const glamdring = findItemInstanceId(afterTap, RESOURCE_PLAYER, GLAMDRING);

    const choose = viableActions(afterTap, PLAYER_1, 'discard-item-from-company')[0];
    const done = dispatch(afterTap, choose.action);

    expect(done.players[0].characters[aragorn].items.some(i => i.instanceId === glamdring)).toBe(false);
    expect(done.players[0].discardPile.some(c => c.instanceId === glamdring)).toBe(true);
    // The ring survives, and the resolution has drained.
    expect(done.players[0].characters[aragorn].items.some(i => i.definitionId === PRECIOUS_GOLD_RING)).toBe(true);
    expect(done.pendingResolutions.filter(r => r.kind.type === 'discard-one-company-item')).toHaveLength(0);
  });

  test('a forged attempt to give up the ring instead is rejected', () => {
    const state = setup();
    const aragorn = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap } = playAndTap(state, aragorn);
    const ring = findItemInstanceId(afterTap, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);

    const forged = reduce(afterTap, {
      type: 'discard-item-from-company', player: PLAYER_1, itemInstanceId: ring,
    });
    expect(forged.error).toBeDefined();
    expect(forged.state.players[0].characters[aragorn].items.some(i => i.instanceId === ring)).toBe(true);
  });

  test('a forged attempt to give up a NON-victim character\'s item is rejected', () => {
    const state = setup();
    const aragorn = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap } = playAndTap(state, aragorn);
    const sting = findItemInstanceId(afterTap, RESOURCE_PLAYER, STING);

    const forged = reduce(afterTap, {
      type: 'discard-item-from-company', player: PLAYER_1, itemInstanceId: sting,
    });
    expect(forged.error).toBeDefined();
    const legolas = findCharInstanceId(afterTap, RESOURCE_PLAYER, LEGOLAS);
    expect(forged.state.players[0].characters[legolas].items.some(i => i.instanceId === sting)).toBe(true);
  });

  // ─── Cross-card: dm-36's "any Nazgûl permanent-event" auto-attack ───────────

  test('in play as a permanent-event, Indûr adds a Nazgûl auto-attack at The Under-courts (dm-36)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, INDUR);
    const site = state.cardPool[THE_UNDER_COURTS] as SiteCard;
    const attacks = getActiveAutoAttacks(state, site);
    // Printed Trolls (3/10) + the Indûr permanent-event Nazgûl attack (1 strike, 15/10).
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Nazgûl', strikes: 1, prowess: 15, body: 10 });
  });

  test('Indûr does NOT augment The Sulfur-deeps (dm-35), whose rule names only Khamûl and Adûnaphel', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, INDUR);
    const site = state.cardPool[THE_SULFUR_DEEPS] as SiteCard;
    const attacks = getActiveAutoAttacks(state, site);
    expect(attacks.every(a => a.creatureType !== 'Nazgûl')).toBe(true);
  });
});
