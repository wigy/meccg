/**
 * @module ba-86.test
 *
 * Card test: Cirith Gorgor (ba-86)
 * Type: balrog-site (dark-hold) in Udûn — a surface site (no under-deeps).
 *
 * Text:
 *   Playable: Items (minor, major, greater)
 *   Automatic-attacks (2):
 *     (1st) Orcs — 5 strikes with 8 prowess
 *     (2nd) Trolls — 2 strikes with 10 prowess
 *   Special: Creatures keyed to this site attack normally, not as detainment.
 *
 * Rules interpretation: the "Special" line overrides CoE §3.II.2.R1/B1 (which
 * would otherwise make an attack keyed to a Dark-hold detainment against a
 * Ringwraith/Balrog defender) for every creature at this site. Both printed
 * automatic-attacks are ordinary attacks (neither is marked "(detainment)")
 * and there is no dynamic/played-auto-attack clause, so the override is
 * unconditional (no filter) — like The Sulfur-deeps (ba-97) and unlike The
 * Under-leas (ba-102), whose 1st attack is explicitly "(detainment)".
 *
 * Data encoding (filled/added this pass):
 *   - `playableResources: [minor, major, greater]` — was `[]` in the imported
 *     data despite the printed "Playable" line (the recurring BA/LE-site
 *     empty-playableResources bug).
 *   - `automaticAttacks: [Orcs 5×8, Trolls 2×10]` — was `[]` despite the
 *     printed "Automatic-attacks (2)" line.
 *   - `unique: true` — matches `attributes.unique` in cards.json.
 *   - `site-rule: attacks-not-detainment` with NO filter — all creatures at
 *     this site attack normally (the Special line).
 *   No new engine code is required: static auto-attacks and the unfiltered
 *   attacks-not-detainment override are already supported.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                          |
 * | 2 | sitePath          | OK     | [] — Balrog surface site                          |
 * | 3 | nearestHaven      | OK     | "" — Balrog surface site                          |
 * | 4 | region            | OK     | "Udûn" — correct per card data                    |
 * | 5 | playableResources | OK     | [minor, major, greater] — fixed this pass         |
 * | 6 | automaticAttacks  | OK     | Orcs 5×8, Trolls 2×10 — filled this pass           |
 * | 7 | resourceDraws     | OK     | 2                                                  |
 * | 8 | hazardDraws       | OK     | 3                                                  |
 * | 9 | effects           | OK     | attacks-not-detainment (no filter) — added this pass |
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                              |
 * |---|------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED | select-company, enter-or-skip, play-resources      |
 * | 2 | Item playability (minor, major, greater)       | IMPLEMENTED | site.ts enforces playableResources                 |
 * | 3 | Automatic attack (1st, static Orcs 5×8)        | IMPLEMENTED | automaticAttacks[0]                                |
 * | 4 | Automatic attack (2nd, static Trolls 2×10)     | IMPLEMENTED | automaticAttacks[1], faced in order               |
 * | 5 | Creatures keyed to this site attack normally   | IMPLEMENTED | attacks-not-detainment (no filter)                 |
 *
 * Playable: YES
 * Certified: 2026-07-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH,
  resetMint, pool,
  buildTestState, makeSitePhase,
  viableActions, dispatch,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType } from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type { CardDefinitionId, GameState, SitePhaseState, SiteCard } from '../../index.js';

const CIRITH_GORGOR = 'ba-86' as CardDefinitionId;
const MORIA_HERO = 'tw-413' as CardDefinitionId; // hero shadow-hold, no attacks-not-detainment (baseline)
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // Balrog haven (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item

/** Balrog company (Crook-legged Orc) at Cirith Gorgor in the site phase, given `hand`. */
function siteWithHand(hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: CIRITH_GORGOR, characters: [CROOK_LEGGED_ORC] }], hand, siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

/** A Balrog company at Cirith Gorgor, sitting at the automatic-attacks step. */
function balrogAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: CIRITH_GORGOR, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

describe('Cirith Gorgor (ba-86)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major + greater all playable) ───────────────

  test('minor item (Strange Rations) is playable at Cirith Gorgor', () => {
    const plays = viableActions(siteWithHand([STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at Cirith Gorgor', () => {
    const plays = viableActions(siteWithHand([SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is playable at Cirith Gorgor', () => {
    const plays = viableActions(siteWithHand([SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  // ─── Automatic-attacks: both static attacks are faced in printed order ──────

  test('1st auto-attack is Orcs, 5 strikes, 8 prowess, faced normally (not detainment)', () => {
    const afterFirst = dispatch(balrogAutoAttackStep(), { type: 'pass', player: PLAYER_1 });
    expect(afterFirst.combat).not.toBeNull();
    expect(afterFirst.combat!.creatureRace).toBe('orc');
    expect(afterFirst.combat!.strikesTotal).toBe(5);
    expect(afterFirst.combat!.strikeProwess).toBe(8);
    expect(afterFirst.combat!.attackSource.type).toBe('automatic-attack');
    // The Special line: creatures keyed to this site attack normally.
    expect(afterFirst.combat!.detainment).toBe(false);
    expect((afterFirst.phaseState as SitePhaseState).automaticAttacksResolved).toBe(1);
  });

  test('2nd auto-attack is Trolls, 2 strikes, 10 prowess, faced normally (not detainment)', () => {
    // Face the first attack, null out combat (simulate its resolution), then
    // pass to trigger the second attack in printed order.
    const afterFirst = dispatch(balrogAutoAttackStep(), { type: 'pass', player: PLAYER_1 });
    const between = { ...afterFirst, combat: null };
    const afterSecond = dispatch(between, { type: 'pass', player: PLAYER_1 });

    expect(afterSecond.combat).not.toBeNull();
    expect(afterSecond.combat!.creatureRace).toBe('troll');
    expect(afterSecond.combat!.strikesTotal).toBe(2);
    expect(afterSecond.combat!.strikeProwess).toBe(10);
    expect(afterSecond.combat!.detainment).toBe(false);
    expect((afterSecond.phaseState as SitePhaseState).automaticAttacksResolved).toBe(2);
  });

  test('company has successfully entered once both auto-attacks are faced', () => {
    const afterFirst = dispatch(balrogAutoAttackStep(), { type: 'pass', player: PLAYER_1 });
    const between = { ...afterFirst, combat: null };
    const afterSecond = dispatch(between, { type: 'pass', player: PLAYER_1 });
    const afterAllFaced = dispatch({ ...afterSecond, combat: null }, { type: 'pass', player: PLAYER_1 });
    expect((afterAllFaced.phaseState as SitePhaseState).siteEntered).toBe(true);
  });

  // ─── Special rule: creatures keyed to this site attack normally ─────────────

  test('site-own Orcs auto-attack vs the Balrog company is NOT detainment (direct helper)', () => {
    // Without the override, CoE §3.II.2.B1 would flag the site's own dark-hold
    // auto-attack as detainment against the Balrog defender. The unfiltered
    // attacks-not-detainment override (isAutomaticAttack: true) flips it off.
    const siteDef = pool[CIRITH_GORGOR as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(false);
  });

  test('a hazard creature keyed to Dark-hold vs the Balrog company here is NOT detainment (direct helper)', () => {
    const siteDef = pool[CIRITH_GORGOR as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Troll,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: the same dark-hold auto-attack WITHOUT the override IS detainment vs a Balrog defender', () => {
    // Same inputs but no site effects → §3.II.2.B1 fires (dark-hold keyed vs
    // Balrog) → detainment. Proves the override is what flips the flag.
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Balrog,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(true);
  });

  test('baseline integration: a Balrog company at hero shadow-hold Moria faces a keyed Orc as detainment', () => {
    // Sanity that the helper's detainment path is real: a dark/shadow-hold
    // keyed attack vs a Balrog defender at a site WITHOUT the override IS
    // detainment. Moria (tw-413) has no attacks-not-detainment.
    const siteDef = pool[MORIA_HERO as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(true);
  });
});
