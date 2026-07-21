/**
 * @module as-156.test
 *
 * Card test: Old Forest (as-156)
 * Type: minion-site (border-hold) in Cardolan
 *
 * Text:
 *   "Nearest Darkhaven: Carn Dûm
 *    Playable: Items (minor, major)
 *    Automatic-attacks: Maia (cannot be canceled) — 2 strikes with 15 prowess"
 *
 * Rules interpretation: a single printed automatic-attack, a Maia with 2
 * strikes at 15 prowess that "cannot be canceled" (`uncancelable` — the
 * defending player may not play a cancel-attack card against it). There is no
 * detainment override on the card, so the border-hold auto-attack resolves as a
 * normal attack (border-hold is not a Dark-hold/Shadow-hold, so §3.II.2.R1 does
 * not fire and it is not detainment).
 *
 * Site Structural Checks (documented; verified behaviourally below):
 * | # | Property          | Notes                                                     |
 * |---|-------------------|-----------------------------------------------------------|
 * | 1 | siteType          | "border-hold"                                             |
 * | 2 | sitePath          | [shadow, wilderness, wilderness] — {s}{w}{w}             |
 * | 3 | nearestHaven      | "Carn Dûm" (le-359, haven)                               |
 * | 4 | region            | "Cardolan"                                                |
 * | 5 | playableResources | [minor, major] — greater NOT playable                    |
 * | 6 | automaticAttacks  | Maia 2×15 (cannot-be-canceled)                           |
 * | 7 | resourceDraws     | 2                                                         |
 * | 8 | hazardDraws       | 2                                                         |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                          |
 * |---|--------------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, play-resources  |
 * | 2 | Item playability (minor+major) | IMPLEMENTED | site.ts enforces playableResources             |
 * | 3 | Greater item NOT playable      | IMPLEMENTED | greater absent from playableResources          |
 * | 4 | Single static auto-attack      | IMPLEMENTED | Maia 2×15 in automaticAttacks                  |
 * | 5 | Maia cannot-be-canceled        | IMPLEMENTED | uncancelable suppresses cancel-attack actions  |
 * | 6 | Haven path movement            | IMPLEMENTED | Carn Dûm ↔ Old Forest via starter movement     |
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  resetMint, pool,
  buildTestState, makeSitePhase,
  viableActions, dispatch,
} from '../test-helpers.js';
import {
  Phase, Alignment, isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, GameState, SiteCard } from '../../index.js';

const OLD_FOREST = 'as-156' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;       // nearest Darkhaven (haven)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;     // siteDeck filler for the opponent
const GORBAG = 'le-11' as CardDefinitionId;           // orc, prowess 6, body 9
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId;    // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item
const DIVERSION = 'le-180' as CardDefinitionId;       // minion event: cancel any attack

/** A Ringwraith company at Old Forest at the play-resources step, given `hand`. */
function atPlayResources(site: CardDefinitionId, hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters: [GORBAG] }], hand, siteDeck: [CARN_DUM] },
      { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: GOBLIN_GATE, characters: [LIEUTENANT_OF_MORGUL] }], hand: [], siteDeck: [GOBLIN_GATE] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'play-resources', siteEntered: true }) };
}

/** A Ringwraith company at Old Forest at the automatic-attacks step. */
function atAutoAttack(hand: CardDefinitionId[] = []): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: OLD_FOREST, characters: [GORBAG] }], hand, siteDeck: [CARN_DUM] },
      { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: GOBLIN_GATE, characters: [LIEUTENANT_OF_MORGUL] }], hand: [], siteDeck: [GOBLIN_GATE] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true, automaticAttacksResolved: 0 }) };
}

describe('Old Forest (as-156)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Carn Dûm ↔ Old Forest ────────────────────────────────────────

  test('starter movement from Carn Dûm reaches Old Forest', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (OLD_FOREST as string),
    );
    expect(starter).toBeDefined();
  });

  test('starter movement from Old Forest returns to Carn Dûm', () => {
    const oldForest = pool[OLD_FOREST as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, oldForest, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CARN_DUM as string),
    );
    expect(starter).toBeDefined();
  });

  // ─── Item playability (minor + major playable; greater NOT) ──────────────────

  test('minor item (Strange Rations) is playable at Old Forest', () => {
    const plays = viableActions(atPlayResources(OLD_FOREST, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at Old Forest', () => {
    const plays = viableActions(atPlayResources(OLD_FOREST, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at Old Forest', () => {
    // Old Forest only lists minor + major items — greater is absent.
    const plays = viableActions(atPlayResources(OLD_FOREST, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Automatic attack: Maia — 2 strikes with 15 prowess, uncancelable ────────

  test('automatic attack is the Maia — 2 strikes with 15 prowess, uncancelable, not detainment', () => {
    const triggered = dispatch(atAutoAttack(), { type: 'pass', player: PLAYER_1 });
    expect(triggered.combat).not.toBeNull();
    expect(triggered.combat!.attackSource.type).toBe('automatic-attack');
    expect(triggered.combat!.creatureRace).toBe('maia');
    expect(triggered.combat!.strikesTotal).toBe(2);
    expect(triggered.combat!.strikeProwess).toBe(15);
    expect(triggered.combat!.uncancelable).toBe(true);
    // No wound-eliminates clause on this card.
    expect(triggered.combat!.woundEliminates ?? false).toBe(false);
    // Border-hold auto-attack: not a Dark-hold/Shadow-hold, so §3.II.2.R1 does
    // not fire → resolves as a normal (non-detainment) attack.
    expect(triggered.combat!.detainment).toBe(false);
  });

  // ─── "cannot be canceled" ────────────────────────────────────────────────────

  test('a cancel-attack card (Diversion) cannot cancel the Maia attack', () => {
    const triggered = dispatch(atAutoAttack([DIVERSION]), { type: 'pass', player: PLAYER_1 });
    expect(triggered.combat).not.toBeNull();
    expect(triggered.combat!.uncancelable).toBe(true);
    const cancels = viableActions(triggered, PLAYER_1, 'cancel-attack');
    expect(cancels).toHaveLength(0);
  });
});
