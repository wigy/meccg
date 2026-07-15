/**
 * @module le-375.test
 *
 * Card test: Gladden Fields (le-375)
 * Type: minion-site (ruins-and-lairs) in Anduin Vales
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur
 *   Playable: Items (gold ring)
 *   Automatic-attacks: Undead — 1 strike with 8 prowess;
 *   each character wounded must make a corruption check modified by -2
 *
 * Unlike its hero namesake (tw-396, a plain 1×8 Undead auto-attack with no
 * follow-up), the minion Gladden Fields adds a wound-triggered corruption
 * check modified by -2, and it allows ONLY gold-ring items to be played.
 * Both rules route through existing engine machinery:
 *   - gold-ring-only playability via `playableResources: ["gold-ring"]`
 *     (legal-actions/site.ts gates item subtype against the site's list)
 *   - the wound corruption check via
 *     `on-event: character-wounded-by-self → force-check corruption, modifier -2`
 *     (combat-finalize.ts enqueues one corruption-check per wounded character,
 *     threading the -2 modifier). This is the same shape certified for the
 *     ringwraith Shadow-hold le-370 and the hero site dm-31.
 *
 * Site Structural Checks (documented; verified behaviourally below):
 * | # | Property          | Notes                                                     |
 * |---|-------------------|-----------------------------------------------------------|
 * | 1 | siteType          | "ruins-and-lairs" — valid                                 |
 * | 2 | sitePath          | [dark, shadow] — matches {d}{s}                           |
 * | 3 | nearestHaven      | "Dol Guldur" — valid minion darkhaven (le-367) in pool    |
 * | 4 | region            | "Anduin Vales" — valid region in card pool                |
 * | 5 | playableResources | [gold-ring] — matches card text "Items (gold ring)"       |
 * | 6 | automaticAttacks  | Undead — 1 strike, 8 prowess                              |
 * | 7 | resourceDraws     | 1                                                          |
 * | 8 | hazardDraws       | 1                                                          |
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                             |
 * |---|-----------------------------------|-------------|---------------------------------------------------|
 * | 1 | Site phase flow                  | IMPLEMENTED | select-company, enter-or-skip, play-resources      |
 * | 2 | Item playability (gold-ring only)| IMPLEMENTED | playableResources gates subtype; minor/major denied|
 * | 3 | Haven path movement              | IMPLEMENTED | Dol Guldur ↔ Gladden Fields via starter            |
 * | 4 | Undead automatic-attack          | IMPLEMENTED | reducer-site.ts initiates 1×8 undead combat        |
 * | 5 | Wound → corruption check (-2)    | IMPLEMENTED | on-event character-wounded-by-self, modifier -2    |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, LORIEN, RESOURCE_PLAYER,
  resetMint, pool,
  buildMinionSitePhaseState, setupAutoAttackStep, runAutoAttackCombat,
  findCharInstanceId, viableActions, viableFor, dispatch,
  expectCharNotInPlay,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId, GameState } from '../../index.js';

const GLADDEN_FIELDS = 'le-375' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;             // nearest Darkhaven (minion haven)
const GORBAG = 'le-11' as CardDefinitionId;                  // orc, prowess 6, body 9
const THE_LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId; // gold-ring item, 4 CP
const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId;      // minor item (must be rejected)

// Find the instance id of a hand card by definition id for player 0.
const handInstId = (state: GameState, defId: CardDefinitionId): string =>
  state.players[0].hand.find(c => c.definitionId === (defId as string))!.instanceId as string;

const isPlayOf = (ea: { action: unknown }, instId: string): boolean => {
  const a = ea.action as { cardInstanceId?: string };
  return a.cardInstanceId === instId;
};

describe('Gladden Fields (le-375)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Dol Guldur ↔ Gladden Fields ──────────────────────────────────

  test('starter movement from Dol Guldur reaches Gladden Fields', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GLADDEN_FIELDS as string),
    );
    expect(starter).toBeDefined();
  });

  test('starter movement from Gladden Fields returns to Dol Guldur', () => {
    const gladden = pool[GLADDEN_FIELDS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, gladden, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );
    expect(starter).toBeDefined();
  });

  test('starter movement from Lórien (hero haven) does NOT reach the minion Gladden Fields', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GLADDEN_FIELDS as string),
    );
    expect(starter).toBeUndefined();
  });

  // ─── Item playability: gold-ring only ───────────────────────────────────────

  test('gold-ring item (The Least of Gold Rings) is playable at Gladden Fields', () => {
    const state = buildMinionSitePhaseState({
      site: GLADDEN_FIELDS,
      characters: [GORBAG],
      hand: [THE_LEAST_OF_GOLD_RINGS],
    });
    const instId = handInstId(state, THE_LEAST_OF_GOLD_RINGS);

    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.some(ea => isPlayOf(ea, instId))).toBe(true);
  });

  test('minor item (Black-hide Shield) is NOT playable — site allows only gold-ring items', () => {
    const state = buildMinionSitePhaseState({
      site: GLADDEN_FIELDS,
      characters: [GORBAG],
      hand: [BLACK_HIDE_SHIELD],
    });
    const instId = handInstId(state, BLACK_HIDE_SHIELD);

    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.some(ea => isPlayOf(ea, instId))).toBe(false);
  });

  // ─── Automatic attack: Undead — 1 strike with 8 prowess ─────────────────────

  test('automatic attack is Undead — 1 strike with 8 prowess', () => {
    const readyState = setupAutoAttackStep(
      buildMinionSitePhaseState({ site: GLADDEN_FIELDS, characters: [GORBAG] }),
    );
    const triggered = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(triggered.combat).not.toBeNull();
    expect(triggered.combat!.attackSource.type).toBe('automatic-attack');
    expect(triggered.combat!.creatureRace).toBe('undead');
    expect(triggered.combat!.strikesTotal).toBe(1);
    expect(triggered.combat!.strikeProwess).toBe(8);
  });

  // ─── Wound → corruption check modified by -2 ─────────────────────────────────

  test('a wounded character gets a corruption check modified by -2', () => {
    const readyState = setupAutoAttackStep(
      buildMinionSitePhaseState({ site: GLADDEN_FIELDS, characters: [GORBAG] }),
    );

    // Stay untapped: prowess 6-3=3, roll 2 → 2+3=5 < 8 → wounded. Body 5 <= 9 → survives.
    const result = runAutoAttackCombat(readyState, GORBAG, 2, 5, false);
    expect(result.state.combat).toBeNull();

    const pending = result.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;

    // The site's "-2" modifier must be carried into the check.
    expect(pending[0].kind.modifier).toBe(-2);

    const gorbagId = findCharInstanceId(result.state, RESOURCE_PLAYER, GORBAG);
    expect(pending[0].kind.characterId).toBe(gorbagId);

    // The check is offered to the defending player.
    const viable = viableFor(result.state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');
  });

  test('a character that defeats its auto-attack strike gets no corruption check', () => {
    const readyState = setupAutoAttackStep(
      buildMinionSitePhaseState({ site: GLADDEN_FIELDS, characters: [GORBAG] }),
    );

    // Tap to fight at full prowess 6, roll 12 → 18 > 8 → strike defeated, no wound.
    const result = runAutoAttackCombat(readyState, GORBAG, 12, null);
    expect(result.state.combat).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  test('the wound corruption check passes on a high roll — character survives', () => {
    const readyState = setupAutoAttackStep(
      buildMinionSitePhaseState({ site: GLADDEN_FIELDS, characters: [GORBAG] }),
    );

    const wounded = runAutoAttackCombat(readyState, GORBAG, 2, 5, false);
    const ccAction = viableActions(wounded.state, PLAYER_1, 'corruption-check')[0].action;

    // Gorbag bears no items (0 CP); roll 12 - 2 = 10 > 0 → passes.
    const ccState = dispatch({ ...wounded.state, cheatRollTotal: 12 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    const gorbagId = findCharInstanceId(wounded.state, RESOURCE_PLAYER, GORBAG);
    // Passed the check → still in play (wounded, not eliminated).
    expect(ccState.players[0].characters[gorbagId]).toBeDefined();
  });

  test('the wound corruption check fails on a low roll — a corrupted character is discarded', () => {
    // Give Gorbag a gold ring (4 CP) so the -2-modified check can fail.
    const readyState = setupAutoAttackStep(
      buildMinionSitePhaseState({
        site: GLADDEN_FIELDS,
        characters: [{ defId: GORBAG, items: [THE_LEAST_OF_GOLD_RINGS] }],
      }),
    );

    const wounded = runAutoAttackCombat(readyState, GORBAG, 2, 5, false);
    const ccAction = viableActions(wounded.state, PLAYER_1, 'corruption-check')[0].action;
    expect(ccAction.type).toBe('corruption-check');

    // roll 2 - 2 = 0 vs 4 CP → fails → character eliminated/discarded.
    const ccState = dispatch({ ...wounded.state, cheatRollTotal: 2 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    const gorbagId = findCharInstanceId(wounded.state, RESOURCE_PLAYER, GORBAG);
    expectCharNotInPlay(ccState, RESOURCE_PLAYER, gorbagId);
  });
});
