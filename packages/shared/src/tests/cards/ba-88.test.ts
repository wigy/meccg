/**
 * @module ba-88.test
 *
 * Card test: Dol Guldur (ba-88)
 * Type: balrog-site (dark-hold) in Southern Mirkwood
 *
 * Text:
 *   Playable: Information, Items (minor, major)
 *   Automatic-attacks (3):
 *     (1st) Orcs — 3 strikes with 7 prowess
 *     (2nd) Trolls — 2 strikes with 8 prowess
 *     (3rd) Nazgûl (cannot be canceled) — 1 strike with 15 prowess
 *   Special: Creatures keyed to this site attack normally, not as detainment.
 *
 * Rules interpretation: unlike The Under-galleries (ba-99) / The Under-leas
 * (ba-102), Dol Guldur is a *surface* Balrog dark-hold with three FIXED printed
 * automatic-attacks and no dynamically-played 2nd attack. The 3rd (Nazgûl)
 * attack carries "(cannot be canceled)" → an `uncancelable` combat that
 * suppresses every cancel-attack action. The "Special" line overrides
 * CoE §3.II.2.R1/B1 (which would otherwise make an attack keyed to a Dark-hold
 * detainment against a Ringwraith/Balrog defender) for every creature at this
 * site — the site's own automatic-attacks and hazard creatures played normally
 * against a company here alike. None of the three attacks is marked
 * "(detainment)", so the override is unconditional (no filter).
 *
 * Data encoding (filled this pass — the recurring BA-site empty-data bug):
 *   - `playableResources: [information, minor, major]` — was `[]` despite the
 *     printed "Playable" line. "Information" is consumed by the implemented
 *     `site-has-resource` play-condition primitive; item categories (minor,
 *     major) drive item playability directly.
 *   - `automaticAttacks`: Orcs 3×7, Trolls 2×8, Nazgûl 1×15 (cannot-be-canceled)
 *     — was `[]`.
 *   - `site-rule: attacks-not-detainment` with NO filter — the Special line.
 *   - `unique: true` per `attributes.unique` in the card database.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                              |
 * |---|-------------------|--------|--------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                                          |
 * | 2 | sitePath          | OK     | [] — surface Balrog site (matches sibling ba-92 Minas Morgul)     |
 * | 3 | nearestHaven      | OK     | "" — surface Balrog site (matches sibling ba-92)                  |
 * | 4 | region            | OK     | "Southern Mirkwood" — correct per card data                       |
 * | 5 | playableResources | OK     | [information, minor, major] — filled this pass                     |
 * | 6 | automaticAttacks  | OK     | Orcs 3×7, Trolls 2×8, Nazgûl 1×15 (cannot-be-canceled)            |
 * | 7 | resourceDraws     | OK     | 2                                                                   |
 * | 8 | hazardDraws       | OK     | 3                                                                   |
 * | 9 | effects           | OK     | attacks-not-detainment (no filter) — added this pass              |
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                                    |
 * |---|------------------------------------------------|-------------|-----------------------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED | select-company, enter-or-skip, play-resources             |
 * | 2 | Item playability (minor + major)               | IMPLEMENTED | site.ts enforces playableResources                        |
 * | 3 | 1st automatic-attack (Orcs 3×7)                | IMPLEMENTED | fixed automaticAttacks[0]                                 |
 * | 4 | 2nd automatic-attack (Trolls 2×8)             | IMPLEMENTED | fixed automaticAttacks[1]                                 |
 * | 5 | 3rd automatic-attack (Nazgûl 1×15, uncancel.)  | IMPLEMENTED | fixed automaticAttacks[2], combatRules cannot-be-canceled |
 * | 6 | Creatures keyed to this site attack normally   | IMPLEMENTED | attacks-not-detainment (no filter) — all attacks normal   |
 *
 * Playable: YES
 * Certified: 2026-07-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH,
  resetMint, pool,
  buildTestState, makeSitePhase, makeMHState,
  viableActions, dispatch,
  handCardId, companyIdAt,
  playCreatureHazardAndResolve,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType } from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type {
  CardDefinitionId, GameState, SiteCard,
} from '../../index.js';

const DOL_GULDUR = 'ba-88' as CardDefinitionId;
const MORIA_HERO = 'tw-413' as CardDefinitionId; // hero shadow-hold, no attacks-not-detainment (baseline)
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item
const ORC_PATROL = 'tw-074' as CardDefinitionId; // non-unique Orc, keyed to Dark-hold (also Shadow-hold, R&L)

const DARK_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.DarkHold };
const SHADOW_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.ShadowHold };

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
 * A Balrog company at Dol Guldur sitting at the automatic-attacks step, with
 * `attackIndex` of the three printed attacks already resolved (so the next
 * `pass` initiates attack `attackIndex`).
 */
function balrogAutoAttackStep(attackIndex: number): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: DOL_GULDUR, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true, automaticAttacksResolved: attackIndex }) };
}

describe('Dol Guldur (ba-88)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major playable; greater not) ────────────────

  test('minor item (Strange Rations) is playable at Dol Guldur', () => {
    const plays = viableActions(siteWithHand(DOL_GULDUR, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at Dol Guldur', () => {
    const plays = viableActions(siteWithHand(DOL_GULDUR, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at Dol Guldur', () => {
    const plays = viableActions(siteWithHand(DOL_GULDUR, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Three fixed automatic-attacks (Orcs → Trolls → Nazgûl) ────────────────

  test('1st automatic-attack is Orcs, 3 strikes, 7 prowess, not detainment', () => {
    const state = balrogAutoAttackStep(0);
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('orc');
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.detainment).toBe(false);
    // A normal Orc attack (not the Nazgûl) is cancelable.
    expect(next.combat!.uncancelable).not.toBe(true);
  });

  test('2nd automatic-attack is Trolls, 2 strikes, 8 prowess, not detainment', () => {
    const state = balrogAutoAttackStep(1);
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(8);
    expect(next.combat!.detainment).toBe(false);
    expect(next.combat!.uncancelable).not.toBe(true);
  });

  test('3rd automatic-attack is Nazgûl, 1 strike, 15 prowess, cannot be canceled, not detainment', () => {
    const state = balrogAutoAttackStep(2);
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('nazgûl');
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(15);
    expect(next.combat!.detainment).toBe(false);
    // "(cannot be canceled)" → uncancelable combat (no cancel-attack actions).
    expect(next.combat!.uncancelable).toBe(true);
  });

  // ─── Special rule: creatures keyed to this site attack normally ─────────────

  test('site auto-attack keyed to Dark-hold vs the Balrog company is NOT detainment (direct helper)', () => {
    // Without the override, CoE §3.II.2.B1 would flag the site's own dark-hold
    // auto-attack as detainment against the Balrog defender. The unfiltered
    // attacks-not-detainment override (isAutomaticAttack: true) flips it off.
    const siteDef = pool[DOL_GULDUR as string] as SiteCard;
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

  test('hazard creature keyed to Dark-hold vs the Balrog company here is NOT detainment (direct helper)', () => {
    const siteDef = pool[DOL_GULDUR as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: same dark-hold auto-attack WITHOUT the override IS detainment vs a Balrog defender', () => {
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

  test('Balrog company here facing Orc-patrol (Dark-hold keyed): combat.detainment is false (integration)', () => {
    // PLAYER_1 is the Balrog/active player at Dol Guldur. PLAYER_2 (hero/hazard)
    // plays Orc-patrol keyed to Dark-hold — B1 detainment without the site's
    // Special rule. The override forces detainment: false.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: DOL_GULDUR, characters: [CROOK_LEGGED_ORC] }],
          hand: [],
          siteDeck: [THE_UNDER_GATES_BA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.DarkHold,
        destinationSiteName: 'Dol Guldur',
      }),
    };
    const orcPatrolId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, orcPatrolId, companyId, DARK_HOLD_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.creatureRace).toBe('orc');
    expect(afterChain.combat!.detainment).toBe(false);
  });

  test('baseline: same Orc-patrol vs Balrog company at a dark-hold WITHOUT the override IS detainment', () => {
    // Swap Dol Guldur for hero Moria (tw-413) — a shadow-hold with no
    // attacks-not-detainment — to prove the override is what flips the flag.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA_HERO, characters: [CROOK_LEGGED_ORC] }],
          hand: [],
          siteDeck: [THE_UNDER_GATES_BA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
      }),
    };
    const orcPatrolId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, orcPatrolId, companyId, SHADOW_HOLD_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.detainment).toBe(true);
  });
});
