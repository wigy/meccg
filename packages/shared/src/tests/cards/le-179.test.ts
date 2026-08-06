/**
 * @module le-179.test
 *
 * Card test: Deeper Shadow (le-179)
 * Type: minion-resource-event (short), alignment ringwraith
 * Keywords: Magic, Shadow-magic
 *
 * Card text:
 *   "Magic. Shadow-magic. Playable during the movement/hazard phase on a
 *    moving shadow-magic-using character. In character's site path, change
 *    a Ruins & Lairs [{R}] to a Shadow-hold [{S}] or one Wilderness [{w}]
 *    to a Shadow-land [{s}]. Alternatively, decrease the hazard limit
 *    against his company by one (to no minimum). Unless he is a
 *    Ringwraith, he makes a corruption check modified by -3."
 *
 * Effects:
 * | # | Effect                                                     | Status | Notes                                          |
 * |---|-------------------------------------------------------------|--------|------------------------------------------------|
 * | 1 | play-target: shadow-magic-using moving character             | OK     | ringwraith race OR shadow-magic skill, moving  |
 * | 2 | play-option change-site-type: R→S when dest is R&L           | OK     | site-type-override attribute-modifier          |
 * | 3 | play-option change-region-type: w→s when path has wilderness | OK     | region-type-override attribute-modifier        |
 * | 4 | play-option decrease-hazard-limit: -1, no minimum            | OK     | hazard-limit-modifier constraint               |
 * | 5 | on-event: enqueue corruption check -3 unless Ringwraith      | OK     | when condition on enqueue-corruption-check     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL, MINAS_TIRITH,
  viableActions, dispatch,
  makeMHState,
  pool,
} from '../test-helpers.js';
import type { PlayShortEventAction } from '../../index.js';
import { RegionType, SiteType, describeAction } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { Alignment } from '../../index.js';

const DEEPER_SHADOW = 'le-179' as CardDefinitionId;

// Ringwraith characters (race=ringwraith → shadow-magic users by default)
const ADUNAPHEL = 'le-50' as CardDefinitionId;   // ringwraith avatar, warrior/scout/diplomat

// Non-Ringwraith shadow-magic user
const CIRYAHER = 'le-6' as CardDefinitionId;     // dunadan scout/sage, has shadow-magic skill

// Minion sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // haven (origin)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // haven (origin)
const ETTENMOORS = 'le-373' as CardDefinitionId;    // ruins-and-lairs, path: shadow+wilderness
const MORIA_MINION = 'le-392' as CardDefinitionId;  // shadow-hold

// Non-minion (hero) character without shadow-magic (to test not-playable cases)
// We use Aragorn (hero) to test that Deeper Shadow can't target non-shadow-magic chars.
// Actually, since this is a minion resource, the resource player must be ringwraith.
// We test non-moving vs moving within the same ringwraith player setup.

describe('Deeper Shadow (le-179)', () => {
  beforeEach(() => resetMint());

  // ── Play restriction: only on moving shadow-magic character ───────────────

  test('not playable when company is not moving (siteRevealed=false)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    // siteRevealed=false: company is NOT moving
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: false,
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Ettenmoors',
      resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
      resolvedSitePathNames: ['Angmar', 'Rhudaur'],
    });

    const playActions = viableActions({ ...state, phaseState: mhState }, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('playable on moving Ringwraith character with ruins-and-lairs destination', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: ETTENMOORS, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Ettenmoors',
      resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
      resolvedSitePathNames: ['Angmar', 'Rhudaur'],
    });

    const playActions = viableActions({ ...state, phaseState: mhState }, PLAYER_1, 'play-short-event');
    // Should offer: change-site-type, change-region-type, decrease-hazard-limit
    expect(playActions.length).toBeGreaterThan(0);
  });

  // ── Bug report (game msgpp1fw-rifeyo, seq 419/420): the legal-action list
  // offered two otherwise-identical play-short-event actions for Deeper
  // Shadow (change-region-type vs decrease-hazard-limit), and describeAction
  // rendered the same text for both — the player could not tell which
  // ability they were about to select. ─────────────────────────────────────

  test('describeAction distinguishes between Deeper Shadow\'s play-option choices', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: ETTENMOORS, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Ettenmoors',
      resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
      resolvedSitePathNames: ['Angmar', 'Rhudaur'],
    });

    const playActions = viableActions({ ...state, phaseState: mhState }, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const optionIds = playActions.map(a => a.optionId);
    expect(optionIds).toEqual(expect.arrayContaining([
      'change-site-type', 'change-region-type', 'decrease-hazard-limit',
    ]));

    const descriptions = playActions.map(a => describeAction(a, pool));
    // Every option must render distinct text — no two options collapse to
    // the same button label.
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(descriptions.some(d => d.includes('change site type'))).toBe(true);
    expect(descriptions.some(d => d.includes('change region type'))).toBe(true);
    expect(descriptions.some(d => d.includes('decrease hazard limit'))).toBe(true);
  });

  test('playable on moving non-ringwraith character with shadow-magic skill (Ciryaher)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: ETTENMOORS, characters: [CIRYAHER] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Ettenmoors',
      resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
      resolvedSitePathNames: ['Angmar', 'Rhudaur'],
    });

    const playActions = viableActions({ ...state, phaseState: mhState }, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThan(0);
  });

  // ── Option availability: change-site-type ────────────────────────────────

  test('change-site-type option offered when destination is ruins-and-lairs', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: ETTENMOORS, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Ettenmoors',
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Angmar'],
    });

    const playActions = viableActions({ ...state, phaseState: mhState }, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const options = playActions.map(a => a.optionId);
    expect(options).toContain('change-site-type');
  });

  test('change-site-type option NOT offered when destination is shadow-hold (not R&L)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: MORIA_MINION, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Shadow, RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth', 'Udûn'],
    });

    const playActions = viableActions({ ...state, phaseState: mhState }, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const options = playActions.map(a => a.optionId);
    expect(options).not.toContain('change-site-type');
  });

  // ── Option availability: change-region-type ───────────────────────────────

  test('change-region-type option offered when path has a wilderness region', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: MORIA_MINION, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Angmar'],
    });

    const playActions = viableActions({ ...state, phaseState: mhState }, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const options = playActions.map(a => a.optionId);
    expect(options).toContain('change-region-type');
  });

  test('change-region-type option NOT offered when path has no wilderness', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: MORIA_MINION, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Shadow, RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth', 'Udûn'],
    });

    const playActions = viableActions({ ...state, phaseState: mhState }, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const options = playActions.map(a => a.optionId);
    expect(options).not.toContain('change-region-type');
  });

  // ── Option availability: decrease-hazard-limit ────────────────────────────

  test('decrease-hazard-limit option always available on moving shadow-magic character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: MORIA_MINION, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    // No wilderness in path, shadow-hold destination → only decrease-hazard-limit
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Shadow, RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth', 'Udûn'],
    });

    const playActions = viableActions({ ...state, phaseState: mhState }, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const options = playActions.map(a => a.optionId);
    expect(options).toContain('decrease-hazard-limit');
  });

  // ── Effect: change-site-type adds site-type-override constraint ───────────

  test('playing change-site-type adds attribute-modifier overriding site type to shadow-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: ETTENMOORS, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Ettenmoors',
      resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
      resolvedSitePathNames: ['Angmar', 'Rhudaur'],
    });
    const stateAtMH = { ...state, phaseState: mhState };

    const playActions = viableActions(stateAtMH, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'change-site-type');
    expect(playActions).toHaveLength(1);

    const after = dispatch(stateAtMH, playActions[0]);

    // Should have added an attribute-modifier for site.type override
    const siteOverride = after.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier'
        && (c.kind as { attribute?: string }).attribute === 'site.type',
    );
    expect(siteOverride).toBeDefined();
    expect((siteOverride!.kind as { value?: string }).value).toBe('shadow-hold');
    expect(after.activeConstraints.some(c => c.scope.kind === 'turn')).toBe(true);
  });

  // ── Effect: change-region-type adds region-type-override constraint ────────

  test('playing change-region-type adds attribute-modifier overriding destination region to shadow', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: MORIA_MINION, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Angmar'],
    });
    const stateAtMH = { ...state, phaseState: mhState };

    const playActions = viableActions(stateAtMH, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'change-region-type');
    expect(playActions).toHaveLength(1);

    const after = dispatch(stateAtMH, playActions[0]);

    const regionOverride = after.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier'
        && (c.kind as { attribute?: string }).attribute === 'region.type',
    );
    expect(regionOverride).toBeDefined();
    expect((regionOverride!.kind as { value?: string }).value).toBe('shadow');
    // Filter should reference the destination region name ('Angmar' — last in path)
    expect(
      ((regionOverride!.kind as { filter?: Record<string, unknown> }).filter ?? {})['region.name'],
    ).toBe('Angmar');
  });

  // ── Effect: decrease-hazard-limit adds hazard-limit-modifier constraint ────

  test('playing decrease-hazard-limit adds hazard-limit-modifier -1 on the company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: MORIA_MINION, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Shadow, RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth', 'Udûn'],
    });
    const stateAtMH = { ...state, phaseState: mhState };

    const playActions = viableActions(stateAtMH, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'decrease-hazard-limit');
    expect(playActions).toHaveLength(1);

    const after = dispatch(stateAtMH, playActions[0]);

    const hlConstraint = after.activeConstraints.find(
      c => c.kind.type === 'hazard-limit-modifier',
    );
    expect(hlConstraint).toBeDefined();
    expect((hlConstraint!.kind as { value: number }).value).toBe(-1);
    expect(hlConstraint!.target.kind).toBe('company');
  });

  // ── Corruption check: enqueued unless target is Ringwraith ────────────────

  test('corruption check modified by -3 enqueued for non-Ringwraith target (Ciryaher)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: MORIA_MINION, characters: [CIRYAHER] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Shadow, RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth', 'Udûn'],
    });
    const stateAtMH = { ...state, phaseState: mhState };

    const playActions = viableActions(stateAtMH, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'decrease-hazard-limit');
    expect(playActions).toHaveLength(1);

    const after = dispatch(stateAtMH, playActions[0]);

    const ccResolutions = after.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check',
    );
    expect(ccResolutions).toHaveLength(1);
    const cc = ccResolutions[0].kind as { modifier?: number };
    expect(cc.modifier).toBe(-3);
  });

  test('no corruption check enqueued for Ringwraith target (Adûnaphel)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, destinationSite: MORIA_MINION, characters: [ADUNAPHEL] }],
          hand: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      siteRevealed: true,
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Shadow, RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth', 'Udûn'],
    });
    const stateAtMH = { ...state, phaseState: mhState };

    const playActions = viableActions(stateAtMH, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'decrease-hazard-limit');
    expect(playActions).toHaveLength(1);

    const after = dispatch(stateAtMH, playActions[0]);

    const ccResolutions = after.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check',
    );
    expect(ccResolutions).toHaveLength(0);
  });
});
