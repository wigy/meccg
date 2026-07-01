/**
 * @module ba-100.test
 *
 * Card test: The Under-gates (ba-100)
 * Type: balrog-site (haven, under-deeps) in Redhorn Gate — one of the
 * Balrog's two Darkhavens (with Moria)
 *
 * Text:
 *   Adjacent Sites: Moria (0), The Gem-deeps (6), The Sulfur-deeps (6),
 *     The Under-leas (4), The Under-grottos (6)
 *   Any gold ring stored at this site is automatically tested (modify the
 *   roll by -2). Creatures keyed to this site attack as detainment. If one
 *   of your companies is at this site, all attacks against it are canceled.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                        |
 * |---|-------------------|--------|----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "haven" — valid                                               |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path (like ba-103)           |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site (no havenPaths either; adjacentSites is  |
 * |   |                   |        | the Under-deeps movement graph instead)                       |
 * | 4 | region            | OK     | "Redhorn Gate" — matches card data                            |
 * | 5 | playableResources | OK     | [] — matches card text (no Playable: line)                    |
 * | 6 | automaticAttacks  | OK     | [] — matches card text (no Automatic-attacks line)            |
 * | 7 | resourceDraws     | OK     | 1                                                             |
 * | 8 | hazardDraws       | OK     | 1                                                             |
 * | 9 | keywords          | OK     | ["under-deeps"]                                               |
 * |10 | adjacentSites     | OK     | Moria(0), The Gem-deeps(6), The Sulfur-deeps(6),              |
 * |   |                   |        | The Under-leas(4), The Under-grottos(6)                       |
 * |11 | effects           | OK     | auto-test-gold-ring(-2) + attacks-are-detainment +            |
 * |   |                   |        | cancel-attacks — added this pass                              |
 *
 * Engine Support:
 * | # | Feature                              | Status          | Notes                                             |
 * |---|----------------------------------------|-----------------|----------------------------------------------------|
 * | 1 | Site phase flow                       | IMPLEMENTED     | select-company, enter-or-skip, play-resources     |
 * | 2 | No resources playable (haven, empty)  | IMPLEMENTED     | playableResources is empty, no site-rule unlocks  |
 * | 3 | Gold ring auto-test (-2)              | IMPLEMENTED     | site-rule auto-test-gold-ring                     |
 * | 4 | Creatures keyed to this site are      | IMPLEMENTED     | new site-rule attacks-are-detainment, forces      |
 * |   | detainment                            |                 | detainment regardless of race/alignment/keying    |
 * | 5 | Cancel attacks at this site           | IMPLEMENTED     | site-rule cancel-attacks (same as le-367/le-390)  |
 * | 6 | Under-deeps movement roll             | NOT IMPLEMENTED | General rule 3.45; not specific to this card      |
 * |   |                                        |                 | (same precedent as ba-103)                        |
 *
 * Playable: YES
 * Certified: 2026-07-01
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  LORIEN, MINAS_TIRITH, LEGOLAS,
  resetMint, pool,
  buildTestState, makeSitePhase, makeMHState,
  playCreatureHazardAndResolve, handCardId, companyIdAt,
  viableActions, dispatch,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType, computeLegalActions } from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type { SiteCard, CardDefinitionId, GameState, StoreItemAction } from '../../index.js';

const THE_UNDER_GATES = 'ba-100' as CardDefinitionId;
const THE_UNDER_VAULTS = 'ba-103' as CardDefinitionId; // ruins-and-lairs, under-deeps, NO attacks-are-detainment
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;    // Balrog-specific orc
const NAMELESS_THING = 'dm-109' as CardDefinitionId;    // Drake, keyed to any under-deeps site by siteKeyword
const THE_LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId; // minion gold ring, storable by Balrog

const UNDER_DEEPS_KEYING = { method: 'site-keyword' as const, value: 'under-deeps' };

describe('The Under-gates (ba-100)', () => {
  beforeEach(() => resetMint());

  // ─── Structural checks ──────────────────────────────────────────────────────

  test('card data matches printed text (haven, empty playable/attacks, under-deeps keyword)', () => {
    const site = pool[THE_UNDER_GATES as string] as SiteCard;
    expect(site.siteType).toBe('haven');
    expect(site.sitePath).toEqual([]);
    expect(site.nearestHaven).toBe('');
    expect(site.playableResources).toEqual([]);
    expect(site.automaticAttacks).toEqual([]);
    expect(site.resourceDraws).toBe(1);
    expect(site.hazardDraws).toBe(1);
    expect(site.keywords).toEqual(['under-deeps']);
    expect(site.adjacentSites).toEqual({
      Moria: 0,
      'The Gem-deeps': 6,
      'The Sulfur-deeps': 6,
      'The Under-leas': 4,
      'The Under-grottos': 6,
    });
  });

  test('card definition declares all three site rules', () => {
    const site = pool[THE_UNDER_GATES as string] as SiteCard;
    expect(site.effects).toBeDefined();

    const autoTest = site.effects!.find(
      (e): e is { type: 'site-rule'; rule: 'auto-test-gold-ring'; rollModifier: number } =>
        e.type === 'site-rule' && 'rule' in e && e.rule === 'auto-test-gold-ring',
    );
    expect(autoTest).toBeDefined();
    expect(autoTest!.rollModifier).toBe(-2);

    const detainment = site.effects!.find(
      (e): e is { type: 'site-rule'; rule: 'attacks-are-detainment' } =>
        e.type === 'site-rule' && 'rule' in e && e.rule === 'attacks-are-detainment',
    );
    expect(detainment).toBeDefined();

    const cancelAttacks = site.effects!.find(
      (e): e is { type: 'site-rule'; rule: 'cancel-attacks' } =>
        e.type === 'site-rule' && 'rule' in e && e.rule === 'cancel-attacks',
    );
    expect(cancelAttacks).toBeDefined();
  });

  // ─── No resources playable (haven, empty playableResources) ────────────────

  test('no resources playable at The Under-gates', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GATES, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withPhase: GameState = { ...state, phaseState: makeSitePhase() };
    const viable = viableActions(withPhase, PLAYER_1, 'pass');
    expect(viable.length).toBeGreaterThan(0);
    expect(viableActions(withPhase, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ─── Gold ring auto-test (-2) ───────────────────────────────────────────────

  test('The Least of Gold Rings is storable at The Under-gates by a Balrog company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{
            site: THE_UNDER_GATES,
            characters: [{ defId: CROOK_LEGGED_ORC, items: [THE_LEAST_OF_GOLD_RINGS] }],
          }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stores = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item')
      .map(ea => ea.action as StoreItemAction);
    expect(stores).toHaveLength(1);
  });

  test('storing a gold ring at The Under-gates enqueues a gold-ring-test with rollModifier -2', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{
            site: THE_UNDER_GATES,
            characters: [{ defId: CROOK_LEGGED_ORC, items: [THE_LEAST_OF_GOLD_RINGS] }],
          }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const store = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item')
      .map(ea => ea.action as StoreItemAction)[0];
    const afterStore = dispatch(state, store);

    const ringTest = afterStore.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
    expect(ringTest).toBeDefined();
    const kind = ringTest!.kind;
    if (kind.type !== 'gold-ring-test') throw new Error('unreachable');
    expect(kind.rollModifier).toBe(-2);
    expect(kind.goldRingInstanceId).toBe(store.itemInstanceId);
  });

  // ─── Cancel-attacks ──────────────────────────────────────────────────────────

  test('hazard creature (Nameless Thing) is non-viable against a Balrog company at The Under-gates', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GATES, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [NAMELESS_THING], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.Haven,
        destinationSiteName: 'The Under-gates',
      }),
    };

    const plays = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(mhState, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/canceled at The Under-gates/);
  });

  // ─── Attacks-are-detainment ──────────────────────────────────────────────────

  test('unit: attacks-are-detainment forces detainment regardless of race/alignment/keying', () => {
    const detainment = isDetainmentAttack({
      attackRace: 'drake' as Race,
      defendingAlignment: Alignment.Wizard,
      defendingSiteEffects: (pool[THE_UNDER_GATES as string] as SiteCard).effects,
    });
    expect(detainment).toBe(true);
  });

  test('baseline: same Drake attack WITHOUT the site rule is NOT detainment (hero defender)', () => {
    const detainment = isDetainmentAttack({
      attackRace: 'drake' as Race,
      defendingAlignment: Alignment.Wizard,
    });
    expect(detainment).toBe(false);
  });

  test('integration: Nameless Thing attack vs a hero company at The Under-gates is detainment', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: THE_UNDER_GATES, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GATES, characters: [] }], hand: [NAMELESS_THING], siteDeck: [] },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.Haven,
        destinationSiteName: 'The Under-gates',
      }),
    };

    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, UNDER_DEEPS_KEYING);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('drake');
    expect(after.combat!.detainment).toBe(true);
  });

  test('integration baseline: same Nameless Thing attack at The Under-vaults (no override) is NOT detainment vs a hero company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: THE_UNDER_VAULTS, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_VAULTS, characters: [] }], hand: [NAMELESS_THING], siteDeck: [] },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'The Under-vaults',
      }),
    };

    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, UNDER_DEEPS_KEYING);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.detainment).toBe(false);
  });
});
