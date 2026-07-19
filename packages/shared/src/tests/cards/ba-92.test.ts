/**
 * @module ba-92.test
 *
 * Card test: Minas Morgul (ba-92)
 * Type: balrog-site (dark-hold {D}) in Imlad Morgul — a SURFACE site (not
 * under-deeps): no adjacent-sites list, empty sitePath, empty nearestHaven,
 * matching the whole surface balrog-site family (ba-83..ba-88).
 *
 * Text:
 *   Playable: Items (minor, major, greater)
 *   Automatic-attacks (2):
 *     (1st) Undead — 3 strikes with 8 prowess
 *     (2nd) Nazgûl (cannot be canceled) — 1 strike with 15 prowess
 *   Special: Creatures keyed to this site attack normally, not as detainment.
 *
 * Rules interpretation: Minas Morgul carries TWO fixed printed automatic-attacks
 * (unlike its under-deeps cousins ba-97..ba-99, whose 2nd attack is a
 * dynamically-played hazard creature). The 2nd (Nazgûl) attack is flagged
 * "cannot be canceled" → `combatRules: ["cannot-be-canceled"]`, which the
 * reducer translates into `combat.uncancelable`. The Special line
 * ("Creatures keyed to this site attack normally, not as detainment") is the
 * unfiltered `attacks-not-detainment` site-rule: normally a dark-hold-keyed
 * automatic-attack is detainment against a Ringwraith/Balrog defender
 * (§3.II.2.B1), but the override flips it off for BOTH the site's own attacks
 * and any creature keyed here.
 *
 * Data encoding (all filled this pass — the imported card had empty
 * `playableResources`/`automaticAttacks`, no `unique`, no `effects`, the
 * recurring BA-site import bug; cross-checked against `data/cards.json` BA-92):
 *   - `unique: true`
 *   - `playableResources: [minor, major, greater]`
 *   - `automaticAttacks`: Undead (3×8); Nazgûl (1×15, cannot-be-canceled)
 *   - `site-rule: attacks-not-detainment` with NO filter
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                          |
 * | 2 | sitePath          | OK     | [] — surface entry site, no region path           |
 * | 3 | nearestHaven      | OK     | "" — surface balrog site (family convention)      |
 * | 4 | region            | OK     | "Imlad Morgul"                                     |
 * | 5 | playableResources | OK     | [minor, major, greater] — fixed this pass         |
 * | 6 | automaticAttacks  | OK     | Undead 3×8; Nazgûl 1×15 cannot-be-canceled        |
 * | 7 | resourceDraws     | OK     | 2                                                  |
 * | 8 | hazardDraws       | OK     | 4                                                  |
 * | 9 | unique            | OK     | true — added this pass                             |
 * | 10| effects           | OK     | attacks-not-detainment (no filter)                |
 *
 * Engine Support:
 * | # | Feature                                     | Status      | Notes                                            |
 * |---|---------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | Site phase flow                             | IMPLEMENTED | select-company, enter-or-skip, play-resources    |
 * | 2 | Item playability (minor + major + greater)  | IMPLEMENTED | site.ts enforces playableResources               |
 * | 3 | 1st fixed auto-attack (Undead 3×8)          | IMPLEMENTED | automaticAttacks[0]                              |
 * | 4 | 2nd fixed auto-attack (Nazgûl 1×15)         | IMPLEMENTED | automaticAttacks[1], sequential                  |
 * | 5 | cannot-be-canceled → combat.uncancelable    | IMPLEMENTED | combatRules; reducer-site.ts                     |
 * | 6 | attacks-not-detainment override (no filter) | IMPLEMENTED | detainment.ts — all attacks normal              |
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
import { Phase, Alignment } from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import { SiteType } from '../../index.js';
import type {
  CardDefinitionId, GameState, SitePhaseState, SiteCard,
} from '../../index.js';

const MINAS_MORGUL = 'ba-92' as CardDefinitionId;
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item

/** Balrog company (Crook-legged Orc) at Minas Morgul in the site phase, given `hand`. */
function siteWithHand(hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: MINAS_MORGUL, characters: [CROOK_LEGGED_ORC] }], hand, siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

/**
 * A Balrog company at Minas Morgul sitting at the automatic-attacks step, with
 * `automaticAttacksResolved` set so the next `pass` fires attack #`resolved`.
 */
function autoAttackStep(resolved: number): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: MINAS_MORGUL, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return {
    ...state,
    phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true, automaticAttacksResolved: resolved }),
  };
}

describe('Minas Morgul (ba-92)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major + greater all playable) ────────────────

  test('minor item (Strange Rations) is playable at Minas Morgul', () => {
    const plays = viableActions(siteWithHand([STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at Minas Morgul', () => {
    const plays = viableActions(siteWithHand([SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) IS playable at Minas Morgul', () => {
    // Unlike the under-deeps cousins (minor/major only), Minas Morgul allows greater.
    const plays = viableActions(siteWithHand([SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  // ─── 1st automatic-attack: Undead 3×8, normal (not detainment) ──────────────

  test('1st automatic attack fires the Undead attack (3 strikes, 8 prowess), NOT detainment', () => {
    const next = dispatch(autoAttackStep(0), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('undead');
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(8);
    // Special line: the dark-hold-keyed auto-attack vs the Balrog defender is
    // normally detainment (§3.II.2.B1); the override flips it off.
    expect(next.combat!.detainment).toBe(false);
    // The 1st attack is cancelable (no cannot-be-canceled marker).
    expect(next.combat!.uncancelable).toBeFalsy();
  });

  // ─── 2nd automatic-attack: Nazgûl 1×15, cannot be canceled, not detainment ──

  test('2nd automatic attack fires the Nazgûl attack (1 strike, 15 prowess) and CANNOT be canceled', () => {
    const next = dispatch(autoAttackStep(1), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(15);
    // "(cannot be canceled)" → combatRules translated to combat.uncancelable.
    expect(next.combat!.uncancelable).toBe(true);
    // Override applies to this attack too.
    expect(next.combat!.detainment).toBe(false);
  });

  // ─── attacks-not-detainment override: direct helper + baseline ──────────────

  test('dark-hold auto-attack vs the Balrog company is NOT detainment (override, direct helper)', () => {
    const siteDef = pool[MINAS_MORGUL as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.Undead,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: the same dark-hold auto-attack WITHOUT the override IS detainment vs a Balrog defender', () => {
    // Drop the site effects → §3.II.2.B1 dark-hold keyed vs Balrog → detainment.
    // Proves the attacks-not-detainment override is what flips the flag off.
    const detainment = isDetainmentAttack({
      attackEffects: [],
      attackRace: Race.Undead,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: [],
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(true);
  });

  // ─── Sequential attacks: 1st then 2nd, ordered ──────────────────────────────

  test('the two automatic-attacks are distinct and ordered: Undead (index 0) then Nazgûl (index 1)', () => {
    const first = dispatch(autoAttackStep(0), { type: 'pass', player: PLAYER_1 });
    expect(first.combat!.creatureRace).toBe('undead');
    expect((first.phaseState as SitePhaseState).automaticAttacksResolved).toBe(1);

    const second = dispatch(autoAttackStep(1), { type: 'pass', player: PLAYER_1 });
    expect(second.combat!.strikeProwess).toBe(15);
    expect((second.phaseState as SitePhaseState).automaticAttacksResolved).toBe(2);
  });
});
