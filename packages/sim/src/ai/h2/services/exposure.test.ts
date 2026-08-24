/**
 * @module ai/h2/services/exposure.test
 *
 * `exposure` reports facts, and the tests are mostly about the line between a
 * fact and a valuation: the regions crossed are reported, what crossing them
 * costs is not. H1 blurred that line with a hand-tuned `REGION_DANGER` table,
 * and the tuning became invisible inside a destination score.
 */

import { describe, test, expect } from 'vitest';
import { Phase } from '@meccg/shared';
import type { CardDefinition, CompanyId, PlayerView } from '@meccg/shared';
import { computeExposure } from './exposure.js';

const HAVEN = 'tw-haven';
const DEEP = 'tw-deep';
const NOT_A_SITE = 'tw-item';

const POOL = {
  [HAVEN]: { name: 'Rivendell', cardType: 'hero-site', siteType: 'haven', sitePath: [], resourceDraws: 2 },
  [DEEP]: {
    name: 'Dol Guldur',
    cardType: 'hero-site',
    siteType: 'dark-hold',
    sitePath: ['wilderness', 'shadow-land', 'dark-domain'],
    resourceDraws: 0,
  },
  [NOT_A_SITE]: { name: 'A Sword', cardType: 'hero-resource-item' },
} as unknown as Readonly<Record<string, CardDefinition>>;

const COMPANY = 'company' as unknown as CompanyId;

/** A view with one company, optionally moving, optionally in movement/hazard. */
function viewWith(options: {
  readonly current?: string;
  readonly destination?: string;
  readonly opponentHand?: number;
  readonly opponentDiscard?: number;
  readonly movementHazard?: { readonly limitAtReveal: number };
} = {}): PlayerView {
  return {
    self: {
      id: 'p1',
      characters: {},
      companies: [{
        id: 'company',
        characters: [],
        currentSite: options.current ? { instanceId: 's1', definitionId: options.current } : null,
        destinationSite: options.destination ? { instanceId: 's2', definitionId: options.destination } : null,
      }],
      cardsInPlay: [],
    },
    opponent: {
      id: 'p2',
      characters: {},
      cardsInPlay: [],
      companies: [],
      hand: new Array(options.opponentHand ?? 0).fill({ instanceId: 'x', definitionId: 'unknown' }),
      discardPile: new Array(options.opponentDiscard ?? 0).fill({ instanceId: 'y', definitionId: 'unknown' }),
    },
    activePlayer: 'p1',
    activeConstraints: [],
    phaseState: options.movementHazard
      ? {
        phase: Phase.MovementHazard,
        activeCompanyIndex: 0,
        hazardLimitAtReveal: options.movementHazard.limitAtReveal,
        preRevealHazardLimitConstraintIds: [],
      }
      : { phase: Phase.Organization },
  } as unknown as PlayerView;
}

describe('what the opponent can spend', () => {
  test('reports hand and discard sizes', () => {
    const exposure = computeExposure(viewWith({ opponentHand: 7, opponentDiscard: 12 }), POOL);
    expect(exposure.opponentHandSize).toBe(7);
    expect(exposure.opponentDiscardSize).toBe(12);
  });
});

describe('the site path', () => {
  test('reports the regions crossed, in order, without scoring them', () => {
    const site = computeExposure(viewWith(), POOL).siteExposure(DEEP)!;
    expect(site.name).toBe('Dol Guldur');
    expect(site.siteType).toBe('dark-hold');
    expect(site.sitePath).toEqual(['wilderness', 'shadow-land', 'dark-domain']);
    expect(site.pathLength).toBe(3);
    // No danger number anywhere on the result: that valuation belongs to
    // `travel`, in TSD, where it can appear in a rationale.
    expect(Object.keys(site)).toEqual(['name', 'siteType', 'sitePath', 'pathLength', 'resourceDraws']);
  });

  test('a haven has no path and still draws resources', () => {
    const site = computeExposure(viewWith(), POOL).siteExposure(HAVEN)!;
    expect(site.pathLength).toBe(0);
    expect(site.resourceDraws).toBe(2);
  });

  test('is null for a definition that is not a site', () => {
    expect(computeExposure(viewWith(), POOL).siteExposure(NOT_A_SITE)).toBeNull();
    expect(computeExposure(viewWith(), POOL).siteExposure('nope')).toBeNull();
  });

  test('reads where a company stands and where it is going', () => {
    const exposure = computeExposure(viewWith({ current: HAVEN, destination: DEEP }), POOL);
    expect(exposure.currentSite(COMPANY)?.name).toBe('Rivendell');
    expect(exposure.destination(COMPANY)?.name).toBe('Dol Guldur');
  });

  test('reports no destination for a company staying put', () => {
    const exposure = computeExposure(viewWith({ current: HAVEN }), POOL);
    expect(exposure.destination(COMPANY)).toBeNull();
  });
});

describe('the hazard limit', () => {
  test('is the opponent budget during movement/hazard', () => {
    const exposure = computeExposure(viewWith({ movementHazard: { limitAtReveal: 4 } }), POOL);
    expect(exposure.hazardLimit(COMPANY)).toBe(4);
  });

  test('is null outside the phase, where the notion does not apply', () => {
    expect(computeExposure(viewWith(), POOL).hazardLimit(COMPANY)).toBeNull();
  });

  test('belongs only to the company resolving its M/H sub-phase', () => {
    // The phase state carries one hazardLimitAtReveal — the snapshot taken
    // when the ACTIVE company revealed its movement (state-phases.ts). It
    // used to be handed out for whatever company was asked about, so during
    // a 5-character company's move every other company inherited that 5:
    // computeHazardPlan then gave a singleton company five hazard slots
    // instead of the max(size, 2) = 2 it would snapshot, inflating the plan
    // totals that on-guard pricing and card quotes consume. For any company
    // other than the active one the honest answer is null ("not fixed for
    // this company"), which callers already treat as "predict it yourself".
    const view = viewWith({ movementHazard: { limitAtReveal: 5 } });
    (view.self.companies as unknown as unknown[]).push({
      id: 'other', characters: [], currentSite: null, destinationSite: null,
    });
    const exposure = computeExposure(view, POOL);

    expect(exposure.hazardLimit(COMPANY)).toBe(5);
    expect(exposure.hazardLimit('other' as unknown as CompanyId)).toBeNull();
  });
});
