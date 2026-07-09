/**
 * @module ba-85.test
 *
 * Card test: Carn Dûm (ba-85)
 * Type: balrog-site (dark-hold) in Angmar
 *
 * Text (authoritative — cards.json BA-85):
 *   Playable: Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Orcs — 4 strikes with 7 prowess
 *     (2nd) Nazgûl (cannot be canceled) — 1 strike with 15 prowess
 *   Special: Creatures keyed to this site attack normally, not as detainment.
 *
 * Rules interpretation: the "Special" line overrides CoE §3.II.2.R1/B1 (which
 * would otherwise make an attack keyed to a Dark-hold detainment against a
 * Ringwraith/Balrog defender) for every creature at this site. Neither printed
 * attack is marked "(detainment)", so the override is unconditional (no filter)
 * and flips the detainment flag off for both of the site's own automatic-attacks
 * and for hazard creatures played normally against a company here.
 *
 * The 2nd (Nazgûl) automatic-attack carries the printed "(cannot be canceled)"
 * clause, encoded as the `cannot-be-canceled` combat rule → `uncancelable` on
 * the resulting combat, so no character may tap to cancel it.
 *
 * Data encoding:
 *   - `playableResources: [minor, major]` — filled this pass (was `[]` in the
 *     imported data despite the printed "Playable" line, the recurring BA-site
 *     empty-playableResources bug).
 *   - `automaticAttacks`: Orcs 4×7, then Nazgûl 1×15 with
 *     `combatRules: ["cannot-be-canceled"]` — filled this pass (was `[]`).
 *   - `site-rule: attacks-not-detainment` with NO filter — all creatures at
 *     this site attack normally (the Special line).
 *   - `unique: true` per cards.json `attributes.unique`.
 *
 * No new engine code: the site is a mirror of the surface-Balrog dark-hold
 * family (Cirith Ungol ba-87, Dol Guldur ba-88, Minas Morgul ba-92) — static
 * automatic-attacks + `cannot-be-canceled` combat rule + unfiltered
 * `attacks-not-detainment`, all already implemented.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                       |
 * |---|-------------------|--------|-------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                                   |
 * | 2 | sitePath          | OK     | [] — surface Balrog site, keyed by region only             |
 * | 3 | nearestHaven      | OK     | "" — Balrog site (haven reached via The Under-gates)       |
 * | 4 | region            | OK     | "Angmar" — correct per card data                           |
 * | 5 | playableResources | OK     | [minor, major] — fixed to match card text this pass        |
 * | 6 | automaticAttacks  | OK     | Orcs 4×7; Nazgûl 1×15 (cannot-be-canceled) — filled        |
 * | 7 | resourceDraws     | OK     | 2                                                          |
 * | 8 | hazardDraws       | OK     | 3                                                          |
 * | 9 | effects           | OK     | attacks-not-detainment (no filter) — added this pass       |
 *
 * Engine Support:
 * | # | Feature                                        | Status          | Notes                                             |
 * |---|------------------------------------------------|-----------------|---------------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED     | select-company, enter-or-skip, play-resources     |
 * | 2 | Item playability (minor + major, not greater)  | IMPLEMENTED     | site.ts enforces playableResources                |
 * | 3 | 1st automatic attack (Orcs 4×7)                | IMPLEMENTED     | static automaticAttacks[0]                        |
 * | 4 | 2nd automatic attack (Nazgûl 1×15)             | IMPLEMENTED     | static automaticAttacks[1]                        |
 * | 5 | Nazgûl attack cannot be canceled               | IMPLEMENTED     | combatRules cannot-be-canceled → uncancelable     |
 * | 6 | Creatures keyed to this site attack normally   | IMPLEMENTED     | attacks-not-detainment (no filter) — all normal   |
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
import type {
  CardDefinitionId, GameState, SitePhaseState, SiteCard,
} from '../../index.js';

const CARN_DUM = 'ba-85' as CardDefinitionId;          // balrog dark-hold under test
const MORIA_HERO = 'tw-413' as CardDefinitionId;       // hero shadow-hold, no attacks-not-detainment (baseline)
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;   // Balrog-specific orc (balrog company member)
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;  // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId;     // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item

/** Balrog company (Crook-legged Orc) at `site` in the site phase, given `hand`. */
function siteWithHand(site: CardDefinitionId, hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site, characters: [CROOK_LEGGED_ORC] }], hand, siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

/**
 * A Balrog company at Carn Dûm sitting at the automatic-attacks step, with the
 * given number of automatic-attacks already resolved (so a `pass` initiates the
 * next one: 0 → Orcs, 1 → Nazgûl).
 */
function balrogAutoAttackStep(resolved: number): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: CARN_DUM, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true, automaticAttacksResolved: resolved }) };
}

describe('Carn Dûm (ba-85)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major playable; greater not) ────────────────

  test('minor item (Strange Rations) is playable at Carn Dûm', () => {
    const plays = viableActions(siteWithHand(CARN_DUM, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at Carn Dûm', () => {
    const plays = viableActions(siteWithHand(CARN_DUM, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at Carn Dûm', () => {
    const plays = viableActions(siteWithHand(CARN_DUM, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── 1st automatic attack: Orcs 4×7, normal (not detainment) ───────────────

  test('Balrog company at Carn Dûm faces the 1st Orcs attack (4×7) normally, not detainment', () => {
    const next = dispatch(balrogAutoAttackStep(0), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('orc');
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(7);
    // The Special line: creatures keyed to this dark-hold attack normally.
    expect(next.combat!.detainment).toBe(false);
    // The Orcs attack has no "(cannot be canceled)" clause.
    expect(next.combat!.uncancelable ?? false).toBe(false);
  });

  // ─── 2nd automatic attack: Nazgûl 1×15, cannot be canceled, not detainment ─

  test('the 2nd Nazgûl attack (1×15) is uncancelable and not detainment', () => {
    const next = dispatch(balrogAutoAttackStep(1), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(15);
    // "(cannot be canceled)" → uncancelable combat (no tap-to-cancel).
    expect(next.combat!.uncancelable).toBe(true);
    // The Special line still applies to the Nazgûl attack.
    expect(next.combat!.detainment).toBe(false);
  });

  // ─── Special rule: creatures keyed to this site attack normally ─────────────

  test('the site\'s dark-hold Orcs auto-attack vs the Balrog company is NOT detainment (direct helper)', () => {
    // Without the override, CoE §3.II.2.B1 would flag the dark-hold auto-attack
    // as detainment against the Balrog defender. The unfiltered
    // attacks-not-detainment override flips it off.
    const siteDef = pool[CARN_DUM as string] as SiteCard;
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

  test('a hazard creature keyed to this Dark-hold vs the Balrog company here is NOT detainment (direct helper)', () => {
    const siteDef = pool[CARN_DUM as string] as SiteCard;
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

  test('control: entering a hero shadow-hold (Moria) with an auto-attack routes through reveal-on-guard-attacks', () => {
    // Regression guard that the site-phase entry flow is exercised by a real
    // auto-attack list (not the empty-list no-combat path).
    const state = siteWithHand(MORIA_HERO, []);
    const entered = { ...state, phaseState: makeSitePhase({ step: 'enter-or-skip', siteEntered: false }) };
    const companyId = entered.players[0].companies[0].id;
    const next = dispatch(entered, { type: 'enter-site', player: PLAYER_1, companyId });
    expect((next.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });
});
