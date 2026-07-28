/**
 * @module tw-31.test
 *
 * Card test: Dwar of Waw (tw-31)
 * Type: hazard-creature (dual creature / permanent-event)
 * Race: Nazgûl. One strike at prowess 15, body 10, 5 kill MP. Unique.
 *
 * Card text:
 *   "Unique. Nazgûl (3rd). May be played as a hazard creature (with one
 *    strike) or as a permanent-event.
 *    As a creature, may also be played keyed to Harondor, Imlad Morgul,
 *    Gorgoroth, and Ithilien; and may also be played at sites in these regions.
 *    If played as a permanent-event, it will remain in play until tapped
 *    during the opponent's movement/hazard phase (tapping counts against the
 *    hazard limit). When tapped, Dwar of Waw becomes a short-event and gives
 *    +1 prowess to all Wolf, Spider, and Animal attacks until the end of the
 *    turn."
 *
 * Keying (canonical `playable` = {d}{D}):
 *   - Base: a Dark-domain region {d} in the site path, or a Dark-hold {D}
 *     destination — the two tokens are alternatives, as for every creature.
 *   - Alt: named regions Harondor, Imlad Morgul, Gorgoroth, Ithilien — a single
 *     `regionNames` keyedTo entry, which also covers "played at sites in these
 *     regions" (the destination region name is part of the resolved path;
 *     tw-107/tw-83/tw-46 precedent).
 *
 * Card shape (data, not re-asserted below): `keywords: ["Nazgûl"]`;
 * effects `permanent-event-auto-attack` (siteIds [dm-36], Nazgûl 1×15/10,
 * `discardAfterUse`), `play-flag: playable-as-event`, `creature-alt-event`
 * mode `permanent-event`, and `attack-race-boost`
 * (races wolf/spider/animal, prowess +1, strikes +0).
 *
 * Engine support:
 * | # | Feature                                        | Status      | Notes                                            |
 * |---|------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | One strike, prowess 15, body 10                | IMPLEMENTED | structural data                                  |
 * | 2 | Keying: base {d}{D}                            | IMPLEMENTED | regionTypes/siteTypes in keyedTo                 |
 * | 3 | Keying: named Harondor/Imlad Morgul/…          | IMPLEMENTED | regionNames in keyedTo                           |
 * | 4 | Permanent-event play mode (dual creature/PE)   | IMPLEMENTED | creature-alt-event (mode permanent-event)        |
 * | 5 | Tapped by opponent in their M/H (vs haz limit) | IMPLEMENTED | tap-alt-permanent-event (counts vs haz limit)    |
 * | 6 | On tap → short-event: +1 prowess to all Wolf,  | IMPLEMENTED | attack-race-boost → turn-scoped                  |
 * |   | Spider and Animal attacks until end of turn     |             | creature-attack-boost constraint (player-target) |
 * | 7 | Counts as half a creature for deck building    | IMPLEMENTED | play-flag: playable-as-event (deck-validation)   |
 * | 8 | dm-36 "any Nazgûl permanent-event" auto-attack | IMPLEMENTED | permanent-event-auto-attack (tw-83 precedent)    |
 *
 * Cross-card interaction (from the site side): The Under-courts (dm-36) reads
 * "If any Nazgûl permanent-event is in play, one must be used as an additional
 * automatic-attack (attacker's choice, discard after use — ignore result of
 * defeat)" — modeled per-Nazgûl via `permanent-event-auto-attack`. The
 * Sulfur-deeps (dm-35) names only Khamûl and Adûnaphel, so Dwar carries no
 * dm-35 entry.
 *
 * Playable: YES. Both play modes ride the generic dual-mode primitive
 * (tw-107/tw-83 precedent). The on-tap conversion resolves the new
 * `attack-race-boost` effect through the ordinary short-event chain path: it
 * installs a turn-scoped `creature-attack-boost` constraint (the Chill Douser
 * dm-106 kind, now accepting a race *list* and a *player* target) on the
 * attacked player, so every Wolf, Spider and Animal attack against any of that
 * player's companies — hazard creatures and site automatic-attacks alike —
 * gains +1 prowess for the rest of the turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  buildSimpleTwoPlayerState, addCardInPlay,
  buildSitePhaseState, setupAutoAttackStep,
  makeMHState,
  playCreatureHazardAndResolve,
  findHandCardId,
  viableActions, dispatch, resolveChain,
  companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, CardStatus, Race } from '../../index.js';
import type { CardDefinitionId, GameState, SiteCard, MovementHazardPhaseState } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';

const DWAR = 'tw-31' as CardDefinitionId;
/** Wolves — 3 strikes at prowess 8, keyed {b}{w}, no special effects. */
const WOLVES = 'tw-114' as CardDefinitionId;
/** Giant Spiders — 2 strikes at prowess 10, keyed {w}{w}. */
const GIANT_SPIDERS = 'tw-40' as CardDefinitionId;
/** Crebain — Animals, 1 strike at prowess 5, keyed {b}{w}{s}{d}{R}{S}{D}. */
const CREBAIN = 'tw-25' as CardDefinitionId;
/** Orc-patrol — 3 strikes at prowess 6; the non-boosted control race. */
const ORC_PATROL = 'tw-074' as CardDefinitionId;
/** Weathertop — hero Ruins & Lairs whose automatic-attack is Wolves 2×6. */
const WEATHERTOP = 'tw-436' as CardDefinitionId;
const THE_SULFUR_DEEPS = 'dm-35' as CardDefinitionId;
const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId;

/** Two-company M/H setup with Dwar plus the given creatures in the hazard hand. */
const setup = (hazardHand: CardDefinitionId[] = [DWAR]) =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: hazardHand, siteDeck: [RIVENDELL] },
    ],
  });

/**
 * A path of two Wildernesses plus a Border-land ending at a Ruins & Lairs —
 * keys Wolves ({b}{w}), Giant Spiders ({w}{w}), Crebain and Orc-patrol alike,
 * so every attack in these tests is playable off the same movement.
 */
const beastPath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Border],
  resolvedSitePathNames: ['Rhudaur'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Moria',
});

/** Play Dwar as a permanent-event on the moving company. */
const playDwarAsPermanentEvent = (state: GameState) => {
  const ready = { ...state, phaseState: beastPath() };
  const dwarId = findHandCardId(ready, HAZARD_PLAYER, DWAR);
  return resolveChain(dispatch(ready, {
    type: 'play-hazard', player: PLAYER_2, cardInstanceId: dwarId,
    targetCompanyId: companyIdAt(ready, RESOURCE_PLAYER), altEventMode: 'permanent-event',
  }));
};

/** Play Dwar as a permanent-event, then tap it → the boost is live. */
const playAndTapDwar = (state: GameState) => {
  const afterPlay = playDwarAsPermanentEvent(state);
  const taps = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event');
  expect(taps).toHaveLength(1);
  return { afterPlay, afterTap: resolveChain(dispatch(afterPlay, taps[0].action)) };
};

/** Play a keyed creature from the hazard hand and return the resulting combat state. */
const attackWith = (state: GameState, creature: CardDefinitionId) => {
  const creatureId = findHandCardId(state, HAZARD_PLAYER, creature);
  const play = viableActions(state, PLAYER_2, 'play-hazard')
    .find(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === creatureId && !!a.action.keyedBy);
  expect(play).toBeDefined();
  const after = resolveChain(dispatch(state, play!.action));
  expect(after.combat).not.toBeNull();
  return after;
};

/** The constraint Dwar's on-tap short-event installs, applied to a site-phase state. */
const withDwarBoost = (state: GameState) => addConstraint(state, {
  source: 'dwar-instance-1' as never,
  sourceDefinitionId: DWAR,
  scope: { kind: 'turn' },
  target: { kind: 'player', playerId: PLAYER_1 },
  kind: {
    type: 'creature-attack-boost',
    race: [Race.Wolf, Race.Spider, Race.Animal],
    strikes: 0,
    prowess: 1,
  },
});

describe('Dwar of Waw (tw-31)', () => {
  beforeEach(() => resetMint());

  // ─── Creature-mode keying ───────────────────────────────────────────────────

  test('playable as a creature keyed to a Dark-hold in a Dark-domain path', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Nurn'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    }) };
    const dwarId = findHandCardId(ready, HAZARD_PLAYER, DWAR);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === dwarId && !!a.action.keyedBy);
    expect(creaturePlays.length).toBeGreaterThan(0);
  });

  test('the two base tokens are alternatives: a Dark-hold destination keys it with no Dark-domain in the path', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    }) };
    const dwarId = findHandCardId(ready, HAZARD_PLAYER, DWAR);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === dwarId && !!a.action.keyedBy);
    expect(creaturePlays.length).toBeGreaterThan(0);
  });

  test('playable as a creature keyed to a named region (Imlad Morgul) and at its sites', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    }) };
    const dwarId = findHandCardId(ready, HAZARD_PLAYER, DWAR);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === dwarId && !!a.action.keyedBy);
    expect(creaturePlays.length).toBeGreaterThan(0);
  });

  test('NOT playable as a keyed creature on a neutral path (no Dark-domain, no named region)', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    }) };
    const dwarId = findHandCardId(ready, HAZARD_PLAYER, DWAR);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === dwarId && !!a.action.keyedBy);
    expect(creaturePlays).toHaveLength(0);
  });

  test('creature combat initiates with one strike at prowess 15', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Minas Morgul',
    }) };
    const dwarId = findHandCardId(ready, HAZARD_PLAYER, DWAR);
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, dwarId, companyIdAt(ready, RESOURCE_PLAYER),
      { method: 'region-name', value: 'Gorgoroth' },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(15);
  });

  // ─── Permanent-event mode ───────────────────────────────────────────────────

  test('offered as a permanent-event and enters play untapped (no combat, no boost yet)', () => {
    const afterPlay = playDwarAsPermanentEvent(setup());
    const dwarId = afterPlay.players[1].cardsInPlay[0]?.instanceId;
    expect(afterPlay.combat).toBeNull();
    expect(dwarId).toBeDefined();
    expect(afterPlay.players[1].cardsInPlay[0].status).toBe(CardStatus.Untapped);
    // Merely entering play grants nothing — the boost waits for the tap.
    expect(afterPlay.activeConstraints.filter(c => c.kind.type === 'creature-attack-boost')).toHaveLength(0);
  });

  test('tapping discards Dwar, costs a hazard slot, and installs the turn-long Wolf/Spider/Animal boost', () => {
    const { afterPlay, afterTap } = playAndTapDwar(setup());
    const dwarId = afterPlay.players[1].cardsInPlay[0].instanceId;
    const playedCount = (afterPlay.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;

    // "Becomes a short-event": leaves play and is discarded.
    expect(afterTap.players[1].cardsInPlay.some(c => c.instanceId === dwarId)).toBe(false);
    expect(afterTap.players[1].discardPile.some(c => c.instanceId === dwarId)).toBe(true);
    // "Tapping counts against the hazard limit."
    expect((afterTap.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(playedCount + 1);

    // One turn-scoped boost on the attacked player, covering all three races.
    const boosts = afterTap.activeConstraints.filter(c => c.kind.type === 'creature-attack-boost');
    expect(boosts).toHaveLength(1);
    expect(boosts[0].scope).toEqual({ kind: 'turn' });
    expect(boosts[0].target).toEqual({ kind: 'player', playerId: PLAYER_1 });
    if (boosts[0].kind.type === 'creature-attack-boost') {
      expect(boosts[0].kind.race).toEqual([Race.Wolf, Race.Spider, Race.Animal]);
      expect(boosts[0].kind.prowess).toBe(1);
      expect(boosts[0].kind.strikes).toBe(0);
    }

    // Spent — it can never be tapped twice.
    expect(viableActions(afterTap, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);
  });

  // ─── The boost: +1 prowess to Wolf, Spider and Animal attacks ───────────────

  test('a Wolf attack after the tap has +1 prowess (8 → 9) and unchanged strikes', () => {
    const { afterTap } = playAndTapDwar(setup([DWAR, WOLVES]));
    const combat = attackWith(afterTap, WOLVES).combat!;
    expect(combat.strikeProwess).toBe(9);
    expect(combat.strikesTotal).toBe(3); // strikes: 0 — only prowess is boosted
  });

  test('control: without the tap the same Wolf attack is at its printed prowess 8', () => {
    const afterPlay = playDwarAsPermanentEvent(setup([DWAR, WOLVES]));
    const combat = attackWith(afterPlay, WOLVES).combat!;
    expect(combat.strikeProwess).toBe(8);
    expect(combat.strikesTotal).toBe(3);
  });

  test('a Spider attack after the tap has +1 prowess (10 → 11)', () => {
    const { afterTap } = playAndTapDwar(setup([DWAR, GIANT_SPIDERS]));
    expect(attackWith(afterTap, GIANT_SPIDERS).combat!.strikeProwess).toBe(11);
  });

  test('an Animal attack after the tap has +1 prowess (5 → 6)', () => {
    const { afterTap } = playAndTapDwar(setup([DWAR, CREBAIN]));
    expect(attackWith(afterTap, CREBAIN).combat!.strikeProwess).toBe(6);
  });

  test('an Orc attack is untouched — only Wolf, Spider and Animal attacks are boosted', () => {
    const { afterTap } = playAndTapDwar(setup([DWAR, ORC_PATROL]));
    expect(attackWith(afterTap, ORC_PATROL).combat!.strikeProwess).toBe(6);
  });

  test('"all attacks" reaches site automatic-attacks too: Weathertop\'s Wolves attack at 6 → 7', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: WEATHERTOP, characters: [ARAGORN, LEGOLAS] }));
    const printed = dispatch(base, { type: 'pass', player: PLAYER_1 });
    expect(printed.combat!.strikeProwess).toBe(6);

    const boosted = dispatch(withDwarBoost(base), { type: 'pass', player: PLAYER_1 });
    expect(boosted.combat!.strikeProwess).toBe(7);
    expect(boosted.combat!.strikesTotal).toBe(2);
  });

  // ─── Cross-card: dm-36's "any Nazgûl permanent-event" auto-attack ──────────

  test('in play as a permanent-event, Dwar adds a Nazgûl auto-attack at The Under-courts (dm-36)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, DWAR);
    const attacks = getActiveAutoAttacks(state, state.cardPool[THE_UNDER_COURTS] as SiteCard);
    // Printed Trolls (3/10) + the Dwar permanent-event Nazgûl attack.
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Nazgûl', strikes: 1, prowess: 15, body: 10 });
  });

  test('Dwar does NOT augment The Sulfur-deeps (dm-35), whose rule names only Khamûl and Adûnaphel', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, DWAR);
    const attacks = getActiveAutoAttacks(state, state.cardPool[THE_SULFUR_DEEPS] as SiteCard);
    expect(attacks.every(a => a.creatureType !== 'Nazgûl')).toBe(true);
  });
});
