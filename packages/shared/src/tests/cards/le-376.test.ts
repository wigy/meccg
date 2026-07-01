/**
 * @module le-376.test
 *
 * Card test: Glittering Caves (le-376)
 * Type: minion-site (ruins-and-lairs) in Gap of Isen
 *
 * Text:
 *   Nearest Darkhaven: Geann a-Lisch
 *   Playable: Items (minor, major)
 *   Automatic-attacks: Pûkel-creature — 1 strike with 9 prowess
 *
 * The card carries no special rules — it is a plain Ruins & Lairs minion site
 * with a single Pûkel-creature automatic-attack and minor/major item
 * playability. Every rule on the card routes through the standard site
 * machinery already in the engine (movement via nearestHaven, item
 * playability via playableResources, automatic-attack combat in
 * reducer-site.ts).
 *
 * Site Structural Checks (documented; verified behaviourally below):
 * | # | Property          | Notes                                                       |
 * |---|-------------------|-------------------------------------------------------------|
 * | 1 | siteType          | "ruins-and-lairs" — valid                                   |
 * | 2 | sitePath          | [wilderness, shadow] — matches {w}{s}                       |
 * | 3 | nearestHaven      | "Geann a-Lisch" — valid minion haven (le-374) in card pool  |
 * | 4 | region            | "Gap of Isen" — valid region in card pool                   |
 * | 5 | playableResources | [minor, major] — matches card text "Items (minor, major)"   |
 * | 6 | automaticAttacks  | Pûkel-creature — 1 strike, 9 prowess                        |
 * | 7 | resourceDraws     | 1                                                            |
 * | 8 | hazardDraws       | 1                                                            |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                                 |
 * |---|---------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, play-resources          |
 * | 2 | Item playability (minor/major) | IMPLEMENTED | playableResources gates play-resource actions          |
 * | 3 | Greater item rejected           | IMPLEMENTED | greater not listed → not playable                      |
 * | 4 | Haven path movement             | IMPLEMENTED | Geann a-Lisch ↔ Glittering Caves via starter           |
 * | 5 | Pûkel-creature automatic-attack | IMPLEMENTED | reducer-site.ts initiates 1×9 pukel-creature combat    |
 *
 * Playable: YES
 * Certified: 2026-07-01
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, LORIEN,
  resetMint, pool,
  buildTestState, buildMinionSitePhaseState, viableActions, dispatch,
  runAutoAttackCombatMulti,
} from '../test-helpers.js';
import type { CharacterEntry } from '../test-helpers.js';
import {
  Alignment, Phase, SiteType,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type {
  SiteCard, CardDefinitionId, GameState, SitePhaseState,
} from '../../index.js';

const GLITTERING_CAVES = 'le-376' as CardDefinitionId;
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;   // nearest Darkhaven (minion haven)
const GORBAG = 'le-11' as CardDefinitionId;           // orc, prowess 6, body 9
const LAGDUF = 'le-18' as CardDefinitionId;           // orc, prowess 5, body 8
const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId;  // minor item
const SABLE_SHIELD = 'le-341' as CardDefinitionId;       // major item
const THE_IRON_CROWN = 'le-314' as CardDefinitionId;     // greater item (must be rejected)

// SitePhaseState skeleton at the automatic-attacks step.
const autoAttackBase: SitePhaseState = {
  phase: Phase.Site,
  step: 'automatic-attacks',
  activeCompanyIndex: 0,
  handledCompanyIds: [],
  siteEntered: false,
  resourcePlayed: false,
  minorItemAvailable: false,
  hoardBountyAvailable: false,
  thoroughSearchAvailable: false,
  declaredAgentAttack: null,
  automaticAttacksResolved: 0,
  awaitingOnGuardReveal: false,
  pendingResourceAction: null,
  opponentInteractionThisTurn: null,
  pendingOpponentInfluence: null,
};

// Build a Ringwraith company at Glittering Caves sitting at the
// automatic-attacks step (the single Pûkel-creature attack is next to fire).
const atAutoAttack = (characters: CharacterEntry[]): GameState => {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: GLITTERING_CAVES, characters }],
        hand: [],
        siteDeck: [GEANN_A_LISCH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: GEANN_A_LISCH, characters: [] }],
        hand: [],
        siteDeck: [GEANN_A_LISCH],
      },
    ],
  });
  return { ...base, phaseState: { ...autoAttackBase } };
};

// Find the instance id of a hand card by definition id for player 0.
const handInstId = (state: GameState, defId: CardDefinitionId): string =>
  state.players[0].hand.find(c => c.definitionId === (defId as string))!.instanceId as string;

const isPlayOf = (ea: { action: unknown }, instId: string): boolean => {
  const a = ea.action as { cardInstanceId?: string };
  return a.cardInstanceId === instId;
};

describe('Glittering Caves (le-376)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Geann a-Lisch ↔ Glittering Caves ─────────────────────────────

  test('starter movement from Geann a-Lisch reaches Glittering Caves', () => {
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, geann, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GLITTERING_CAVES as string),
    );
    expect(starter).toBeDefined();
  });

  test('starter movement from Glittering Caves returns to Geann a-Lisch', () => {
    const caves = pool[GLITTERING_CAVES as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, caves, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GEANN_A_LISCH as string),
    );
    expect(starter).toBeDefined();
  });

  test('starter movement from Lórien (hero haven) does NOT reach the minion Glittering Caves', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GLITTERING_CAVES as string),
    );
    expect(starter).toBeUndefined();
  });

  test('haven-to-haven movement from Geann a-Lisch does not include Glittering Caves (not a haven)', () => {
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(geann.name);
    // Geann a-Lisch's only haven link is Carn Dûm; Glittering Caves is not a haven.
    expect(havenLinks?.has('Glittering Caves') ?? false).toBe(false);
  });

  // ─── Item playability: minor and major, but not greater ─────────────────────

  test('minor item (Black-hide Shield) is playable at Glittering Caves', () => {
    const state = buildMinionSitePhaseState({
      site: GLITTERING_CAVES,
      characters: [GORBAG],
      hand: [BLACK_HIDE_SHIELD],
    });
    const instId = handInstId(state, BLACK_HIDE_SHIELD);

    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.some(ea => isPlayOf(ea, instId))).toBe(true);
  });

  test('major item (Sable Shield) is playable at Glittering Caves', () => {
    const state = buildMinionSitePhaseState({
      site: GLITTERING_CAVES,
      characters: [GORBAG],
      hand: [SABLE_SHIELD],
    });
    const instId = handInstId(state, SABLE_SHIELD);

    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.some(ea => isPlayOf(ea, instId))).toBe(true);
  });

  test('greater item (The Iron Crown) is NOT playable — site allows only minor/major items', () => {
    const state = buildMinionSitePhaseState({
      site: GLITTERING_CAVES,
      characters: [GORBAG],
      hand: [THE_IRON_CROWN],
    });
    const instId = handInstId(state, THE_IRON_CROWN);

    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.some(ea => isPlayOf(ea, instId))).toBe(false);
  });

  // ─── Automatic attack: Pûkel-creature — 1 strike with 9 prowess ─────────────

  test('automatic attack is Pûkel-creature — 1 strike with 9 prowess, a normal (cancelable) attack', () => {
    const triggered = dispatch(atAutoAttack([GORBAG, LAGDUF]), { type: 'pass', player: PLAYER_1 });
    expect(triggered.combat).not.toBeNull();
    expect(triggered.combat!.attackSource.type).toBe('automatic-attack');
    expect(triggered.combat!.creatureRace).toBe('pukel-creature');
    expect(triggered.combat!.strikesTotal).toBe(1);
    expect(triggered.combat!.strikeProwess).toBe(9);
    // No special combat rules on this attack.
    expect(triggered.combat!.uncancelable ?? false).toBe(false);
    expect(triggered.combat!.woundEliminates ?? false).toBe(false);
  });

  test('the Pûkel-creature attack against a Ringwraith company at a Ruins & Lairs is NOT detainment (a real wounding attack)', () => {
    // §3.II.2.R1/R2 only make a Ringwraith-company attack detainment when it is
    // keyed to a Dark-domain/Dark-hold/Shadow-hold, or when a Shadow-land race
    // (Orc/Troll/Undead/Man) is keyed to a Shadow-land. A Pûkel-creature attack
    // keyed to a Ruins & Lairs is neither, so it wounds normally.
    const cavesDef = pool[GLITTERING_CAVES as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: cavesDef.effects,
      attackRace: Race.PukelCreature,
      attackKeyedTo: [{ siteTypes: [SiteType.RuinsAndLairs] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: cavesDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('the triggered Pûkel-creature combat is flagged as a non-detainment attack', () => {
    const triggered = dispatch(atAutoAttack([GORBAG, LAGDUF]), { type: 'pass', player: PLAYER_1 });
    expect(triggered.combat).not.toBeNull();
    expect(triggered.combat!.detainment).toBe(false);
  });

  test('the Pûkel-creature attack resolves to completion: the sole defender survives a defeated strike', () => {
    // A single strike; the fighting orc taps and rolls high enough to defeat
    // the 9-prowess strike. Combat finalizes with both orcs still in play.
    const state = atAutoAttack([GORBAG, LAGDUF]);

    const result = runAutoAttackCombatMulti(state, [
      { characterDefId: GORBAG, roll: 12, tapToFight: true },
    ]);

    expect(result.state.combat).toBeNull();
    const p0 = result.state.players[0];
    expect(p0.outOfPlayPile.some(c => c.definitionId === (GORBAG as string))).toBe(false);
    expect(p0.outOfPlayPile.some(c => c.definitionId === (LAGDUF as string))).toBe(false);
  });
});
