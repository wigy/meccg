/**
 * @module le-407.test
 *
 * Card test: Tharbad (le-407)
 * Type: minion-site (ruins-and-lairs) in Cardolan
 * Effects: 1 — `site-rule: allow-items-when-tapped`
 *
 * Text:
 *   Nearest Darkhaven: Carn Dûm.
 *   Playable: Items (minor).
 *   Automatic-attacks: Men — 3 strikes with 6 prowess.
 *   Special: Items may be played at this site even if it is tapped.
 *
 * Minion twin of the hero site Tharbad (td-180, nearest haven Rivendell),
 * which carries the same special rule. Data fix this pass: the imported
 * `playableResources` was empty, contradicting the printed "Playable: Items
 * (minor)" line (same import bug as Stone-circle le-405) — now ["minor"].
 * The `allow-items-when-tapped` site-rule and `unique` flag were also added.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                          |
 * |---|-------------------|--------|------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                |
 * | 2 | sitePath          | OK     | [shadow, wilderness, wilderness] — {s}{w}{w}   |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven (le-359)       |
 * | 4 | region            | OK     | "Cardolan"                                     |
 * | 5 | playableResources | OK     | ["minor"] — matches card text (data fix)       |
 * | 6 | automaticAttacks  | OK     | Men — 3 strikes at prowess 6                   |
 * | 7 | resourceDraws     | OK     | 2                                              |
 * | 8 | hazardDraws       | OK     | 2                                              |
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                      |
 * |---|--------------------------------------|-------------|---------------------------------------------|
 * | 1 | Site phase flow                      | IMPLEMENTED | select-company, enter-or-skip, resources   |
 * | 2 | Item playability (minor only)        | IMPLEMENTED | playableResources gates subtype at site    |
 * | 3 | Haven path movement                  | IMPLEMENTED | movement-map.ts → nearestHaven = Carn Dûm  |
 * | 4 | Automatic attack (Men 3×6)           | IMPLEMENTED | reducer-site.ts initiates the combat       |
 * | 5 | `site-rule: allow-items-when-tapped` | IMPLEMENTED | tapped-site gate bypassed for item plays   |
 *
 * Note: "Tharbad" is a duplicate site name shared with the hero site td-180.
 * Movement assertions therefore key on the site's definition id (le-407).
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildMinionSitePhaseState, setupRingwraithAutoAttack,
  viableActions,
} from '../test-helpers.js';
import {
  CardStatus, isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const THARBAD = 'le-407' as CardDefinitionId;
const SHREL_KAIN = 'le-403' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Minion characters for the Ringwraith-player fixture
const GORBAG = 'le-11' as CardDefinitionId;

// Minion items
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;   // minor, weapon
const SABLE_SHIELD = 'le-341' as CardDefinitionId;        // major, shield

describe('Tharbad (le-407)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability at untapped site ────────────────────────────────────

  test('minor minion item (Saw-toothed Blade) IS viable at untapped Tharbad', () => {
    const state = buildMinionSitePhaseState({
      site: THARBAD,
      characters: [GORBAG],
      hand: [SAW_TOOTHED_BLADE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('major minion item (Sable Shield) is NOT viable at Tharbad (only minor listed)', () => {
    const state = buildMinionSitePhaseState({
      site: THARBAD,
      characters: [GORBAG],
      hand: [SABLE_SHIELD],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── allow-items-when-tapped: item play at already-tapped Tharbad ─────────

  test('minor item IS offered as viable play at tapped Tharbad', () => {
    const state = buildMinionSitePhaseState({
      site: THARBAD,
      characters: [GORBAG],
      hand: [SAW_TOOTHED_BLADE],
      siteStatus: CardStatus.Tapped,
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('major item stays NOT viable at tapped Tharbad (rule does not widen subtypes)', () => {
    const state = buildMinionSitePhaseState({
      site: THARBAD,
      characters: [GORBAG],
      hand: [SABLE_SHIELD],
      siteStatus: CardStatus.Tapped,
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  test('minor item is NOT offered at tapped Shrel-Kain (no allow-items-when-tapped)', () => {
    // Shrel-Kain (le-403) also lists minor items but carries no
    // allow-items-when-tapped rule — proves the rule on Tharbad is what
    // enables the play, not the site type or subtype.
    const state = buildMinionSitePhaseState({
      site: SHREL_KAIN,
      characters: [GORBAG],
      hand: [SAW_TOOTHED_BLADE],
      siteStatus: CardStatus.Tapped,
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── Automatic attack: Men — 3 strikes with 6 prowess ─────────────────────

  test('entering Tharbad triggers the Men automatic-attack (3 strikes, prowess 6)', () => {
    const state = setupRingwraithAutoAttack(THARBAD, [GORBAG]);

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('man');
    expect(afterAttack.combat!.strikeProwess).toBe(6);
    expect(afterAttack.combat!.strikesTotal).toBe(3);
    // Ruins-and-lairs: neither the §3.II.2.R1 shadow/dark-hold branch nor a
    // site effect makes this attack detainment.
    expect(afterAttack.combat!.detainment).toBe(false);
  });

  // ─── Movement: Carn Dûm → Tharbad ─────────────────────────────────────────

  test('starter movement from Carn Dûm reaches Tharbad (le-407)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THARBAD as string),
    );
    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Minas Morgul does NOT reach Tharbad (wrong haven)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THARBAD as string),
    );
    expect(starterEntry).toBeUndefined();
  });
});
