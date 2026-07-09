/**
 * @module ba-87.test
 *
 * Card test: Cirith Ungol (ba-87)
 * Type: balrog-site (dark-hold) in Imlad Morgul
 *
 * Text:
 *   Playable: Items (minor, major)
 *   Automatic-attacks (1): Orcs — 4 strikes with 7 prowess
 *   Special: Creatures keyed to this site attack normally, not as detainment.
 *
 * Rules interpretation: the "Special" line overrides CoE §3.II.2.R1/B1 (which
 * would otherwise make an attack keyed to a Dark-hold/Shadow-hold detainment
 * against a Ringwraith/Balrog defender) for every creature at this site. This
 * is the unfiltered `attacks-not-detainment` override (like The Under-galleries
 * ba-99, unlike The Under-leas ba-102 whose 1st attack is explicitly detainment
 * and therefore carves the override with an `attack.automatic: false` filter).
 * NONE of Cirith Ungol's attacks are detainment: its single printed Orcs
 * automatic-attack has no "(detainment)" marker, so the flag is flipped off both
 * for the site's own automatic-attack and for hazard creatures played normally
 * against a company here.
 *
 * Data encoding:
 *   - `playableResources: [minor, major]` — filled this pass (was `[]` in the
 *     imported data despite the printed "Playable" line, the recurring
 *     BA/LE-site empty-playableResources bug).
 *   - `automaticAttacks: [Orcs 4 strikes / 7 prowess]` — filled this pass.
 *   - `site-rule: attacks-not-detainment` with NO filter — all creatures at
 *     this site attack normally (the Special line).
 *   - `unique: true` per cards.json BA-87.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                             |
 * |---|-------------------|--------|---------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                         |
 * | 2 | sitePath          | OK     | [] — surface balrog dark-hold, no region path    |
 * | 3 | nearestHaven      | OK     | "" — balrog dark-hold                             |
 * | 4 | region            | OK     | "Imlad Morgul"                                     |
 * | 5 | playableResources | OK     | [minor, major] — fixed to match card text         |
 * | 6 | automaticAttacks  | OK     | Orcs, 4 strikes, 7 prowess                        |
 * | 7 | resourceDraws     | OK     | 2                                                  |
 * | 8 | hazardDraws       | OK     | 3                                                  |
 * | 9 | effects           | OK     | attacks-not-detainment (no filter) — added        |
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                          |
 * |---|------------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED | select-company, enter-or-skip, play-resources  |
 * | 2 | Item playability (minor + major, not greater)  | IMPLEMENTED | site.ts enforces playableResources             |
 * | 3 | Automatic attack (Orcs 4x7)                    | IMPLEMENTED | static automaticAttacks entry                  |
 * | 4 | Creatures keyed to this site attack normally   | IMPLEMENTED | attacks-not-detainment (no filter)             |
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
import type { CardDefinitionId, GameState, SiteCard } from '../../index.js';

const CIRITH_UNGOL = 'ba-87' as CardDefinitionId;
const MORIA_HERO = 'tw-413' as CardDefinitionId; // hero shadow-hold, no attacks-not-detainment (baseline)
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc, mind 2
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item
const ORC_PATROL = 'tw-074' as CardDefinitionId; // non-unique Orc, keyed to Dark-hold (also R&L, Shadow-hold)

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

/** A Balrog company at Cirith Ungol, sitting at the automatic-attacks step. */
function balrogAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: CIRITH_UNGOL, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

describe('Cirith Ungol (ba-87)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major playable; greater not) ────────────────

  test('minor item (Strange Rations) is playable at Cirith Ungol', () => {
    const plays = viableActions(siteWithHand(CIRITH_UNGOL, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at Cirith Ungol', () => {
    const plays = viableActions(siteWithHand(CIRITH_UNGOL, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at Cirith Ungol', () => {
    const plays = viableActions(siteWithHand(CIRITH_UNGOL, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Special rule: creatures keyed to this site attack normally ─────────────

  test('the Orcs automatic-attack against the Balrog company is NOT detainment (direct helper)', () => {
    // Without the override, CoE §3.II.2.B1 would flag the site's own dark-hold
    // auto-attack as detainment against the Balrog defender. The unfiltered
    // attacks-not-detainment override (isAutomaticAttack: true) flips it off.
    const siteDef = pool[CIRITH_UNGOL as string] as SiteCard;
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
    const siteDef = pool[CIRITH_UNGOL as string] as SiteCard;
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

  test('Balrog company at Cirith Ungol faces the Orcs attack normally, not detainment (integration)', () => {
    const state = balrogAutoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('orc');
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.detainment).toBe(false);
  });

  test('Balrog company here facing Orc-patrol (Dark-hold keyed): combat.detainment is false (integration)', () => {
    // PLAYER_1 is the Balrog/active player at Cirith Ungol. PLAYER_2 (hero/hazard)
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
          companies: [{ site: CIRITH_UNGOL, characters: [CROOK_LEGGED_ORC] }],
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
        destinationSiteName: 'Cirith Ungol',
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

  test('baseline: same Orc-patrol vs Balrog company at a hold WITHOUT the override IS detainment', () => {
    // Swap Cirith Ungol for hero Moria (tw-413) — a shadow-hold with no
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
