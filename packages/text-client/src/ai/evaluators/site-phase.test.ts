import { describe, test, expect } from 'vitest';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import { sitePhaseEvaluator } from './site-phase.js';
import type { AiContext } from '../strategy.js';

// Isengard (tw-404): a ruins-and-lairs site where major items are playable but
// which carries an automatic-attack — entering with nothing to play only
// exposes the company to that attack.
const ISENGARD: CardDefinition = {
  cardType: 'hero-site',
  name: 'Isengard',
  siteType: 'ruins-and-lairs',
  playableResources: ['minor', 'major', 'gold-ring'],
  sitePath: ['wilderness', 'border', 'border'],
  resourceDraws: 2,
} as unknown as CardDefinition;

// Hauberk of Bright Mail (tw-254): a major item playable at ruins-and-lairs —
// but playing it needs an untapped character to tap.
const HAUBERK: CardDefinition = {
  cardType: 'hero-resource-item',
  subtype: 'major',
  playableAt: ['ruins-and-lairs', 'shadow-hold', 'dark-hold'],
  marshallingPoints: 2,
} as unknown as CardDefinition;

// Halfling Strength (tw-253): untaps a *tapped hobbit*. It is NOT an untap
// source for a company whose only tapped character is a Man.
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
  ],
} as unknown as CardDefinition;

// Isle of the Ulond (td-178): a ruins-and-lairs site that lists only
// information/minor/major items as playable and carries a Dragon
// automatic-attack.
const ISLE_OF_THE_ULOND: CardDefinition = {
  cardType: 'hero-site',
  name: 'Isle of the Ulond',
  siteType: 'ruins-and-lairs',
  playableResources: ['information', 'minor', 'major'],
  sitePath: ['wilderness', 'coastal', 'coastal'],
  resourceDraws: 2,
} as unknown as CardDefinition;

// Scroll of Isildur (tw-323): a *greater* item. Its printed `playableAt`
// lists ruins-and-lairs, but the engine gates item play on the site's
// `playableResources`, which at Isle of the Ulond does not include "greater".
const SCROLL_OF_ISILDUR: CardDefinition = {
  cardType: 'hero-resource-item',
  subtype: 'greater',
  playableAt: ['ruins-and-lairs', 'shadow-hold', 'dark-hold'],
  marshallingPoints: 3,
} as unknown as CardDefinition;

const THEODEN: CardDefinition = {
  cardType: 'hero-character',
  race: 'man',
  skills: ['warrior', 'diplomat'],
} as unknown as CardDefinition;

const HOBBIT: CardDefinition = {
  cardType: 'hero-character',
  race: 'hobbit',
  skills: ['scout'],
} as unknown as CardDefinition;

const POOL: Record<string, CardDefinition> = {
  'tw-404': ISENGARD,
  'td-178': ISLE_OF_THE_ULOND,
  'tw-254': HAUBERK,
  'tw-323': SCROLL_OF_ISILDUR,
  'tw-253': HALFLING_STRENGTH,
  'tw-182': THEODEN,
  hobbit: HOBBIT,
};

/**
 * Build a view: one company at Isle of the Ulond with a single UNTAPPED
 * character, holding only Scroll of Isildur (a greater item). Tapping is not
 * the obstacle here — the site simply does not allow greater items.
 */
function makeScrollView(): PlayerView {
  return {
    self: {
      hand: [{ instanceId: 'h1', definitionId: 'tw-323' }],
      characters: {
        c1: { instanceId: 'c1', definitionId: 'tw-182', status: 'untapped', items: [] },
      },
      companies: [
        {
          id: 'company-p2-0',
          currentSite: { instanceId: 's1', definitionId: 'td-178' },
          characters: ['c1'],
        },
      ],
    },
  } as unknown as PlayerView;
}

/**
 * Build a minimal player view: one company at Isengard with a single tapped
 * character, holding Hauberk (needs a tap to play) and Halfling Strength.
 */
function makeView(characterDefId: string): PlayerView {
  return {
    self: {
      hand: [
        { instanceId: 'h1', definitionId: 'tw-254' },
        { instanceId: 'h2', definitionId: 'tw-253' },
      ],
      characters: {
        c1: { instanceId: 'c1', definitionId: characterDefId, status: 'tapped', items: [] },
      },
      companies: [
        {
          id: 'company-p2-0',
          currentSite: { instanceId: 's1', definitionId: 'tw-404' },
          characters: ['c1'],
        },
      ],
    },
  } as unknown as PlayerView;
}

const ENTER_SITE: GameAction = {
  type: 'enter-site',
  player: 'p2',
  companyId: 'company-p2-0',
} as unknown as GameAction;

describe('sitePhaseEvaluator enter-site', () => {
  // Regression: the AI entered Isengard with a lone tapped Man and only a
  // hobbit-only untap card (Halfling Strength) in hand, then took the site's
  // automatic-attack for no payoff. The item needed an untapped character to
  // play, and Halfling Strength could not untap the Man — so there was nothing
  // to play and the company should not have entered.
  test('scores 0 when the only tap-play needs an untap the hand cannot supply', () => {
    const view = makeView('tw-182'); // Théoden, a Man
    const context: AiContext = { view, cardPool: POOL, legalActions: [ENTER_SITE] };
    expect(sitePhaseEvaluator.score(ENTER_SITE, context)).toBe(0);
  });

  test('scores 50 when the tapped character is a hobbit Halfling Strength can untap', () => {
    const view = makeView('hobbit');
    const context: AiContext = { view, cardPool: POOL, legalActions: [ENTER_SITE] };
    expect(sitePhaseEvaluator.score(ENTER_SITE, context)).toBe(50);
  });

  // Regression (game mruvf51s-a9ge5j, seq 81): the AI entered Isle of the Ulond
  // holding only Scroll of Isildur — a *greater* item whose printed `playableAt`
  // lists ruins-and-lairs, so the old heuristic thought it was playable. But the
  // site lists only information/minor/major, so the engine offered no play and
  // the company just took the Dragon automatic-attack for no payoff. A greater
  // item is not playable at a site that does not list "greater".
  test('scores 0 for a greater item at a site that only allows minor/major items', () => {
    const view = makeScrollView();
    const context: AiContext = { view, cardPool: POOL, legalActions: [ENTER_SITE] };
    expect(sitePhaseEvaluator.score(ENTER_SITE, context)).toBe(0);
  });
});
