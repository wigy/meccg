import { describe, test, expect } from 'vitest';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import { organizationEvaluator } from './organization.js';
import { hasDirectlyPlayableMovement } from './common.js';
import type { AiContext } from '../strategy.js';

// A major hero item playable only at ruins-and-lairs / shadow-hold / dark-hold
// sites (mirrors Hauberk of Bright Mail, tw-254).
const HAUBERK: CardDefinition = {
  cardType: 'hero-resource-item',
  subtype: 'major',
  playableAt: ['ruins-and-lairs', 'shadow-hold', 'dark-hold'],
  marshallingPoints: 2,
} as unknown as CardDefinition;

// A ruins-and-lairs site where the item can be played (mirrors Glittering
// Caves, tw-397).
const GLITTERING_CAVES: CardDefinition = {
  cardType: 'hero-site',
  name: 'Glittering Caves',
  siteType: 'ruins-and-lairs',
  playableResources: ['minor', 'major'],
  sitePath: [],
  resourceDraws: 2,
} as unknown as CardDefinition;

// A haven where the item cannot be played (mirrors Lórien, tw-408).
const LORIEN: CardDefinition = {
  cardType: 'hero-site',
  name: 'Lórien',
  siteType: 'haven',
  playableResources: [],
  sitePath: [],
  resourceDraws: 2,
} as unknown as CardDefinition;

const POOL: Record<string, CardDefinition> = {
  'tw-254': HAUBERK,
  'tw-397': GLITTERING_CAVES,
  'tw-408': LORIEN,
};

/** Build a minimal player view holding the item and a site deck. */
function makeView(siteDeck: { instanceId: string; definitionId: string }[]): PlayerView {
  return {
    self: {
      hand: [{ instanceId: 'h1', definitionId: 'tw-254' }],
      siteDeck,
      companies: [],
    },
  } as unknown as PlayerView;
}

function planMovement(destinationSite: string): GameAction {
  return { type: 'plan-movement', player: 'p2', companyId: 'company-p2-0', destinationSite } as unknown as GameAction;
}

const PASS: GameAction = { type: 'pass', player: 'p2' } as unknown as GameAction;

describe('hasDirectlyPlayableMovement', () => {
  test('true when a plan-movement targets a site where a hand resource can be played', () => {
    const view = makeView([{ instanceId: 's1', definitionId: 'tw-397' }]);
    const actions: GameAction[] = [planMovement('s1'), PASS];
    expect(hasDirectlyPlayableMovement(view, POOL, actions)).toBe(true);
  });

  test('false when the only reachable destination cannot host any hand resource', () => {
    const view = makeView([{ instanceId: 's2', definitionId: 'tw-408' }]);
    const actions: GameAction[] = [planMovement('s2'), PASS];
    expect(hasDirectlyPlayableMovement(view, POOL, actions)).toBe(false);
  });

  test('false when no plan-movement is offered', () => {
    const view = makeView([{ instanceId: 's1', definitionId: 'tw-397' }]);
    const actions: GameAction[] = [PASS];
    expect(hasDirectlyPlayableMovement(view, POOL, actions)).toBe(false);
  });
});

describe('organizationEvaluator pass suppression', () => {
  // Regression: a healthy company holding a playable item passed the
  // organization phase instead of declaring movement to a site where the
  // item could be played. Pass must score 0 when such a move is available.
  test('pass scores 0 when a productive movement is available', () => {
    const view = makeView([{ instanceId: 's1', definitionId: 'tw-397' }]);
    const context: AiContext = { view, cardPool: POOL, legalActions: [planMovement('s1'), PASS] };
    expect(organizationEvaluator.score(PASS, context)).toBe(0);
  });

  test('pass keeps its moderate weight when no productive movement is available', () => {
    const view = makeView([{ instanceId: 's2', definitionId: 'tw-408' }]);
    const context: AiContext = { view, cardPool: POOL, legalActions: [planMovement('s2'), PASS] };
    expect(organizationEvaluator.score(PASS, context)).toBe(5);
  });
});
