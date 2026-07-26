/**
 * @module ba-84.test
 *
 * Card test: Barad-dûr (ba-84)
 * Type: balrog-site (dark-hold, surface) in Gorgoroth
 *
 * Text:
 *   Playable: Items (minor, major, greater)
 *   Automatic-attacks (3):
 *     (1st) Orcs — 4 strikes with 7 prowess
 *     (2nd) Trolls — 3 strikes with 9 prowess
 *     (3rd) Maia (cannot be canceled) — 1 strike with 24 prowess. Any
 *           character wounded by the Maia's attack is automatically eliminated
 *   Special: Creatures keyed to this site attack normally, not as detainment.
 *
 * Rules interpretation: three fixed printed automatic-attacks (no dynamically
 * played 2nd attack, unlike the Under-deeps ba-98/ba-99). The 3rd (Maia) is
 * "cannot be canceled" (`uncancelable`) and "wound-eliminates" (any wound is an
 * immediate elimination, no body check). The "Special:" line overrides
 * CoE §3.II.2.B1 — which would otherwise make a Dark-hold-keyed attack
 * detainment against the defending Balrog company — for EVERY creature at this
 * site. Barad-dûr's clause carries NO race filter (unlike Shelob's Lair le-402,
 * "Non-Nazgûl creatures …"), so even a Nazgûl attacker keyed here attacks
 * normally.
 *
 * Data encoding (filled this pass — the imported data had empty
 * `playableResources` / `automaticAttacks` despite the printed text, the
 * recurring BA/LE-site bug):
 *   - `playableResources: [minor, major, greater]`
 *   - `automaticAttacks: Orcs 4x7; Trolls 3x9; Maia 1x24 (cannot-be-canceled,
 *     wound-eliminates)`
 *   - `site-rule: attacks-not-detainment` with NO filter (the Special line)
 *   - `unique: true`
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                             |
 * |---|-------------------|--------|---------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                          |
 * | 2 | sitePath          | OK     | [] — surface balrog dark-hold                     |
 * | 3 | nearestHaven      | OK     | "" — surface balrog dark-hold                     |
 * | 4 | region            | OK     | "Gorgoroth"                                        |
 * | 5 | playableResources | OK     | [minor, major, greater] — filled this pass        |
 * | 6 | automaticAttacks  | OK     | Orcs 4x7; Trolls 3x9; Maia 1x24 — filled this pass |
 * | 7 | resourceDraws     | OK     | 2                                                  |
 * | 8 | hazardDraws       | OK     | 4                                                  |
 * | 9 | effects           | OK     | attacks-not-detainment (no filter) — added        |
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                          |
 * |---|------------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED | select-company, enter-or-skip, play-resources  |
 * | 2 | Item playability (minor + major + greater)     | IMPLEMENTED | site.ts enforces playableResources             |
 * | 3 | Three sequential static auto-attacks           | IMPLEMENTED | Orcs, Trolls, Maia in automaticAttacks         |
 * | 4 | Maia cannot-be-canceled                        | IMPLEMENTED | uncancelable suppresses cancel-attack actions  |
 * | 5 | Maia wound-eliminates                          | IMPLEMENTED | wound → immediate elimination, no body check   |
 * | 6 | Creatures keyed here attack normally (no filter)| IMPLEMENTED | attacks-not-detainment overrides §3.II.2.B1     |
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
  viableActions, dispatch, findCharInstanceId,
  runAutoAttackCombat,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType } from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type {
  CardDefinitionId, GameState, SiteCard,
} from '../../index.js';

const BARAD_DUR = 'ba-84' as CardDefinitionId;
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // balrog haven (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc (prowess 3, body 7)
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item

const DARK_HOLD_KEYING = { siteTypes: [SiteType.DarkHold] };

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

/** A Balrog company at Barad-dûr sitting at the automatic-attacks step. */
function balrogAutoAttackStep(resolved: number, hand: CardDefinitionId[] = []): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: BARAD_DUR, characters: [CROOK_LEGGED_ORC] }], hand, siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true, automaticAttacksResolved: resolved }) };
}

describe('Barad-dûr (ba-84)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major + greater all playable) ────────────────

  test('minor item (Strange Rations) is playable at Barad-dûr', () => {
    const plays = viableActions(siteWithHand(BARAD_DUR, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at Barad-dûr', () => {
    const plays = viableActions(siteWithHand(BARAD_DUR, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is playable at Barad-dûr', () => {
    // The differentiator from the Under-deeps sites (ba-98/ba-99): Barad-dûr
    // allows greater items too.
    const plays = viableActions(siteWithHand(BARAD_DUR, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  // ─── Automatic attack 1: Orcs — 4 strikes with 7 prowess ────────────────────

  test('1st automatic attack is Orcs — 4 strikes with 7 prowess, normal (cancelable), not detainment', () => {
    const triggered = dispatch(balrogAutoAttackStep(0), { type: 'pass', player: PLAYER_1 });
    expect(triggered.combat).not.toBeNull();
    expect(triggered.combat!.attackSource.type).toBe('automatic-attack');
    expect(triggered.combat!.creatureRace).toBe('orc');
    expect(triggered.combat!.strikesTotal).toBe(4);
    expect(triggered.combat!.strikeProwess).toBe(7);
    expect(triggered.combat!.uncancelable ?? false).toBe(false);
    expect(triggered.combat!.woundEliminates ?? false).toBe(false);
    // Special line: creature keyed to this site attacks normally, not detainment.
    expect(triggered.combat!.detainment).toBe(false);
  });

  // ─── Automatic attack 2: Trolls — 3 strikes with 9 prowess ──────────────────

  test('2nd automatic attack is Trolls — 3 strikes with 9 prowess, normal (cancelable), not detainment', () => {
    const triggered = dispatch(balrogAutoAttackStep(1), { type: 'pass', player: PLAYER_1 });
    expect(triggered.combat).not.toBeNull();
    expect(triggered.combat!.creatureRace).toBe('troll');
    expect(triggered.combat!.strikesTotal).toBe(3);
    expect(triggered.combat!.strikeProwess).toBe(9);
    expect(triggered.combat!.uncancelable ?? false).toBe(false);
    expect(triggered.combat!.woundEliminates ?? false).toBe(false);
    expect(triggered.combat!.detainment).toBe(false);
  });

  // ─── Automatic attack 3: Maia — 1 strike with 24 prowess ────────────────────

  test('3rd automatic attack is the Maia — 1 strike with 24 prowess, uncancelable, wound-eliminates, not detainment', () => {
    const triggered = dispatch(balrogAutoAttackStep(2), { type: 'pass', player: PLAYER_1 });
    expect(triggered.combat).not.toBeNull();
    expect(triggered.combat!.creatureRace).toBe('maia');
    expect(triggered.combat!.strikesTotal).toBe(1);
    expect(triggered.combat!.strikeProwess).toBe(24);
    expect(triggered.combat!.uncancelable).toBe(true);
    expect(triggered.combat!.woundEliminates).toBe(true);
    expect(triggered.combat!.detainment).toBe(false);
  });

  // ─── Maia: "any character wounded is automatically eliminated" ───────────────

  test('Maia wounds a character → immediately eliminated, no body check', () => {
    // Crook-legged Orc (prowess 3) taps to fight the Maia (24 prowess); the best
    // possible roll (12 → 15) still fails → wounded. wound-eliminates removes the
    // character outright with no body check.
    const state = balrogAutoAttackStep(2);
    const orcId = findCharInstanceId(state, 0, CROOK_LEGGED_ORC);

    const result = runAutoAttackCombat(state, CROOK_LEGGED_ORC, 12, null, true);

    // Combat finalized without ever entering a body-check phase.
    expect(result.state.combat).toBeNull();
    const p0 = result.state.players[0];
    expect(p0.outOfPlayPile.some(c => c.definitionId === (CROOK_LEGGED_ORC as string))).toBe(true);
    expect(p0.characters[orcId]).toBeUndefined();
  });

  // ─── Special: creatures keyed to this site attack normally, not detainment ──

  test('Orcs automatic attack vs the Balrog company is NOT detainment (direct helper)', () => {
    // Without the override, §3.II.2.B1 would flag the site's own dark-hold-keyed
    // auto-attack as detainment against the Balrog defender. The unfiltered
    // attacks-not-detainment override flips it off.
    const siteDef = pool[BARAD_DUR as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.Orc,
      attackKeyedTo: [DARK_HOLD_KEYING],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(false);
  });

  test('hazard creature keyed to Dark-hold vs the Balrog company here is NOT detainment (direct helper)', () => {
    const siteDef = pool[BARAD_DUR as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [DARK_HOLD_KEYING],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('override has NO race filter: even a Nazgûl attacker keyed here is NOT detainment', () => {
    // Contrast with Shelob's Lair (le-402), whose "Non-Nazgûl" clause preserves
    // detainment for Nazgûl. Barad-dûr's clause is unfiltered.
    const siteDef = pool[BARAD_DUR as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'ringwraith' as Race,
      attackKeyedTo: [DARK_HOLD_KEYING],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: the same Dark-hold auto-attack WITHOUT the override IS detainment vs a Balrog defender', () => {
    // Same inputs but no site effects → §3.II.2.B1 fires → detainment. Proves the
    // override is what flips the flag.
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [DARK_HOLD_KEYING],
      defendingAlignment: Alignment.Balrog,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(true);
  });

  test('Balrog company at Barad-dûr faces the 1st Orcs attack normally, not detainment (integration)', () => {
    const next = dispatch(balrogAutoAttackStep(0), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('orc');
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.detainment).toBe(false);
  });

  // ─── Site effects sanity: exactly the unfiltered detainment override ────────

  test('site carries an unfiltered attacks-not-detainment rule', () => {
    const siteDef = pool[BARAD_DUR as string] as SiteCard;
    const rule = (siteDef.effects ?? []).find(
      (e) => e.type === 'site-rule' && (e as { rule?: string }).rule === 'attacks-not-detainment',
    );
    expect(rule).toBeDefined();
    expect((rule as { filter?: unknown }).filter).toBeUndefined();
  });
});
