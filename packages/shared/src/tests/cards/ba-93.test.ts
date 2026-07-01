/**
 * @module ba-93.test
 *
 * Card test: Moria (ba-93)
 * Type: balrog-site (haven) in Redhorn Gate
 *
 * Text:
 *   "Any gold ring stored at this site is automatically tested (modify the
 *    roll by -2). Creatures keyed to this site are detainment. If one of
 *    your companies is at this site, all attacks against it are canceled."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                          |
 * |---|-------------------|--------|-------------------------------------------------|
 * | 1 | siteType          | OK     | "haven" — valid                                |
 * | 2 | sitePath          | OK     | Empty (correct for haven)                      |
 * | 3 | nearestHaven      | OK     | Empty (correct for haven)                      |
 * | 4 | region            | OK     | "Redhorn Gate" — valid region in card pool     |
 * | 5 | playableResources | OK     | Empty (correct for haven)                      |
 * | 6 | automaticAttacks  | OK     | Empty (correct for haven)                      |
 * | 7 | resourceDraws     | OK     | 1                                               |
 * | 8 | hazardDraws       | OK     | 1                                               |
 *
 * Engine Support:
 * | # | Feature                            | Status      | Notes                                                    |
 * |---|-------------------------------------|-------------|-----------------------------------------------------------|
 * | 1 | Site phase flow                    | IMPLEMENTED | select-company, enter-or-skip, play-resources             |
 * | 2 | Gold ring auto-test on store        | IMPLEMENTED | site-rule auto-test-gold-ring, rollModifier -2             |
 * | 3 | Creatures keyed to site: detainment | IMPLEMENTED | new site-rule keyed-creatures-detainment (added this pass)|
 * | 4 | Cancel attacks at this site         | IMPLEMENTED | site-rule cancel-attacks marks hazard plays non-viable     |
 *
 * Playable: YES
 * Certified: 2026-07-01
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  resetMint, pool,
  buildTestState, makeSitePhase, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableFor, viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  computeLegalActions, Phase, Alignment, SiteType, RegionType,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { goldRingAutoTestModifier, goldRingAutoTestSiteName } from '../../engine/reducer-organization.js';
import type { SiteCard, CardDefinitionId, GameState } from '../../index.js';
import { Race } from '../../types/common.js';

const MORIA_BA = 'ba-93' as CardDefinitionId;
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc
const WATCHER_IN_THE_WATER = 'tw-110' as CardDefinitionId; // keyedTo includes siteNames: [Moria]
const ORC_PATROL = 'tw-074' as CardDefinitionId; // keyed to Shadow-hold, not to Moria by name

const MORIA_SITE_KEYING = { method: 'site-name' as const, value: 'Moria' };
const DOUBLE_WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };

/** Balrog company at Moria (ba-93) in the site phase, given the hazard player's hand. */
function moriaSitePhase(hand: CardDefinitionId[] = []): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: MORIA_BA, characters: [CROOK_LEGGED_ORC] }], hand, siteDeck: [MORIA_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

describe('Moria (ba-93)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Moria (haven)', () => {
    const state = moriaSitePhase();
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── auto-test-gold-ring engine behavior ────────────────────────────────────

  test('goldRingAutoTestModifier returns -2 for a gold-ring item held by a company at Moria', () => {
    const state = moriaSitePhase();
    const charId = state.players[0].companies[0].characters[0];

    const modifier = goldRingAutoTestModifier(state, state.players[0].companies, charId, 'gold-ring');
    expect(modifier).toBe(-2);
  });

  test('goldRingAutoTestModifier returns null for a non-gold-ring item at Moria', () => {
    const state = moriaSitePhase();
    const charId = state.players[0].companies[0].characters[0];

    const modifier = goldRingAutoTestModifier(state, state.players[0].companies, charId, 'minor');
    expect(modifier).toBeNull();
  });

  test('goldRingAutoTestSiteName resolves to Moria for a company at ba-93', () => {
    const state = moriaSitePhase();
    const charId = state.players[0].companies[0].characters[0];

    expect(goldRingAutoTestSiteName(state, state.players[0].companies, charId)).toBe('Moria');
  });

  test('baseline: no auto-test at a non-Moria site (Rivendell) even for a gold-ring item', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: RIVENDELL, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [MORIA_BA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const charId = state.players[0].companies[0].characters[0];

    expect(goldRingAutoTestModifier(state, state.players[0].companies, charId, 'gold-ring')).toBeNull();
  });

  // ─── keyed-creatures-detainment: direct detainment helper tests ────────────

  test('creature keyed to Moria by name: detainment forced true regardless of defender alignment', () => {
    const moriaDef = pool[MORIA_BA as string] as SiteCard;

    for (const alignment of [Alignment.Wizard, Alignment.Ringwraith, Alignment.FallenWizard, Alignment.Balrog]) {
      const detainment = isDetainmentAttack({
        attackRace: Race.Animal,
        attackKeyedTo: [{ regionTypes: [RegionType.Wilderness, RegionType.Wilderness] }, { siteNames: ['Moria'] }],
        defendingAlignment: alignment,
        defendingSiteEffects: moriaDef.effects,
        defendingSiteName: 'Moria',
      });
      expect(detainment).toBe(true);
    }
  });

  test('baseline: same creature at Moria WITHOUT the site-rule is not forced detainment', () => {
    const detainment = isDetainmentAttack({
      attackRace: Race.Animal,
      attackKeyedTo: [{ siteNames: ['Moria'] }],
      defendingAlignment: Alignment.Wizard,
      defendingSiteName: 'Moria',
    });
    expect(detainment).toBe(false);
  });

  test('baseline: creature at Moria keyed only by region (not by site name) is not forced detainment', () => {
    // The rule only fires for creatures explicitly keyed to the site *by
    // name* — a creature merely present via region/site-type keying does
    // not trigger it, even though it is attacking a company at Moria.
    const moriaDef = pool[MORIA_BA as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Wizard,
      defendingSiteEffects: moriaDef.effects,
      defendingSiteName: 'Moria',
    });
    expect(detainment).toBe(false);
  });

  test('creature keyed to Moria by name at a DIFFERENT site with the same rule is not forced detainment', () => {
    // The site-name match must be against the actual defending site's name,
    // not merely the presence of the rule.
    const moriaDef = pool[MORIA_BA as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Animal,
      attackKeyedTo: [{ siteNames: ['Moria'] }],
      defendingAlignment: Alignment.Wizard,
      defendingSiteEffects: moriaDef.effects,
      defendingSiteName: 'The Under-gates',
    });
    expect(detainment).toBe(false);
  });

  // ─── keyed-creatures-detainment: integration via reducer ───────────────────

  test('Watcher in the Water keyed to Moria (site-name): combat.detainment is true', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA_BA, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Balrog, companies: [{ site: LORIEN, characters: [CROOK_LEGGED_ORC] }], hand: [WATCHER_IN_THE_WATER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.Haven,
        destinationSiteName: 'Moria',
      }),
    };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, watcherId, companyId, MORIA_SITE_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('Watcher in the Water at Moria keyed via double-wilderness: still detainment (creature carries an unconditional Moria siteNames entry)', () => {
    // The "creatures keyed to this site" rule is a property of the attacking
    // creature's full keying list, not of which specific keying alternative
    // was used to satisfy legality this time. Watcher in the Water always
    // carries an unconditional `siteNames: [Moria]` entry alongside its
    // region-type entries, so it is detainment here regardless of the
    // keying method chosen for this particular play.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA_BA, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Balrog, companies: [{ site: LORIEN, characters: [CROOK_LEGGED_ORC] }], hand: [WATCHER_IN_THE_WATER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur', 'Arthedain'],
        destinationSiteType: SiteType.Haven,
        destinationSiteName: 'Moria',
      }),
    };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, watcherId, companyId, DOUBLE_WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.detainment).toBe(true);
  });

  // ─── cancel-attacks engine behavior ─────────────────────────────────────────

  test('hazard creature is non-viable against a Balrog company at Moria', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: MORIA_BA, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const plays = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(mhState, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/canceled at Moria/);
  });

  test('cancel-attacks reason is NOT cited when the target company is at a non-cancel-attacks site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: RIVENDELL, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [MORIA_BA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const plays = computeLegalActions(mhState, PLAYER_2)
      .filter(ea => ea.action.type === 'play-hazard');
    for (const ea of plays) {
      expect(ea.reason ?? '').not.toMatch(/canceled at/);
    }
  });
});
