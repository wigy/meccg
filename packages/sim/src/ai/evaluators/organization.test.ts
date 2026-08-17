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

// Great Ship (tw-248): grants a hazard-cancel that only ever fires when the
// target company's site path contains a Coastal Sea region.
const GREAT_SHIP: CardDefinition = {
  id: 'tw-248',
  cardType: 'hero-resource-event',
  eventType: 'short',
} as unknown as CardDefinition;

// Landlocked site (mirrors Isengard, tw-404 — no coastal region in its path).
const ISENGARD: CardDefinition = {
  id: 'tw-404',
  cardType: 'hero-site',
  name: 'Isengard',
  siteType: 'ruins-and-lairs',
  sitePath: ['wilderness', 'border', 'border'],
  playableResources: [],
  resourceDraws: 2,
} as unknown as CardDefinition;

// Another landlocked site (mirrors Wellinghall, tw-437).
const WELLINGHALL: CardDefinition = {
  id: 'tw-437',
  cardType: 'hero-site',
  name: 'Wellinghall',
  siteType: 'free-hold',
  sitePath: ['wilderness', 'wilderness'],
  playableResources: [],
  resourceDraws: 1,
} as unknown as CardDefinition;

// A coastal site (mirrors Dol Amroth's path having a Coastal Sea region).
const COASTAL_SITE: CardDefinition = {
  id: 'coastal',
  cardType: 'hero-site',
  name: 'Coastal Site',
  siteType: 'free-hold',
  sitePath: ['wilderness', 'coastal'],
  playableResources: [],
  resourceDraws: 1,
} as unknown as CardDefinition;

const GREAT_SHIP_POOL: Record<string, CardDefinition> = {
  'tw-248': GREAT_SHIP,
  'tw-404': ISENGARD,
  'tw-437': WELLINGHALL,
  coastal: COASTAL_SITE,
};

function greatShipView(destinationDefId: string | null) {
  return {
    self: {
      hand: [{ instanceId: 'gs1', definitionId: 'tw-248' }],
      siteDeck: [],
      companies: [
        {
          id: 'company-p2-1',
          characters: ['c1'],
          currentSite: { instanceId: 's1', definitionId: 'tw-404', status: 'untapped' },
          destinationSite: destinationDefId
            ? { instanceId: 's2', definitionId: destinationDefId, status: 'untapped' }
            : null,
        },
      ],
    },
  } as unknown as PlayerView;
}

function playGreatShip(targetScoutInstanceId: string): GameAction {
  return {
    type: 'play-short-event',
    player: 'p2',
    cardInstanceId: 'gs1',
    targetScoutInstanceId,
  } as unknown as GameAction;
}

describe('organizationEvaluator Great Ship targeting', () => {
  // Regression: the AI tapped a character to play Great Ship on a company
  // whose current and destination sites are both landlocked (Isengard →
  // Wellinghall), wasting the card since its hazard-cancel can never fire
  // without a Coastal Sea region in the company's path.
  test('scores 0 when neither current nor destination site has a coastal path', () => {
    const view = greatShipView('tw-437');
    const context: AiContext = { view, cardPool: GREAT_SHIP_POOL, legalActions: [playGreatShip('c1')] };
    expect(organizationEvaluator.score(playGreatShip('c1'), context)).toBe(0);
  });

  test('scores positively when the destination site path includes coastal', () => {
    const view = greatShipView('coastal');
    const context: AiContext = { view, cardPool: GREAT_SHIP_POOL, legalActions: [playGreatShip('c1')] };
    expect(organizationEvaluator.score(playGreatShip('c1'), context)).toBeGreaterThan(0);
  });
});

// Halfling Strength (tw-253): can untap OR heal a *hobbit* only, via two
// separate play-options gated on the target's status.
const HALFLING_STRENGTH: CardDefinition = {
  cardType: 'hero-resource-event',
  eventType: 'short',
  effects: [
    { type: 'play-target', target: 'character', filter: { 'target.race': 'hobbit' } },
    {
      type: 'play-option',
      id: 'untap',
      when: { 'target.status': 'tapped' },
      apply: { type: 'set-character-status', status: 'untapped' },
    },
    {
      type: 'play-option',
      id: 'heal',
      when: { $and: [{ 'target.status': 'inverted' }, { phase: 'organization' }] },
      apply: { type: 'set-character-status', status: 'untapped' },
    },
  ],
} as unknown as CardDefinition;

const HOBBIT_CHAR: CardDefinition = { cardType: 'hero-character', race: 'hobbit' } as unknown as CardDefinition;
const MAN_CHAR: CardDefinition = { cardType: 'hero-character', race: 'man' } as unknown as CardDefinition;

const HEAL_ROUTING_POOL: Record<string, CardDefinition> = {
  'tw-253': HALFLING_STRENGTH,
  hobbit: HOBBIT_CHAR,
  man: MAN_CHAR,
  'tw-408': LORIEN,
};

describe('organizationEvaluator plan-movement wounded routing', () => {
  // Regression: a company with three wounded characters, only one of which
  // (a hobbit) can be healed in place by a hand card (Halfling Strength),
  // still needs the haven-routing bonus for the other two wounded characters.
  // hasHealingAvailable must require ALL wounded characters to have a
  // restore source, not just one, or the AI stops steering the whole company
  // toward a haven while two characters remain wounded.
  test('still boosts a haven destination when only one of several wounded characters can heal in place', () => {
    const view = {
      self: {
        hand: [{ instanceId: 'h1', definitionId: 'tw-253' }],
        siteDeck: [{ instanceId: 'lorien', definitionId: 'tw-408' }],
        characters: {
          sam: { instanceId: 'sam', definitionId: 'hobbit', status: 'inverted', items: [] },
          anborn: { instanceId: 'anborn', definitionId: 'man', status: 'inverted', items: [] },
          theoden: { instanceId: 'theoden', definitionId: 'man', status: 'inverted', items: [] },
        },
        companies: [
          { id: 'company-p2-0', characters: ['sam', 'anborn', 'theoden'] },
        ],
      },
    } as unknown as PlayerView;
    const action = planMovement('lorien');
    const context: AiContext = { view, cardPool: HEAL_ROUTING_POOL, legalActions: [action] };
    expect(organizationEvaluator.score(action, context)).toBe(90);
  });
});

// A generic untap event with no target-race restriction (mirrors a card
// like Cram's untap effect, but as a hand card rather than an item).
const GENERIC_UNTAP: CardDefinition = {
  cardType: 'hero-resource-event',
  eventType: 'short',
  effects: [
    {
      type: 'play-option',
      id: 'untap',
      when: { 'target.status': 'tapped' },
      apply: { type: 'set-character-status', status: 'untapped' },
    },
  ],
} as unknown as CardDefinition;

const TAPPED_ROUTING_POOL: Record<string, CardDefinition> = {
  ...POOL,
  'tw-999': GENERIC_UNTAP,
};

describe('organizationEvaluator plan-movement tapped routing', () => {
  // Regression: the AI planned movement for a company carrying a tapped
  // character into a fresh site — exposing it to that site's automatic
  // attack at reduced prowess (CoE rule 3.iv.2: tapped defenders take -1) —
  // with no risk discount at all, unlike the existing wounded-routing logic
  // above (bug report: game msiyueqq-1r0j04, stateSeq 1417 — a tapped
  // Saruman was marched into a site auto-attack for no compensating benefit).
  function tappedView(hand: { instanceId: string; definitionId: string }[]): PlayerView {
    return {
      self: {
        hand,
        siteDeck: [{ instanceId: 's1', definitionId: 'tw-397' }],
        characters: {
          saruman: { instanceId: 'saruman', definitionId: 'man', status: 'tapped', items: [] },
        },
        companies: [
          { id: 'company-p2-0', characters: ['saruman'] },
        ],
      },
    } as unknown as PlayerView;
  }

  test('halves the score when the moving company has a tapped character with no untap source', () => {
    const view = tappedView([{ instanceId: 'h1', definitionId: 'tw-254' }]);
    const action = planMovement('s1');
    const context: AiContext = { view, cardPool: TAPPED_ROUTING_POOL, legalActions: [action] };
    expect(organizationEvaluator.score(action, context)).toBe(20);
  });

  test('keeps the full score when the tapped character has an untap source in hand', () => {
    const view = tappedView([
      { instanceId: 'h1', definitionId: 'tw-254' },
      { instanceId: 'h2', definitionId: 'tw-999' },
    ]);
    const action = planMovement('s1');
    const context: AiContext = { view, cardPool: TAPPED_ROUTING_POOL, legalActions: [action] };
    expect(organizationEvaluator.score(action, context)).toBe(41);
  });
});

describe('organizationEvaluator discard-character', () => {
  // Regression: an unscored discard-character action fell through to the
  // dispatcher's default weight (1), tying it with other weak actions and
  // letting the AI occasionally discard a healthy, undamaged character
  // (e.g. Glorfindel II) for no strategic reason.
  test('scores 0 — never voluntarily discard a character in play', () => {
    const action = { type: 'discard-character', player: 'p2', characterInstanceId: 'p2-102' } as unknown as GameAction;
    const context: AiContext = { view: makeView([]), cardPool: POOL, legalActions: [action] };
    expect(organizationEvaluator.score(action, context)).toBe(0);
  });
});

describe('organizationEvaluator activate-granted-action extra-region-movement', () => {
  // Regression: the AI activated Cram's extra-region-movement grant to reach
  // a site five regions away when five other sites were already legally
  // reachable within the base four-region limit — the flat "hazard removal"
  // weight (8) treated the item's one-time discard as worthwhile regardless
  // of whether the company could already move without it (bug report: game
  // msw40rsq-minsg3, stateSeq 33 — Rivendell to Edhellond via Cram, with
  // Glittering Caves/Isengard/Isle of the Ulond/Lórien/Moria all already
  // reachable for free).
  function extraRegionMovement(characterId: string): GameAction {
    return {
      type: 'activate-granted-action',
      player: 'p2',
      characterId,
      sourceCardId: 'p2-101',
      sourceCardDefinitionId: 'td-105',
      actionId: 'extra-region-movement',
      rollThreshold: 0,
    } as unknown as GameAction;
  }

  function companyView(): PlayerView {
    return {
      self: {
        hand: [],
        siteDeck: [],
        companies: [{ id: 'company-p2-0', characters: ['p2-103'] }],
      },
    } as unknown as PlayerView;
  }

  test('scores 0 when the company can already move without the extra distance', () => {
    const view = companyView();
    const action = extraRegionMovement('p2-103');
    const alreadyLegal = planMovement('s1');
    const context: AiContext = { view, cardPool: POOL, legalActions: [action, alreadyLegal] };
    expect(organizationEvaluator.score(action, context)).toBe(0);
  });

  test('keeps the full weight when the company has no move without the extra distance', () => {
    const view = companyView();
    const action = extraRegionMovement('p2-103');
    const context: AiContext = { view, cardPool: POOL, legalActions: [action] };
    expect(organizationEvaluator.score(action, context)).toBe(8);
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

describe('organizationEvaluator discard-character', () => {
  // Regression: with no case for 'discard-character', the dispatcher's flat
  // default weight (1) made discarding a healthy, useful character as likely
  // as any good play — the AI discarded Anborn (a follower at a haven, so
  // rule 3.22 legally allowed the discard) for no reason (bug report:
  // game msdenbx7-gcyhn5, stateSeq 376). The heuristic has no model of when
  // a voluntary discard is worth it, so it must score 0 until it does.
  function discardCharacter(characterInstanceId: string): GameAction {
    return { type: 'discard-character', player: 'p2', characterInstanceId } as unknown as GameAction;
  }

  test('scores 0 for discarding a character', () => {
    const view = makeView([]);
    const action = discardCharacter('anborn');
    const context: AiContext = { view, cardPool: POOL, legalActions: [action] };
    expect(organizationEvaluator.score(action, context)).toBe(0);
  });
});
