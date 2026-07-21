/**
 * @module le-355.test
 *
 * Card test: Blue Mountain Dwarf-hold (le-355)
 * Type: minion-site (free-hold) · alignment: ringwraith · region: Númeriador
 *
 * Card text:
 *   Nearest Darkhaven: Carn Dûm
 *   Playable: Items (minor, major, greater, gold ring)
 *   Automatic-attacks: Dwarves — 4 strikes with 10 prowess
 *
 * A plain minion Free-hold with no special printed rules — the minion twin of
 * Iron Hill Dwarf-hold (le-383). Everything the card does is structural engine
 * support (site phase flow, item playability gated by `playableResources`, a
 * single static automatic-attack, and haven-path movement from its nearest
 * Darkhaven). No `effects` array is required.
 *
 * Data encoding (filled this pass — the imported data shipped with an empty
 * `playableResources` despite the printed "Items (minor, major, greater, gold
 * ring)", the recurring LE-site data bug; verified against `data/cards.json`
 * LE-355 `attributes.playable`):
 *   - `playableResources: [minor, major, greater, gold-ring]`
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid ({F})                           |
 * | 2 | sitePath          | OK     | [shadow, wilderness, wilderness] ({s}{w}{w})        |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion Darkhaven (le-359)        |
 * | 4 | region            | OK     | "Númeriador"                                        |
 * | 5 | playableResources | OK     | [minor, major, greater, gold-ring] — filled this pass |
 * | 6 | automaticAttacks  | OK     | Dwarves 4 strikes / 10 prowess                      |
 * | 7 | resourceDraws     | OK     | 2                                                   |
 * | 8 | hazardDraws       | OK     | 2                                                   |
 * | 9 | effects           | OK     | none — no special printed rules                     |
 *
 * Engine Support:
 * | # | Feature                                     | Status      | Notes                                          |
 * |---|---------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow                             | IMPLEMENTED | select-company, enter-or-skip, play-resources  |
 * | 2 | Item playability (minor/major/greater/ring) | IMPLEMENTED | site.ts gates on playableResources             |
 * | 3 | Automatic attack (Dwarves 4x10)             | IMPLEMENTED | triggers combat via pass, not detainment       |
 * | 4 | Haven-path movement (Carn Dûm ↔ site)       | IMPLEMENTED | movement-map.ts                                |
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  resetMint, pool,
  buildMinionSitePhaseState, setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import { isSiteCard, buildMovementMap, getReachableSites } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, SiteCard } from '../../index.js';

const BLUE_MOUNTAIN_DWARF_HOLD = 'le-355' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;             // nearest Darkhaven (minion haven)
const SHREL_KAIN = 'le-403' as CardDefinitionId;           // border-hold, playableResources [minor, major] — negative control

// Minion company
const GORBAG = 'le-11' as CardDefinitionId;

// Minion items, one per subtype the site allows
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;      // minor
const SABLE_SHIELD = 'le-341' as CardDefinitionId;         // major
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId;    // greater
const BRIGHT_GOLD_RING = 'le-303' as CardDefinitionId;     // gold-ring ("Free-hold where gold rings are playable")

describe('Blue Mountain Dwarf-hold (le-355)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Dwarves — 4 strikes with 10 prowess ──────────────────

  test('automatic attack is Dwarves — 4 strikes with 10 prowess', () => {
    const state = buildMinionSitePhaseState({ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [GORBAG] });
    const inCombat = dispatch(setupAutoAttackStep(state), { type: 'pass', player: PLAYER_1 });

    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.attackSource.type).toBe('automatic-attack');
    expect(inCombat.combat!.creatureRace).toBe('dwarf');
    expect(inCombat.combat!.strikesTotal).toBe(4);
    expect(inCombat.combat!.strikeProwess).toBe(10);
  });

  test('the Free-hold automatic attack is NOT detainment against the minion company', () => {
    // §3.II.2.B1 only makes Shadow-hold/Dark-hold-keyed attacks detainment against
    // a Ringwraith company. A Free-hold auto-attack is a normal attack.
    const state = buildMinionSitePhaseState({ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [GORBAG] });
    const inCombat = dispatch(setupAutoAttackStep(state), { type: 'pass', player: PLAYER_1 });

    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.detainment).toBe(false);
  });

  // ─── Item playability: minor / major / greater / gold-ring all playable ─────

  test('minor item (Strange Rations) is playable', () => {
    const state = buildMinionSitePhaseState({ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [GORBAG], hand: [STRANGE_RATIONS] });
    const itemId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === STRANGE_RATIONS)!.instanceId;
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource').filter(
      a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === itemId,
    );
    expect(plays.length).toBeGreaterThan(0);
  });

  test('major item (Sable Shield) is playable', () => {
    const state = buildMinionSitePhaseState({ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [GORBAG], hand: [SABLE_SHIELD] });
    const itemId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === SABLE_SHIELD)!.instanceId;
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource').filter(
      a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === itemId,
    );
    expect(plays.length).toBeGreaterThan(0);
  });

  test('greater item (Scroll of Isildur) is playable — the differentiator from most Free-holds', () => {
    const state = buildMinionSitePhaseState({ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [GORBAG], hand: [SCROLL_OF_ISILDUR] });
    const itemId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === SCROLL_OF_ISILDUR)!.instanceId;
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource').filter(
      a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === itemId,
    );
    expect(plays.length).toBeGreaterThan(0);
  });

  test('gold-ring item (Bright Gold Ring — Free-hold where gold rings are playable) is playable', () => {
    const state = buildMinionSitePhaseState({ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [GORBAG], hand: [BRIGHT_GOLD_RING] });
    const itemId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === BRIGHT_GOLD_RING)!.instanceId;
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource').filter(
      a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === itemId,
    );
    expect(plays.length).toBeGreaterThan(0);
  });

  // ─── Negative control: the gate really reads playableResources ──────────────

  test('greater and gold-ring items are NOT playable at a site lacking those subtypes (Shrel-Kain)', () => {
    // Shrel-Kain (le-403) lists only [minor, major]. The same greater / gold-ring
    // items that succeed at Blue Mountain Dwarf-hold are rejected here, proving the
    // playability comes from le-355's playableResources, not the item itself.
    const state = buildMinionSitePhaseState({
      site: SHREL_KAIN, characters: [GORBAG], hand: [SCROLL_OF_ISILDUR, BRIGHT_GOLD_RING],
    });
    const greaterId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === SCROLL_OF_ISILDUR)!.instanceId;
    const ringId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === BRIGHT_GOLD_RING)!.instanceId;

    const greaterPlays = viableActions(state, PLAYER_1, 'play-hero-resource').filter(
      a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === greaterId,
    );
    const ringPlays = viableActions(state, PLAYER_1, 'play-hero-resource').filter(
      a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === ringId,
    );
    expect(greaterPlays).toHaveLength(0);
    expect(ringPlays).toHaveLength(0);
  });

  // ─── Haven-path movement: Carn Dûm ↔ Blue Mountain Dwarf-hold ───────────────

  test('starter movement from Carn Dûm reaches Blue Mountain Dwarf-hold', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (BLUE_MOUNTAIN_DWARF_HOLD as string),
    );
    expect(starter).toBeDefined();
  });

  test('starter movement from Blue Mountain Dwarf-hold reaches Carn Dûm', () => {
    const blueMountain = pool[BLUE_MOUNTAIN_DWARF_HOLD as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, blueMountain, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CARN_DUM as string),
    );
    expect(starter).toBeDefined();
  });
});
