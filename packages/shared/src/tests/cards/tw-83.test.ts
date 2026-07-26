/**
 * @module tw-83.test
 *
 * Card test: Ren the Unclean (tw-83)
 * Type: hazard-creature (dual creature / permanent-event)
 * Race: Nazgûl. One strike at prowess 15, body 10, 5 kill MP.
 *
 * Card text:
 *   "Unique. Nazgûl (8th). May be played as a hazard creature (with one
 *    strike) or as a permanent-event.
 *    As a creature, may also be played keyed to Dagorlad, Ithilien,
 *    Gorgoroth, and Horse Plains; and may also be played at sites in these
 *    regions.
 *    If played as a permanent-event, it will remain in play until tapped
 *    during the opponent's movement/hazard phase (tapping counts against the
 *    hazard limit). When tapped, Ren the Unclean becomes a short-event: each
 *    character in play must make a corruption check.
 *    If you tap Ren the Unclean, then you cannot play resources to aid your
 *    character's corruption checks. Your characters may tap in support. The
 *    moving player makes corruption checks first. Each player decides the
 *    order of the corruption checks for their characters."
 *
 * Keying (canonical `playable` = {d}{D}):
 *   - Base: a Dark-domain region {d} in the site path and a Dark-hold {D}
 *     destination.
 *   - Alt: named regions Dagorlad, Ithilien, Gorgoroth, Horse Plains — a
 *     single `regionNames` keyedTo entry, which also covers "played at sites
 *     in these regions" (the destination region name is part of the resolved
 *     path; tw-107 precedent).
 *
 * Engine support:
 * | # | Feature                                        | Status      | Notes                                          |
 * |---|------------------------------------------------|-------------|------------------------------------------------|
 * | 1 | One strike, prowess 15, body 10                | IMPLEMENTED | structural data                                |
 * | 2 | Keying: base {d}{D}                            | IMPLEMENTED | regionTypes/siteTypes in keyedTo               |
 * | 3 | Keying: named Dagorlad/Ithilien/…              | IMPLEMENTED | regionNames in keyedTo                         |
 * | 4 | Permanent-event play mode (dual creature/PE)   | IMPLEMENTED | creature-alt-event (mode permanent-event)      |
 * | 5 | Tapped by opponent in their M/H (vs haz limit) | IMPLEMENTED | tap-alt-permanent-event (counts vs haz limit)  |
 * | 6 | On tap → each character in play checks         | IMPLEMENTED | force-check-all-in-play (corruption)           |
 * | 7 | Moving player checks first                     | IMPLEMENTED | blockedBy gating in topResolutionFor           |
 * | 8 | Each player orders their own checks            | IMPLEMENTED | selectableOrder on the pending entries         |
 * | 9 | Tapper cannot play resources to aid checks     | IMPLEMENTED | noResourceAid suppresses reactive plays        |
 * |10 | Tapper's characters may tap in support (+1)    | IMPLEMENTED | allowSupport → support-corruption-check        |
 * |11 | dm-36 "any Nazgûl permanent-event" auto-attack | IMPLEMENTED | permanent-event-auto-attack (tw-2 precedent)   |
 *
 * Cross-card interaction (from the site side): The Under-courts (dm-36)
 * reads "If any Nazgûl permanent-event is in play, one must be used as an
 * additional automatic-attack (attacker's choice, discard after use —
 * ignore result of defeat)" — modeled per-Nazgûl via
 * `permanent-event-auto-attack` (siteIds [dm-36], Nazgûl 1 strike 15/10,
 * discardAfterUse), the tw-2/tw-47 precedent. The Sulfur-deeps (dm-35)
 * names only Khamûl and Adûnaphel, so Ren carries no dm-35 entry.
 *
 * Playable: YES. Both play modes ride the generic dual-mode primitive
 * (tw-107/tw-2 precedent); the on-tap conversion resolves the new
 * `force-check-all-in-play` effect through the ordinary short-event chain
 * path, enqueuing one corruption-check pending resolution per character in
 * play with the printed sequencing (moving player first via `blockedBy`,
 * player-chosen order via `selectableOrder`, tap-in-support via
 * `allowSupport`, and the tapper's no-resource-aid restriction via
 * `noResourceAid`).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO, BILBO, HALFLING_STRENGTH,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  buildSimpleTwoPlayerState, addCardInPlay,
  makeMHState,
  playCreatureHazardAndResolve,
  findHandCardId, findCharInstanceId,
  viableActions, dispatch, resolveChain,
  companyIdAt,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId, CorruptionCheckAction, SiteCard, SupportCorruptionCheckAction, MovementHazardPhaseState } from '../../index.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';

const REN = 'tw-83' as CardDefinitionId;
const THE_SULFUR_DEEPS = 'dm-35' as CardDefinitionId;
const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId;

/** Two-company M/H setup with Ren the Unclean in the hazard player's hand. */
const setup = () =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO, BILBO] }], hand: [REN, HALFLING_STRENGTH], siteDeck: [RIVENDELL] },
    ],
  });

/** Play Ren as a permanent-event and tap it → returns the post-chain state. */
const playAndTapRen = (state: ReturnType<typeof setup>) => {
  const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
  const renId = findHandCardId(ready, HAZARD_PLAYER, REN);
  const companyId = companyIdAt(ready, 0, 0);
  const afterPlay = resolveChain(dispatch(ready, {
    type: 'play-hazard', player: PLAYER_2, cardInstanceId: renId,
    targetCompanyId: companyId, altEventMode: 'permanent-event',
  }));
  const playedCount = (afterPlay.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
  const tapActions = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event');
  expect(tapActions.length).toBeGreaterThan(0);
  return { afterTap: resolveChain(dispatch(afterPlay, tapActions[0].action)), renId, playedCount };
};

describe('Ren the Unclean (tw-83)', () => {
  beforeEach(() => resetMint());

  // ─── Creature-mode keying ───────────────────────────────────────────────────

  test('playable as a creature keyed to a Dark-hold in a Dark-domain path', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    });
    const ready = { ...state, phaseState: mhState };
    const renId = findHandCardId(ready, HAZARD_PLAYER, REN);
    const plays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === renId && a.viable);
    expect(plays.length).toBeGreaterThan(0);
  });

  test('playable as a creature keyed to a named region (Dagorlad) and at its sites', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Dagorlad'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const renId = findHandCardId(ready, HAZARD_PLAYER, REN);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === renId && a.viable
        && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(creaturePlays.length).toBeGreaterThan(0);
  });

  test('NOT playable as a keyed creature on a neutral path (no Dark-domain, no named region)', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const renId = findHandCardId(ready, HAZARD_PLAYER, REN);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === renId && a.viable
        && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(creaturePlays).toHaveLength(0);
  });

  // ─── Combat initiates (creature mode) ────────────────────────────────────────

  test('creature combat initiates with one strike at prowess 15', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Minas Morgul',
    });
    const ready = { ...state, phaseState: mhState };
    const renId = findHandCardId(ready, HAZARD_PLAYER, REN);
    const companyId = companyIdAt(ready, 0, 0);
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, renId, companyId,
      { method: 'region-name', value: 'Gorgoroth' },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(15);
  });

  // ─── Permanent-event mode ────────────────────────────────────────────────────

  test('offered as a permanent-event and enters play untapped (no combat)', () => {
    const state = setup();
    const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const renId = findHandCardId(ready, HAZARD_PLAYER, REN);
    const companyId = companyIdAt(ready, 0, 0);

    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);

    const afterChain = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: renId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    expect(afterChain.combat).toBeNull();
    const inPlay = afterChain.players[1].cardsInPlay.find(c => c.instanceId === renId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);
  });

  test('tapping counts against the hazard limit, discards Ren, and queues a corruption check for every character in play', () => {
    const state = setup();
    const { afterTap, renId, playedCount } = playAndTapRen(state);

    // Ren is spent (discarded) and the tap consumed one MORE hazard-limit
    // slot on top of the permanent-event play itself.
    expect(afterTap.players[1].cardsInPlay.some(c => c.instanceId === renId)).toBe(false);
    expect(afterTap.players[1].discardPile.some(c => c.instanceId === renId)).toBe(true);
    expect((afterTap.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(playedCount + 1);

    // One corruption check per character in play — both players'.
    const checks = afterTap.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(checks).toHaveLength(4);
    const byActor = new Map<string, number>();
    for (const c of checks) byActor.set(c.actor as string, (byActor.get(c.actor as string) ?? 0) + 1);
    expect(byActor.get(PLAYER_1 as string)).toBe(2);
    expect(byActor.get(PLAYER_2 as string)).toBe(2);

    // The moving player's (PLAYER_1) checks are unblocked; the tapper's
    // (PLAYER_2) checks wait on every moving-player check ID.
    const movingIds = checks.filter(c => c.actor === PLAYER_1).map(c => c.id);
    for (const c of checks.filter(c => c.actor === PLAYER_2)) {
      expect(c.blockedBy).toBeDefined();
      expect([...c.blockedBy!].sort()).toEqual([...movingIds].sort());
    }
  });

  test('moving player checks first, in an order of their choice; tapper waits, then orders their own checks', () => {
    const state = setup();
    const { afterTap } = playAndTapRen(state);
    const aragorn = findCharInstanceId(afterTap, 0, ARAGORN);
    const legolas = findCharInstanceId(afterTap, 0, LEGOLAS);
    const frodo = findCharInstanceId(afterTap, 1, FRODO);
    const bilbo = findCharInstanceId(afterTap, 1, BILBO);

    // Moving player: BOTH characters' roll actions offered at once (order is
    // the player's choice). Tapper: nothing yet — their checks are blocked.
    const movingRolls = viableActions(afterTap, PLAYER_1, 'corruption-check')
      .map(a => (a.action as CorruptionCheckAction).characterId);
    expect([...movingRolls].sort()).toEqual([aragorn, legolas].sort());
    expect(viableActions(afterTap, PLAYER_2, 'corruption-check')).toHaveLength(0);

    // The moving player resolves LEGOLAS first — not the head entry — proving
    // the order really is theirs to pick. (CP 0 → any 2d6 roll passes.)
    const legolasRoll = viableActions(afterTap, PLAYER_1, 'corruption-check')
      .find(a => (a.action as CorruptionCheckAction).characterId === legolas)!;
    const afterLegolas = dispatch(afterTap, legolasRoll.action);
    expect(afterLegolas.players[0].characters[legolas]).toBeDefined();

    // Tapper still waits (one moving-player check left).
    expect(viableActions(afterLegolas, PLAYER_2, 'corruption-check')).toHaveLength(0);

    const aragornRoll = viableActions(afterLegolas, PLAYER_1, 'corruption-check')
      .find(a => (a.action as CorruptionCheckAction).characterId === aragorn)!;
    const afterMoving = dispatch(afterLegolas, aragornRoll.action);

    // Now the tapper's checks unblock — both their characters offered at once.
    const tapperRolls = viableActions(afterMoving, PLAYER_2, 'corruption-check')
      .map(a => (a.action as CorruptionCheckAction).characterId);
    expect([...tapperRolls].sort()).toEqual([frodo, bilbo].sort());

    // Resolve both (either order); the queue drains completely.
    const bilboRoll = viableActions(afterMoving, PLAYER_2, 'corruption-check')
      .find(a => (a.action as CorruptionCheckAction).characterId === bilbo)!;
    const afterBilbo = dispatch(afterMoving, bilboRoll.action);
    const frodoRoll = viableActions(afterBilbo, PLAYER_2, 'corruption-check')
      .find(a => (a.action as CorruptionCheckAction).characterId === frodo)!;
    const done = dispatch(afterBilbo, frodoRoll.action);
    expect(done.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  test('tapper\'s characters may tap in support (+1); moving player gets no support actions', () => {
    const state = setup();
    const { afterTap } = playAndTapRen(state);
    const frodo = findCharInstanceId(afterTap, 1, FRODO);
    const bilbo = findCharInstanceId(afterTap, 1, BILBO);

    // No tap-in-support for the moving player (only "your characters" — the
    // tapper's — may tap in support).
    expect(viableActions(afterTap, PLAYER_1, 'support-corruption-check')).toHaveLength(0);

    // Drain the moving player's two checks.
    let current = afterTap;
    for (let i = 0; i < 2; i++) {
      current = dispatch(current, viableActions(current, PLAYER_1, 'corruption-check')[0].action);
    }

    // Tapper's window: each untapped hobbit may support the other's check.
    const supports = viableActions(current, PLAYER_2, 'support-corruption-check')
      .map(a => a.action as SupportCorruptionCheckAction);
    expect(supports).toHaveLength(2);

    // Baseline: Frodo's printed +4 corruption check-modifier, no support yet.
    const frodoBase = (viableActions(current, PLAYER_2, 'corruption-check')
      .find(a => (a.action as CorruptionCheckAction).characterId === frodo)!
      .action as CorruptionCheckAction).corruptionModifier;

    // Bilbo taps in support of Frodo's check.
    const bilboSupports = supports.find(a => a.supportingCharacterId === bilbo && a.targetCharacterId === frodo)!;
    expect(bilboSupports).toBeDefined();
    const afterSupport = dispatch(current, bilboSupports);
    expect(afterSupport.players[1].characters[bilbo].status).toBe(CardStatus.Tapped);

    // Frodo's roll action now carries the +1 support on top of his printed
    // modifier; Bilbo (tapped) can no longer support.
    const frodoRoll = viableActions(afterSupport, PLAYER_2, 'corruption-check')
      .find(a => (a.action as CorruptionCheckAction).characterId === frodo)!;
    expect((frodoRoll.action as CorruptionCheckAction).corruptionModifier).toBe(frodoBase + 1);
    expect(viableActions(afterSupport, PLAYER_2, 'support-corruption-check')
      .filter(a => (a.action as SupportCorruptionCheckAction).supportingCharacterId === bilbo)).toHaveLength(0);

    // The +1 one-shot constraint is consumed by Frodo's roll and never leaks
    // into Bilbo's own check (back to his printed modifier alone).
    const afterFrodo = dispatch(afterSupport, frodoRoll.action);
    const bilboRoll = viableActions(afterFrodo, PLAYER_2, 'corruption-check')
      .find(a => (a.action as CorruptionCheckAction).characterId === bilbo)!;
    expect((bilboRoll.action as CorruptionCheckAction).corruptionModifier).toBe(frodoBase);
  });

  // ─── Cross-card: dm-36's "any Nazgûl permanent-event" auto-attack ──────────

  test('in play as a permanent-event, Ren adds a Nazgûl auto-attack at The Under-courts (dm-36)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, REN);
    const site = state.cardPool[THE_UNDER_COURTS] as SiteCard;
    const attacks = getActiveAutoAttacks(state, site);
    // Printed Trolls (3/10) + the Ren permanent-event Nazgûl attack (1 strike, 15/10).
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Nazgûl', strikes: 1, prowess: 15, body: 10 });
  });

  test('Ren does NOT augment The Sulfur-deeps (dm-35), whose rule names only Khamûl and Adûnaphel', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, REN);
    const site = state.cardPool[THE_SULFUR_DEEPS] as SiteCard;
    const attacks = getActiveAutoAttacks(state, site);
    expect(attacks.every(a => a.creatureType !== 'Nazgûl')).toBe(true);
  });

  test('tapper cannot play resources to aid their checks; the moving player still can', () => {
    // Give the MOVING player a hobbit and a Halfling Strength: their
    // Ren-sourced check still allows the reactive resource play. The tapper —
    // who also holds a Halfling Strength for their own hobbits — gets none.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [BILBO] }], hand: [HALFLING_STRENGTH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [REN, HALFLING_STRENGTH], siteDeck: [RIVENDELL] },
      ],
    });
    const { afterTap } = playAndTapRen(state);

    // Moving player's check on Bilbo: Halfling Strength's corruption-check
    // boost is offered — Ren does not restrict the moving player.
    expect(viableActions(afterTap, PLAYER_1, 'play-short-event').length).toBeGreaterThan(0);
    const afterMoving = dispatch(afterTap, viableActions(afterTap, PLAYER_1, 'corruption-check')[0].action);

    // Tapper's check on Frodo: no resource plays offered, only the roll (and
    // no support — Frodo is alone in his company).
    expect(viableActions(afterMoving, PLAYER_2, 'corruption-check').length).toBeGreaterThan(0);
    expect(viableActions(afterMoving, PLAYER_2, 'play-short-event')).toHaveLength(0);
  });
});
