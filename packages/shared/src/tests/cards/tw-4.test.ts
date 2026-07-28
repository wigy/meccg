/**
 * @module tw-4.test
 *
 * Card test: Akhôrahil (tw-4)
 * Type: hazard-creature (dual creature / permanent-event)
 * Race: Nazgûl. Unique. Nazgûl (5th). One strike at prowess 16, body 9, 5 kill MP.
 *
 * Card text:
 *   "Unique. Nazgûl (5th). May be played as a hazard creature (with one
 *    strike) or as a permanent-event.
 *    As a creature, may also be played keyed to Harondor, Horse Plains,
 *    Gorgoroth, and Khand; and may also be played at sites in these regions.
 *    If played as a permanent-event, it will remain in play until tapped
 *    during the opponent's movement/hazard phase (tapping counts against the
 *    hazard limit). When tapped, Akhôrahil becomes a short-event and modifies
 *    any one character's body by -1 for the rest of this turn."
 *
 * Keying (canonical `playable` = {d}{D}):
 *   - Base: a Dark-domain region {d} in the site path, or a Dark-hold {D}
 *     destination — the two tokens are alternatives, as for every creature.
 *   - Alt: named regions Harondor, Horse Plains, Gorgoroth, Khand — a single
 *     `regionNames` keyedTo entry, which also covers "may also be played at
 *     sites in these regions" (the destination region name is part of the
 *     resolved path; tw-107/tw-46/tw-31 precedent).
 *
 * Card shape (data, not re-asserted below): `keywords: ["Nazgûl"]`; effects
 * `permanent-event-auto-attack` (siteIds [dm-36], Nazgûl 1×16/9,
 * `discardAfterUse`), `play-flag: playable-as-event`, `creature-alt-event`
 * mode `permanent-event`, and `target-character-stat-modifier`
 * (stat body, value -1).
 *
 * Engine support:
 * | # | Feature                                        | Status      | Notes                                            |
 * |---|------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | One strike, prowess 16, body 9                 | IMPLEMENTED | structural data                                  |
 * | 2 | Keying: base {d}{D}                            | IMPLEMENTED | regionTypes/siteTypes in keyedTo                 |
 * | 3 | Keying: named Harondor/Horse Plains/…          | IMPLEMENTED | regionNames in keyedTo                           |
 * | 4 | Permanent-event play mode (dual creature/PE)   | IMPLEMENTED | creature-alt-event (mode permanent-event)        |
 * | 5 | Tapped by opponent in their M/H (vs haz limit) | IMPLEMENTED | tap-alt-permanent-event (counts vs haz limit)    |
 * | 6 | On tap → short-event: any ONE character's body | IMPLEMENTED | target-character-stat-modifier → turn-scoped     |
 * |   | is modified by -1 for the rest of the turn      |             | character-stat-modifier constraint               |
 * | 7 | The reduced body is what a body check uses      | IMPLEMENTED | body check reads `effectiveStats.body`           |
 * | 8 | dm-36 "any Nazgûl permanent-event" auto-attack | IMPLEMENTED | permanent-event-auto-attack (tw-46/tw-31 prec.)  |
 *
 * Cross-card interaction (from the site side): The Under-courts (dm-36) reads
 * "If any Nazgûl permanent-event is in play, one must be used as an additional
 * automatic-attack (attacker's choice, discard after use — ignore result of
 * defeat)" — modeled per-Nazgûl via `permanent-event-auto-attack`. The
 * Sulfur-deeps (dm-35) names only Khamûl and Adûnaphel, so Akhôrahil carries no
 * dm-35 entry.
 *
 * Playable: YES. Both play modes ride the generic dual-mode primitive
 * (tw-107/tw-46/tw-31 precedent). The on-tap conversion resolves the new
 * `target-character-stat-modifier` effect through the ordinary short-event
 * chain path: the card-player names one of the opponent's characters at tap
 * time (CoE 2.1.2 — a hazard never aims at its own side), and resolution
 * installs a turn-scoped `character-stat-modifier` constraint on that instance.
 * Because the character body check now reads `effectiveStats.body` rather than
 * the printed value, the -1 is what a wounded character actually checks
 * against.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  buildSimpleTwoPlayerState, addCardInPlay,
  makeMHState, makeBodyCheckCombat,
  playCreatureHazardAndResolve,
  findHandCardId, findCharInstanceId,
  viableActions, dispatch, reduce, resolveChain,
  companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, CardStatus, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, SiteCard, MovementHazardPhaseState } from '../../index.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';

const AKHORAHIL = 'tw-4' as CardDefinitionId;
const THE_SULFUR_DEEPS = 'dm-35' as CardDefinitionId;
const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId;

/**
 * Two-company M/H setup with Akhôrahil in the hazard player's hand. The
 * resource (active) player fields Aragorn (body 9) and Legolas (body 8); the
 * hazard player fields Frodo (body 9) as the "own character" control.
 */
const setup = () => buildTestState({
  activePlayer: PLAYER_1,
  phase: Phase.MovementHazard,
  recompute: true,
  players: [
    { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [AKHORAHIL], siteDeck: [RIVENDELL] },
  ],
});

/** Put Akhôrahil into play as a permanent-event; returns the post-chain state. */
const playAsPermanentEvent = (state: GameState) => {
  const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
  const akhorahilId = findHandCardId(ready, HAZARD_PLAYER, AKHORAHIL);
  const afterPlay = resolveChain(dispatch(ready, {
    type: 'play-hazard', player: PLAYER_2, cardInstanceId: akhorahilId,
    targetCompanyId: companyIdAt(ready, RESOURCE_PLAYER), altEventMode: 'permanent-event',
  }));
  return { afterPlay, akhorahilId };
};

/** Play Akhôrahil as a permanent-event and tap it, naming `victimId`. */
const playAndTap = (state: GameState, victimId: CardInstanceId) => {
  const { afterPlay, akhorahilId } = playAsPermanentEvent(state);
  const playedCount = (afterPlay.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
  const tap = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
    .find(a => (a.action as { targetCharacterId?: string }).targetCharacterId === (victimId as unknown as string));
  expect(tap).toBeDefined();
  return { afterPlay, afterTap: resolveChain(dispatch(afterPlay, tap!.action)), akhorahilId, playedCount };
};

/**
 * Drive a real body check against `characterId` with a fixed roll total, and
 * report whether the character was eliminated.
 */
const bodyCheckEliminates = (state: GameState, characterId: CardInstanceId, rollTotal: number) => {
  const ready = {
    ...state,
    combat: makeBodyCheckCombat({ companyId: companyIdAt(state, RESOURCE_PLAYER), characterId }),
    cheatRollTotal: rollTotal,
  };
  const [roll] = viableActions(ready, PLAYER_2, 'body-check-roll');
  expect(roll).toBeDefined();
  const after = dispatch(ready, roll.action);
  return after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === characterId);
};

describe('Akhôrahil (tw-4)', () => {
  beforeEach(() => resetMint());

  // ─── Creature-mode keying ───────────────────────────────────────────────────

  test('playable as a creature keyed to a Dark-hold in a Dark-domain path', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Nurn'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    }) };
    const akhorahilId = findHandCardId(ready, HAZARD_PLAYER, AKHORAHIL);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === akhorahilId && !!a.action.keyedBy);
    expect(creaturePlays.length).toBeGreaterThan(0);
  });

  test('playable as a creature keyed to a named region (Horse Plains) and at its sites', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Horse Plains'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    }) };
    const akhorahilId = findHandCardId(ready, HAZARD_PLAYER, AKHORAHIL);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === akhorahilId && !!a.action.keyedBy);
    expect(creaturePlays.length).toBeGreaterThan(0);
  });

  test('NOT playable as a keyed creature on a neutral path (no Dark-domain, no named region)', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    }) };
    const akhorahilId = findHandCardId(ready, HAZARD_PLAYER, AKHORAHIL);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === akhorahilId && !!a.action.keyedBy);
    expect(creaturePlays).toHaveLength(0);
  });

  test('creature combat initiates with one strike at prowess 16', () => {
    const ready = { ...setup(), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Minas Morgul',
    }) };
    const akhorahilId = findHandCardId(ready, HAZARD_PLAYER, AKHORAHIL);
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, akhorahilId, companyIdAt(ready, RESOURCE_PLAYER),
      { method: 'region-name', value: 'Gorgoroth' },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(16);
  });

  // ─── Permanent-event mode ───────────────────────────────────────────────────

  test('offered as a permanent-event and enters play untapped, modifying nothing yet', () => {
    const ready = { ...setup(), phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);

    const { afterPlay, akhorahilId } = playAsPermanentEvent(setup());
    expect(afterPlay.combat).toBeNull();
    const inPlay = afterPlay.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === akhorahilId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);

    // "It will remain in play until tapped" — merely sitting there modifies no
    // one: no constraint, and Aragorn keeps his printed body 9.
    expect(afterPlay.activeConstraints.filter(c => c.kind.type === 'character-stat-modifier')).toHaveLength(0);
    const aragornId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, ARAGORN);
    expect(afterPlay.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.body).toBe(9);
  });

  // ─── On tap: who may be named ───────────────────────────────────────────────

  test('every one of the opponent\'s characters is offered as the target', () => {
    const { afterPlay } = playAsPermanentEvent(setup());
    const aragornId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, LEGOLAS);

    const targets = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
      .map(a => (a.action as { targetCharacterId?: string }).targetCharacterId);
    expect(targets).toContain(aragornId as unknown as string);
    expect(targets).toContain(legolasId as unknown as string);
    expect(targets).toHaveLength(2);
  });

  test('the hazard player may not name their OWN character (CoE 2.1.2)', () => {
    const { afterPlay, akhorahilId } = playAsPermanentEvent(setup());
    const frodoId = findCharInstanceId(afterPlay, HAZARD_PLAYER, FRODO);

    const targets = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')
      .map(a => (a.action as { targetCharacterId?: string }).targetCharacterId);
    expect(targets).not.toContain(frodoId as unknown as string);

    // Forging the self-target is rejected by the reducer; nothing moves.
    const forged = reduce(afterPlay, {
      type: 'tap-alt-permanent-event', player: PLAYER_2, cardInstanceId: akhorahilId, targetCharacterId: frodoId,
    });
    expect(forged.error).toBeDefined();
    expect(forged.state.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === akhorahilId)).toBe(true);
  });

  test('with no opposing character in play the tap is surfaced as not viable', () => {
    // The resource player's only company holds a single character, who is
    // eliminated before the tap window: nothing is left to modify.
    const { afterPlay, akhorahilId } = playAsPermanentEvent(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [AKHORAHIL], siteDeck: [RIVENDELL] },
      ],
    }));
    const stripped: GameState = {
      ...afterPlay,
      players: [
        { ...afterPlay.players[RESOURCE_PLAYER], characters: {}, companies: afterPlay.players[RESOURCE_PLAYER].companies.map(c => ({ ...c, characters: [] })) },
        afterPlay.players[HAZARD_PLAYER],
      ],
    };

    expect(viableActions(stripped, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);
    const blocked = computeLegalActions(stripped, PLAYER_2)
      .find(a => a.action.type === 'tap-alt-permanent-event'
        && (a.action as { cardInstanceId?: string }).cardInstanceId === (akhorahilId as unknown as string));
    expect(blocked).toBeDefined();
    expect(blocked!.viable).toBe(false);
    expect(blocked!.reason).toContain('No eligible character');
  });

  // ─── On tap: the body modification ──────────────────────────────────────────

  test('tapping discards Akhôrahil, costs a hazard slot, and installs the turn-long -1 body', () => {
    const state = setup();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap, akhorahilId, playedCount } = playAndTap(state, aragornId);

    // "Becomes a short-event": leaves play and is discarded.
    expect(afterTap.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === akhorahilId)).toBe(false);
    expect(afterTap.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === akhorahilId)).toBe(true);
    // "Tapping counts against the hazard limit."
    expect((afterTap.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(playedCount + 1);

    // One turn-scoped body modifier bound to the named character.
    const mods = afterTap.activeConstraints.filter(c => c.kind.type === 'character-stat-modifier');
    expect(mods).toHaveLength(1);
    expect(mods[0].scope).toEqual({ kind: 'turn' });
    expect(mods[0].target).toEqual({ kind: 'character', characterId: aragornId });
    if (mods[0].kind.type === 'character-stat-modifier') {
      expect(mods[0].kind.stat).toBe('body');
      expect(mods[0].kind.value).toBe(-1);
      expect(mods[0].kind.characterId).toBe(aragornId);
    }

    // Spent — it can never be tapped twice.
    expect(viableActions(afterTap, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);
  });

  test('the named character\'s body drops by 1 and no one else\'s does', () => {
    const state = setup();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const { afterTap } = playAndTap(state, aragornId);

    expect(afterTap.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.body).toBe(8);
    // "Any ONE character" — Legolas keeps his printed body 8.
    expect(afterTap.players[RESOURCE_PLAYER].characters[legolasId].effectiveStats.body).toBe(8);
    const legolasMods = afterTap.activeConstraints.filter(c =>
      c.kind.type === 'character-stat-modifier' && c.kind.characterId === legolasId);
    expect(legolasMods).toHaveLength(0);
  });

  test('naming Legolas instead moves the -1 to him and leaves Aragorn at body 9', () => {
    const state = setup();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap } = playAndTap(state, legolasId);

    expect(afterTap.players[RESOURCE_PLAYER].characters[legolasId].effectiveStats.body).toBe(7);
    expect(afterTap.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.body).toBe(9);
  });

  // ─── The modified body is what a body check uses ────────────────────────────

  test('control: without the tap, a body-check roll of 9 leaves body-9 Aragorn alive', () => {
    const { afterPlay } = playAsPermanentEvent(setup());
    const aragornId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, ARAGORN);
    expect(bodyCheckEliminates(afterPlay, aragornId, 9)).toBe(false);
  });

  test('after the tap the same roll of 9 eliminates Aragorn (body 9 → 8)', () => {
    const state = setup();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap } = playAndTap(state, aragornId);
    expect(bodyCheckEliminates(afterTap, aragornId, 9)).toBe(true);
  });

  test('a roll of 8 still spares the modified Aragorn (8 is not greater than body 8)', () => {
    const state = setup();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap } = playAndTap(state, aragornId);
    expect(bodyCheckEliminates(afterTap, aragornId, 8)).toBe(false);
  });

  test('the -1 does not reach an unnamed company-mate: Legolas survives a roll of 8', () => {
    const state = setup();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { afterTap } = playAndTap(state, aragornId);
    const legolasId = findCharInstanceId(afterTap, RESOURCE_PLAYER, LEGOLAS);
    expect(bodyCheckEliminates(afterTap, legolasId, 8)).toBe(false);
  });

  // ─── Cross-card: dm-36's "any Nazgûl permanent-event" auto-attack ───────────

  test('in play as a permanent-event, Akhôrahil adds a Nazgûl auto-attack at The Under-courts (dm-36)', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, AKHORAHIL);
    const attacks = getActiveAutoAttacks(state, state.cardPool[THE_UNDER_COURTS] as SiteCard);
    // Printed Trolls (3/10) + the Akhôrahil permanent-event Nazgûl attack.
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Nazgûl', strikes: 1, prowess: 16, body: 9 });
  });

  test('Akhôrahil does NOT augment The Sulfur-deeps (dm-35), whose rule names only Khamûl and Adûnaphel', () => {
    const state = addCardInPlay(buildSimpleTwoPlayerState(), HAZARD_PLAYER, AKHORAHIL);
    const attacks = getActiveAutoAttacks(state, state.cardPool[THE_SULFUR_DEEPS] as SiteCard);
    expect(attacks.every(a => a.creatureType !== 'Nazgûl')).toBe(true);
  });
});
