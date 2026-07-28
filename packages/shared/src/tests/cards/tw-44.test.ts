/**
 * @module tw-44.test
 *
 * Card test: Hoarmûrath of Dír (tw-44)
 * Type: hazard-creature (dual creature / permanent-event)
 * Race: Nazgûl. One strike at prowess 15, body 9, 5 kill MP.
 *
 * Card text:
 *   "Unique. Nazgûl (6th). May be played as a hazard creature (with one
 *    strike) or as a permanent-event.
 *    As a creature, may also be played keyed to Dagorlad, Ithilien,
 *    Gorgoroth, and Khand; and may also be played at sites in these regions.
 *    If played as a permanent-event, it will remain in play until tapped
 *    during the opponent's movement/hazard phase (tapping counts against the
 *    hazard limit). When tapped, Hoarmûrath of Dír becomes a short-event and
 *    gives +1 strike to any one attack."
 *
 * Keying (canonical `playable` = {d}{D}):
 *   - Base: a Dark-domain region {d} in the site path and a Dark-hold {D}
 *     destination.
 *   - Alt: named regions Dagorlad, Ithilien, Gorgoroth, Khand — a single
 *     `regionNames` keyedTo entry, which also covers "played at sites in these
 *     regions" (the destination region name is part of the resolved path;
 *     tw-107/tw-83 precedent).
 *
 * Engine support:
 * | # | Feature                                        | Status      | Notes                                            |
 * |---|------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | One strike, prowess 15, body 9                 | IMPLEMENTED | structural data                                  |
 * | 2 | Keying: base {d}{D}                            | IMPLEMENTED | regionTypes/siteTypes in keyedTo                 |
 * | 3 | Keying: named Dagorlad/Ithilien/Gorgoroth/Khand| IMPLEMENTED | regionNames in keyedTo                           |
 * | 4 | Permanent-event play mode (dual creature/PE)   | IMPLEMENTED | creature-alt-event (mode permanent-event)        |
 * | 5 | Stays in play until tapped in opponent's M/H   | IMPLEMENTED | modify-attack fromAltPermanentEvent (M/H gated)  |
 * | 6 | Tapping counts against the hazard limit        | IMPLEMENTED | one slot charged in handleModifyAttack           |
 * | 7 | On tap → short-event, +1 strike to one attack  | IMPLEMENTED | strikesModifier: 1 on the live attack            |
 * | 8 | Counts as half a creature for deck building    | IMPLEMENTED | play-flag: playable-as-event (deck-validation)   |
 * | 9 | dm-36 "any Nazgûl permanent-event" auto-attack | IMPLEMENTED | permanent-event-auto-attack (tw-83 precedent)    |
 *
 * Cross-card interaction (from the site side): The Under-courts (dm-36) reads
 * "If any Nazgûl permanent-event is in play, one must be used as an additional
 * automatic-attack (attacker's choice, discard after use — ignore result of
 * defeat)" — modeled per-Nazgûl via `permanent-event-auto-attack` (siteIds
 * [dm-36], Nazgûl 1 strike 15/9, discardAfterUse). The Sulfur-deeps (dm-35)
 * names only Khamûl and Adûnaphel, so Hoarmûrath carries no dm-35 entry.
 *
 * Playable: YES. Both play modes ride the generic dual-mode primitive
 * (tw-107/tw-83 precedent). The on-tap conversion is the new
 * `modify-attack` / `fromAltPermanentEvent` source: because the short-event
 * "gives +1 strike to any one attack", the tap is offered in the combat
 * pre-assignment window (where an attack exists to name) rather than the
 * play-hazards step, and applying it removes the card from play, discards it,
 * charges one hazard-limit slot, and raises the live attack's strike count.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  buildSimpleTwoPlayerState, addCardInPlay,
  makeMHState,
  playCreatureHazardAndResolve,
  findHandCardId,
  viableActions, dispatch, resolveChain,
  companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, CardStatus, computeLegalActions, reduce } from '../../index.js';
import type { CardDefinitionId, GameState, SiteCard, MovementHazardPhaseState } from '../../index.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';

const HOARMURATH = 'tw-44' as CardDefinitionId;
/** Orc-patrol — 3 strikes at prowess 6, keyed {w}/{s}/{d}, no special effects. */
const ORC_PATROL = 'tw-074' as CardDefinitionId;
const THE_SULFUR_DEEPS = 'dm-35' as CardDefinitionId;
const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId;

/** Two-company M/H setup: Hoarmûrath + an ordinary Orc attack in hazard hand. */
const setup = () =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [HOARMURATH, ORC_PATROL], siteDeck: [RIVENDELL] },
    ],
  });

/** A dark path ending in a Dark-hold, which also keys the Orc-patrol. */
const darkPath = (overrides: Partial<MovementHazardPhaseState> = {}) => makeMHState({
  resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow, RegionType.Dark],
  resolvedSitePathNames: ['Gorgoroth'],
  destinationSiteType: SiteType.DarkHold,
  destinationSiteName: 'Barad-dûr',
  ...overrides,
});

/**
 * Play Hoarmûrath as a permanent-event, then launch an ordinary Orc-patrol
 * attack so a live attack exists for the on-tap short-event to modify.
 */
const playPermanentEventThenAttack = (state: GameState, hazardLimit = 4) => {
  const ready = { ...state, phaseState: darkPath({ hazardLimitAtReveal: hazardLimit }) };
  const hoarId = findHandCardId(ready, HAZARD_PLAYER, HOARMURATH);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER);
  const afterPlay = resolveChain(dispatch(ready, {
    type: 'play-hazard', player: PLAYER_2, cardInstanceId: hoarId,
    targetCompanyId: companyId, altEventMode: 'permanent-event',
  }));

  const orcId = findHandCardId(afterPlay, HAZARD_PLAYER, ORC_PATROL);
  const orcPlay = viableActions(afterPlay, PLAYER_2, 'play-hazard')
    .find(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === orcId && !!a.action.keyedBy);
  expect(orcPlay).toBeDefined();
  const inCombat = resolveChain(dispatch(afterPlay, orcPlay!.action));
  expect(inCombat.combat).not.toBeNull();
  return { afterPlay, inCombat, hoarId };
};

describe('Hoarmûrath of Dír (tw-44)', () => {
  beforeEach(() => resetMint());

  // ─── Creature-mode keying ───────────────────────────────────────────────────

  test('playable as a creature keyed to a Dark-hold in a Dark-domain path', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Nurn'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    }) };
    const hoarId = findHandCardId(ready, HAZARD_PLAYER, HOARMURATH);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === hoarId && !!a.action.keyedBy);
    expect(creaturePlays.length).toBeGreaterThan(0);
  });

  test('playable as a creature keyed to a named region (Ithilien) and at its sites', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Ithilien'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    }) };
    const hoarId = findHandCardId(ready, HAZARD_PLAYER, HOARMURATH);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === hoarId && !!a.action.keyedBy);
    expect(creaturePlays.length).toBeGreaterThan(0);
  });

  test('NOT playable as a keyed creature on a neutral path (no Dark-domain, no named region)', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    }) };
    const hoarId = findHandCardId(ready, HAZARD_PLAYER, HOARMURATH);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === hoarId && !!a.action.keyedBy);
    expect(creaturePlays).toHaveLength(0);
  });

  test('creature combat initiates with one strike at prowess 15', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Khand'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Minas Morgul',
    }) };
    const hoarId = findHandCardId(ready, HAZARD_PLAYER, HOARMURATH);
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, hoarId, companyIdAt(ready, RESOURCE_PLAYER),
      { method: 'region-name', value: 'Khand' },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(15);
  });

  // ─── Permanent-event mode ────────────────────────────────────────────────────

  test('offered as a permanent-event and enters play untapped (no combat)', () => {
    const ready = { ...setup(), phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const hoarId = findHandCardId(ready, HAZARD_PLAYER, HOARMURATH);

    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);

    const afterChain = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: hoarId,
      targetCompanyId: companyIdAt(ready, RESOURCE_PLAYER), altEventMode: 'permanent-event',
    }));
    expect(afterChain.combat).toBeNull();
    const inPlay = afterChain.players[1].cardsInPlay.find(c => c.instanceId === hoarId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);
  });

  // ─── On-tap conversion: +1 strike to one attack ─────────────────────────────

  test('the tap is NOT offered outside an attack — it needs an attack to modify', () => {
    const { afterPlay } = playPermanentEventThenAttack(setup());
    // Between hazards (play-hazards step, no combat) there is no attack for
    // "+1 strike to any one attack" to name, so no conversion is offered.
    expect(viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);
    expect(viableActions(afterPlay, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('tapping during an attack gives it +1 strike, spends the card, and costs a hazard slot', () => {
    const { inCombat, hoarId } = playPermanentEventThenAttack(setup());
    const strikesBefore = inCombat.combat!.strikesTotal;
    const prowessBefore = inCombat.combat!.strikeProwess;
    const hazardsBefore = (inCombat.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    expect(strikesBefore).toBe(3); // Orc-patrol's printed strikes

    const taps = viableActions(inCombat, PLAYER_2, 'modify-attack')
      .filter(a => a.action.type === 'modify-attack' && a.action.cardInstanceId === hoarId);
    expect(taps).toHaveLength(1);
    const afterTap = dispatch(inCombat, taps[0].action);

    // +1 strike to this attack; nothing else about the attack changes.
    expect(afterTap.combat!.strikesTotal).toBe(strikesBefore + 1);
    expect(afterTap.combat!.strikeProwess).toBe(prowessBefore);

    // "Becomes a short-event": leaves play and is discarded.
    expect(afterTap.players[1].cardsInPlay.some(c => c.instanceId === hoarId)).toBe(false);
    expect(afterTap.players[1].discardPile.some(c => c.instanceId === hoarId)).toBe(true);

    // Tapping counts against the hazard limit.
    expect((afterTap.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(hazardsBefore + 1);

    // Spent — it cannot be tapped a second time on the same attack.
    expect(viableActions(afterTap, PLAYER_2, 'modify-attack')
      .filter(a => a.action.type === 'modify-attack' && a.action.cardInstanceId === hoarId)).toHaveLength(0);
  });

  test('only the hazard (attacking) player may tap it; the defender cannot', () => {
    const { inCombat, hoarId } = playPermanentEventThenAttack(setup());
    expect(computeLegalActions(inCombat, PLAYER_1)
      .filter(a => a.action.type === 'modify-attack' && a.action.cardInstanceId === hoarId)).toHaveLength(0);
    // And the reducer refuses the play even if the defender asks for it directly.
    const attempt = reduce(inCombat, { type: 'modify-attack', player: PLAYER_1, cardInstanceId: hoarId });
    expect(attempt.error).toBeDefined();
    expect(attempt.state.combat!.strikesTotal).toBe(inCombat.combat!.strikesTotal);
  });

  test('the tap is offered but not viable once the hazard limit is reached', () => {
    // Limit 2: the permanent-event play and the Orc-patrol play fill it, so the
    // conversion has no slot left.
    const { inCombat, hoarId } = playPermanentEventThenAttack(setup(), 2);
    const mh = inCombat.phaseState as MovementHazardPhaseState;
    expect(mh.hazardsPlayedThisCompany).toBe(2);

    const entries = computeLegalActions(inCombat, PLAYER_2)
      .filter(a => a.action.type === 'modify-attack' && a.action.cardInstanceId === hoarId);
    expect(entries).toHaveLength(1);
    expect(entries[0].viable).toBe(false);

    // The reducer rejects it too, leaving the attack untouched.
    const attempt = reduce(inCombat, { type: 'modify-attack', player: PLAYER_2, cardInstanceId: hoarId });
    expect(attempt.error).toBeDefined();
    expect(attempt.state.combat!.strikesTotal).toBe(inCombat.combat!.strikesTotal);
  });

  // ─── Cross-card: dm-36's "any Nazgûl permanent-event" auto-attack ──────────

  test('in play as a permanent-event, Hoarmûrath adds a Nazgûl auto-attack at The Under-courts (dm-36)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, HOARMURATH);
    const attacks = getActiveAutoAttacks(state, state.cardPool[THE_UNDER_COURTS] as SiteCard);
    // Printed Trolls (3/10) + the Hoarmûrath permanent-event Nazgûl attack.
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Nazgûl', strikes: 1, prowess: 15, body: 9 });
  });

  test('Hoarmûrath does NOT augment The Sulfur-deeps (dm-35), whose rule names only Khamûl and Adûnaphel', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, HOARMURATH);
    const attacks = getActiveAutoAttacks(state, state.cardPool[THE_SULFUR_DEEPS] as SiteCard);
    expect(attacks.every(a => a.creatureType !== 'Nazgûl')).toBe(true);
  });
});
