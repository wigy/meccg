/**
 * @module le-364.test
 *
 * Card test: Dead Marshes (le-364)
 * Type: minion-site (shadow-hold) in Dagorlad
 * Nearest Darkhaven: Dol Guldur
 * Playable: Items (minor, major)
 * Automatic-attacks: Undead — 2 strikes with 8 prowess; each character
 *   wounded must make a corruption check modified by -2
 * Special: Non-Nazgûl creatures played at this site attack normally, not
 *   as detainment.
 * Effects: 2
 *   1. on-event character-wounded-by-self → force corruption check (modifier -2)
 *   2. site-rule attacks-not-detainment, filtered to non-Nazgûl attackers
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                               |
 * | 2 | sitePath          | OK     | [dark, shadow] — valid region types                 |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367)          |
 * | 4 | region            | OK     | "Dagorlad" — valid region in card pool              |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                  |
 * | 6 | automaticAttacks  | OK     | Undead — 2 strikes, 8 prowess — matches card text   |
 * | 7 | resourceDraws     | OK     | 1                                                   |
 * | 8 | hazardDraws       | OK     | 1                                                   |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                                  |
 * |---|---------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources          |
 * | 2 | Item playability (minor/major)  | IMPLEMENTED | subtype gated by playableResources                     |
 * | 3 | Haven path movement             | IMPLEMENTED | Dol Guldur → Dead Marshes via starter movement         |
 * | 4 | Automatic attacks               | IMPLEMENTED | site-phase auto-attack initiates Undead combat (2/8)   |
 * | 5 | Wound → corruption check (-2)   | IMPLEMENTED | on-event character-wounded-by-self (reducer-combat.ts) |
 * | 6 | Attacks-not-detainment override | IMPLEMENTED | site-rule overrides CoE §3.II.2.R1 for non-Nazgûl      |
 *
 * Playable: YES
 * Certified: 2026-06-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  LORIEN, MINAS_TIRITH, RIVENDELL, ORC_PATROL,
  resetMint, pool,
  buildTestState, makeSitePhase, makeMHState,
  setupAutoAttackStep, runAutoAttackCombatMulti,
  playCreatureHazardAndResolve, handCardId, companyIdAt,
  viableActions, dispatch, findCharInstanceId, expectCharStatus,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
  Phase, Alignment, SiteType, RegionType, CardStatus,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type { SiteCard, CardDefinitionId, GameState } from '../../index.js';

const DEAD_MARSHES = 'le-364' as CardDefinitionId;       // minion shadow-hold
const DEAD_MARSHES_HERO = 'tw-384' as CardDefinitionId;  // hero version, same name
const MORIA_HERO = 'tw-413' as CardDefinitionId;         // shadow-hold WITHOUT the override
const DOL_GULDUR = 'le-367' as CardDefinitionId;         // nearest Darkhaven
const GORBAG = 'le-11' as CardDefinitionId;              // orc, prowess 6, body 9
const LT_MORGUL = 'le-22' as CardDefinitionId;           // troll, prowess 8, body 9
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;    // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId;       // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId;  // greater minion item

const SHADOW_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.ShadowHold };

/**
 * Minion company (GORBAG + LT_MORGUL) parked at Dead Marshes in the site
 * phase, advanced to the automatic-attacks step so a `pass` triggers the
 * site's Undead attack.
 */
function autoAttackReady(): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DEAD_MARSHES, characters: [GORBAG, LT_MORGUL] }], hand: [], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
}

/** Minion company at Dead Marshes with `hand` for the Ringwraith player. */
function siteWithHand(hand: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DEAD_MARSHES, characters: [GORBAG] }], hand, siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

/**
 * Ringwraith company at `site` facing an Orc-patrol played by the hero
 * player and keyed to Shadow-hold. Returns state after the hazard resolves
 * into combat.
 */
function orcPatrolAt(site: CardDefinitionId): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
    ],
  });
  const ready: GameState = {
    ...state,
    phaseState: makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: (pool[site as string] as SiteCard).name,
    }),
  };
  const orcId = handCardId(ready, HAZARD_PLAYER);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(ready, PLAYER_2, orcId, companyId, SHADOW_HOLD_KEYING);
}

describe('Dead Marshes (le-364)', () => {
  beforeEach(() => resetMint());

  // ─── Nearest Darkhaven / movement ──────────────────────────────────────────

  test('starter movement from Dol Guldur reaches Dead Marshes (le-364)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const reachable = getReachableSites(buildMovementMap(pool), dolGuldur, allSites);

    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DEAD_MARSHES as string),
    );
    expect(entry).toBeDefined();
  });

  test('starter movement from Dol Guldur does NOT reach hero Dead Marshes (tw-384)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const reachable = getReachableSites(buildMovementMap(pool), dolGuldur, allSites);

    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DEAD_MARSHES_HERO as string),
    );
    expect(entry).toBeUndefined();
  });

  test('starter movement from a hero haven does NOT reach minion Dead Marshes (le-364)', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const reachable = getReachableSites(buildMovementMap(pool), rivendell, allSites);

    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DEAD_MARSHES as string),
    );
    expect(entry).toBeUndefined();
  });

  // ─── Automatic attack: Undead, 2 strikes, 8 prowess ─────────────────────────

  test('Undead automatic attack triggers with 2 strikes and 8 prowess', () => {
    const next = dispatch(autoAttackReady(), { type: 'pass', player: PLAYER_1 });

    expect(next.combat).toBeDefined();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(8);
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound → corruption check modified by -2 ────────────────────────────────

  test('wounded character gets a corruption check carrying the -2 modifier', () => {
    // Gorbag untapped (prowess 6 − 3 = 3) + roll 2 = 5 < 8 → wounded; body 5 ≤ 9 → survives.
    // Lt. of Morgul taps (prowess 8) + roll 12 = 20 > 8 → wins.
    const result = runAutoAttackCombatMulti(autoAttackReady(), [
      { characterDefId: GORBAG, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: LT_MORGUL, roll: 12, tapToFight: true },
    ]);
    expect(result.state.combat).toBeNull();

    const gorbagId = findCharInstanceId(result.state, RESOURCE_PLAYER, GORBAG);
    const pending = result.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.characterId).toBe(gorbagId);
    expect(pending[0].kind.modifier).toBe(-2);
  });

  test('the -2 modifier drops the roll to CP, but the minion Orc taps (CoE 7.1) rather than being discarded', () => {
    // Gorbag has 0 corruption points. With a roll of 2 the unmodified total (2)
    // would pass (> 0); the site's -2 makes it 0, which equals CP. For a hero
    // that would be a soft fail, but Gorbag is a minion character (Ringwraith's
    // Orc), so per CoE 7.1 it taps and the check is considered successful — it
    // stays in play. Already wounded, it remains wounded (no further tapping).
    const result = runAutoAttackCombatMulti(autoAttackReady(), [
      { characterDefId: GORBAG, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: LT_MORGUL, roll: 12, tapToFight: true },
    ]);

    const cc = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    expect(cc.type).toBe('corruption-check');
    const after = dispatch({ ...result.state, cheatRollTotal: 2 }, cc);

    expect(after.pendingResolutions).toHaveLength(0);
    // Not discarded — still in play, still wounded.
    expect(() => findCharInstanceId(after, RESOURCE_PLAYER, GORBAG)).not.toThrow();
    expectCharStatus(after, RESOURCE_PLAYER, GORBAG, CardStatus.Inverted);
  });

  test('corruption check survives a roll high enough to clear the -2 penalty', () => {
    // Roll 4 → 4 − 2 = 2 > 0 → passes; Gorbag stays in play.
    const result = runAutoAttackCombatMulti(autoAttackReady(), [
      { characterDefId: GORBAG, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: LT_MORGUL, roll: 12, tapToFight: true },
    ]);

    const cc = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    const after = dispatch({ ...result.state, cheatRollTotal: 4 }, cc);

    expect(after.pendingResolutions).toHaveLength(0);
    // Character is still present — findCharInstanceId throws if discarded.
    expect(() => findCharInstanceId(after, RESOURCE_PLAYER, GORBAG)).not.toThrow();
  });

  test('no corruption check is queued when no character is wounded', () => {
    // Both characters tap and win their strikes outright → no wounds.
    const result = runAutoAttackCombatMulti(autoAttackReady(), [
      { characterDefId: GORBAG, roll: 12, tapToFight: true },
      { characterDefId: LT_MORGUL, roll: 12, tapToFight: true },
    ]);

    expect(result.state.combat).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  // ─── Playable: Items (minor, major) ─────────────────────────────────────────

  test('minor and major items are playable at Dead Marshes', () => {
    expect(viableActions(siteWithHand([STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource')).toHaveLength(1);
    expect(viableActions(siteWithHand([SABLE_SHIELD]), PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('a greater item is NOT playable at Dead Marshes', () => {
    expect(viableActions(siteWithHand([SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ─── Special: non-Nazgûl creatures attack normally, not as detainment ───────

  test('non-Nazgûl creature keyed to Shadow-hold: detainment overridden to false', () => {
    // CoE §3.II.2.R1 would flag this as detainment (Ringwraith defender, Orc
    // keyed to a Shadow-hold). The site rule overrides it for non-Nazgûl.
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: (pool[DEAD_MARSHES as string] as SiteCard).effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: same Orc attack WITHOUT the site rule is detainment (R1)', () => {
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
    });
    expect(detainment).toBe(true);
  });

  test('Nazgûl creature: override filter skips it, detainment preserved', () => {
    // The override filter is `{ enemy.race: { $ne: nazgul } }`. A Nazgûl
    // attacker does not match, so the override does not fire and the attack
    // remains detainment via R1 (keyed to Dark-domain).
    const detainment = isDetainmentAttack({
      attackRace: 'ringwraith' as Race,
      attackKeyedTo: [{ regionTypes: [RegionType.Dark] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: (pool[DEAD_MARSHES as string] as SiteCard).effects,
    });
    expect(detainment).toBe(true);
  });

  test('integration: Orc-patrol vs minion company at Dead Marshes is not detainment', () => {
    const after = orcPatrolAt(DEAD_MARSHES);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('orc');
    expect(after.combat!.detainment).toBe(false);
  });

  test('integration baseline: same Orc-patrol at a shadow-hold without the rule IS detainment', () => {
    const after = orcPatrolAt(MORIA_HERO);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.detainment).toBe(true);
  });
});
