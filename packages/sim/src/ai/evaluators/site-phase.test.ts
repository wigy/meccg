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

// Glittering Caves (tw-397): a ruins-and-lairs site guarded by a 9-prowess
// automatic-attack (Púkel-creature, 1 strike).
const GLITTERING_CAVES: CardDefinition = {
  cardType: 'hero-site',
  name: 'Glittering Caves',
  siteType: 'ruins-and-lairs',
  playableResources: ['minor', 'major'],
  sitePath: ['wilderness', 'border', 'border'],
  resourceDraws: 2,
  automaticAttacks: [{ creatureType: 'Púkel-creature', strikes: 1, prowess: 9 }],
} as unknown as CardDefinition;

// Sapling of the White Tree (tw-322): a 1-MP major item playable at
// ruins-and-lairs sites.
const SAPLING_OF_THE_WHITE_TREE: CardDefinition = {
  cardType: 'hero-resource-item',
  subtype: 'major',
  playableAt: ['ruins-and-lairs'],
  marshallingPoints: 1,
} as unknown as CardDefinition;

// A Malady Without Healing (le-159): a shadow-magic short event playable
// during the site phase, targeting a character on either side (`targetScope:
// any-player`) with a corruption-check orchestrator.
const MALADY_WITHOUT_HEALING: CardDefinition = {
  cardType: 'minion-resource-event',
  eventType: 'short',
  effects: [
    { type: 'play-window', phase: 'site' },
    { type: 'play-target', target: 'character', targetScope: 'any-player' },
    {
      type: 'on-event',
      event: 'self-enters-play',
      apply: { type: 'malady-without-healing', targetCorruptionModifier: -1, casterCorruptionModifier: -5 },
    },
  ],
} as unknown as CardDefinition;

// Mount Gram (tw-415): a shadow-hold site with a 6-prowess automatic-attack
// (not hard enough to force a tap on its own — the regression below must be
// caught by the tapped-company check, not the automatic-attack-forces-tap one).
const MOUNT_GRAM: CardDefinition = {
  cardType: 'hero-site',
  name: 'Mount Gram',
  siteType: 'shadow-hold',
  playableResources: ['minor', 'major'],
  sitePath: ['wilderness', 'shadow'],
  resourceDraws: 2,
  automaticAttacks: [{ creatureType: 'Orcs', strikes: 3, prowess: 6 }],
} as unknown as CardDefinition;

// Mount Gundabad (tw-416): a shadow-hold with an 8-prowess Orc automatic-attack.
const MOUNT_GUNDABAD: CardDefinition = {
  cardType: 'hero-site',
  name: 'Mount Gundabad',
  siteType: 'shadow-hold',
  playableResources: ['minor', 'major', 'greater'],
  sitePath: ['wilderness', 'border', 'dark'],
  resourceDraws: 2,
  automaticAttacks: [{ creatureType: 'Orcs', strikes: 2, prowess: 8 }],
} as unknown as CardDefinition;

// Rescue Prisoners (tw-315): a permanent resource event playable "at an
// already tapped Dark-hold or Shadow-hold" (play-target: site +
// tapped-site-only play-flag). It also attaches to a character the same way
// an item does — tapping one on success, or discarding itself for nothing if
// no character is left untapped after its own triggered Spider attack. It is
// not a "no tap needed" play.
const RESCUE_PRISONERS: CardDefinition = {
  cardType: 'hero-resource-event',
  eventType: 'permanent',
  marshallingPoints: 0,
  effects: [
    { type: 'play-target', target: 'site', filter: { siteType: { $in: ['dark-hold', 'shadow-hold'] } } },
    { type: 'play-flag', flag: 'tapped-site-only' },
    { type: 'play-target', target: 'character' },
    { type: 'play-flag', flag: 'bearer-cannot-untap-until-stored' },
    { type: 'play-flag', flag: 'rescues-prisoners' },
  ],
} as unknown as CardDefinition;

// People Diminished (ba-72): a permanent resource event playable on an
// *untapped* Free-hold or Border-hold. It binds no character, so it is a
// genuine "no tap needed" play — gated only by the site-target filter and the
// `untapped-site-required` play-flag.
const PEOPLE_DIMINISHED: CardDefinition = {
  cardType: 'minion-resource-event',
  eventType: 'permanent',
  marshallingPoints: 5,
  effects: [
    { type: 'play-target', target: 'site', filter: { siteType: { $in: ['free-hold', 'border-hold'] } } },
    { type: 'play-flag', flag: 'untapped-site-required' },
  ],
} as unknown as CardDefinition;

// Buhr Widu (le-357): a border-hold with no automatic-attack — entering is
// only ever justified by having something to play there.
const BUHR_WIDU: CardDefinition = {
  cardType: 'hero-site',
  name: 'Buhr Widu',
  siteType: 'border-hold',
  playableResources: ['minor', 'major'],
  sitePath: ['wilderness'],
  resourceDraws: 2,
} as unknown as CardDefinition;

const BALIN: CardDefinition = {
  cardType: 'hero-character',
  race: 'dwarf',
  skills: ['warrior'],
} as unknown as CardDefinition;

const POOL: Record<string, CardDefinition> = {
  'tw-404': ISENGARD,
  'td-178': ISLE_OF_THE_ULOND,
  'tw-254': HAUBERK,
  'tw-323': SCROLL_OF_ISILDUR,
  'tw-253': HALFLING_STRENGTH,
  'tw-182': THEODEN,
  'tw-397': GLITTERING_CAVES,
  'tw-322': SAPLING_OF_THE_WHITE_TREE,
  'le-159': MALADY_WITHOUT_HEALING,
  'tw-415': MOUNT_GRAM,
  'tw-416': MOUNT_GUNDABAD,
  'tw-315': RESCUE_PRISONERS,
  'tw-123': BALIN,
  'ba-72': PEOPLE_DIMINISHED,
  'le-357': BUHR_WIDU,
  hobbit: HOBBIT,
};

/**
 * Build a view with one company of a single character, plus an opponent
 * character, for the Malady Without Healing self-targeting regression.
 */
function makeMaladyView(): PlayerView {
  return {
    self: {
      hand: [{ instanceId: 'h1', definitionId: 'le-159' }],
      characters: {
        c1: { instanceId: 'c1', definitionId: 'tw-182', status: 'untapped', items: [] },
      },
      companies: [
        {
          id: 'company-p2-0',
          currentSite: { instanceId: 's1', definitionId: 'tw-404' },
          characters: ['c1'],
        },
      ],
    },
    opponent: {
      characters: {
        o1: { instanceId: 'o1', definitionId: 'tw-182', status: 'untapped', items: [] },
      },
    },
  } as unknown as PlayerView;
}

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

/**
 * Build a view for the Rescue Prisoners regression: a company of one
 * already-tapped character (Balin) at a shadow-hold site, holding only
 * Rescue Prisoners.
 */
function makeTappedCompanyRescuePrisonersView(): PlayerView {
  return {
    self: {
      hand: [{ instanceId: 'h1', definitionId: 'tw-315' }],
      characters: {
        c1: { instanceId: 'c1', definitionId: 'tw-123', status: 'tapped', items: [], effectiveStats: { prowess: 4 } },
      },
      companies: [
        {
          id: 'company-p2-0',
          currentSite: { instanceId: 's1', definitionId: 'tw-415' },
          characters: ['c1'],
        },
      ],
    },
  } as unknown as PlayerView;
}

/**
 * Build a view for the Glittering Caves regression: a company of weak
 * characters (best prowess 5) holding one playable 1-MP item, entering a
 * site guarded by a 9-prowess automatic-attack.
 */
function makeGlitteringCavesView(bestProwess: number): PlayerView {
  return {
    self: {
      hand: [{ instanceId: 'h1', definitionId: 'tw-322' }],
      characters: {
        c1: { instanceId: 'c1', definitionId: 'tw-182', status: 'untapped', items: [], effectiveStats: { prowess: bestProwess } },
        c2: { instanceId: 'c2', definitionId: 'tw-182', status: 'untapped', items: [], effectiveStats: { prowess: 1 } },
      },
      companies: [
        {
          id: 'company-p2-0',
          currentSite: { instanceId: 's1', definitionId: 'tw-397' },
          characters: ['c1', 'c2'],
        },
      ],
    },
  } as unknown as PlayerView;
}

/**
 * Build a view for the Mount Gundabad site-gate regression: a company with no
 * untapped character (and no untap source) at an `untapped`-or-`tapped` Mount
 * Gundabad, holding only the given permanent event.
 */
function makeSiteGatedNoTapPlayView(definitionId: string, siteTapped: boolean): PlayerView {
  return {
    self: {
      hand: [{ instanceId: 'h1', definitionId }],
      characters: {
        c1: { instanceId: 'c1', definitionId: 'tw-182', status: 'tapped', items: [], effectiveStats: { prowess: 4 } },
        c2: { instanceId: 'c2', definitionId: 'tw-182', status: 'inverted', items: [], effectiveStats: { prowess: 5 } },
      },
      companies: [
        {
          id: 'company-p2-0',
          currentSite: { instanceId: 's1', definitionId: 'tw-416', status: siteTapped ? 'tapped' : 'untapped' },
          characters: ['c1', 'c2'],
        },
      ],
    },
  } as unknown as PlayerView;
}

/**
 * Build a view for the `untapped-site-required` gate: a company with no
 * untapped character at a quiet border-hold (no automatic-attack), holding
 * only People Diminished.
 */
function makeUntappedSiteRequiredView(siteTapped: boolean): PlayerView {
  return {
    self: {
      hand: [{ instanceId: 'h1', definitionId: 'ba-72' }],
      characters: {
        c1: { instanceId: 'c1', definitionId: 'tw-182', status: 'tapped', items: [], effectiveStats: { prowess: 4 } },
      },
      companies: [
        {
          id: 'company-p2-0',
          currentSite: { instanceId: 's1', definitionId: 'le-357', status: siteTapped ? 'tapped' : 'untapped' },
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

  // Regression (game msaihfe9-oo2tc3, seq 540): the AI entered Glittering
  // Caves with Théoden (5 prowess), Balin, Fatty Bolger, and Ioreth against a
  // 9-prowess automatic-attack. Even Théoden — the company's best character —
  // can't roll high enough to stay untapped (needs an unrollable 13+), so
  // entering guaranteed a tap; Fatty Bolger ended up wounded, and the 1-MP
  // item the AI entered for was never even played. Entering for a single
  // low-value item against an unbeatable automatic-attack is not worth it.
  test('scores 0 for a low-value item when the automatic-attack guarantees a tap', () => {
    const view = makeGlitteringCavesView(5); // best character: prowess 5
    const context: AiContext = { view, cardPool: POOL, legalActions: [ENTER_SITE] };
    expect(sitePhaseEvaluator.score(ENTER_SITE, context)).toBe(0);
  });

  // Contrast: a company strong enough to plausibly stay untapped (prowess 12
  // beats the 9-prowess attack even with the untapped penalty) should still
  // enter for the same item.
  test('scores 50 for the same item when the company can plausibly stay untapped', () => {
    const view = makeGlitteringCavesView(12);
    const context: AiContext = { view, cardPool: POOL, legalActions: [ENTER_SITE] };
    expect(sitePhaseEvaluator.score(ENTER_SITE, context)).toBe(50);
  });

  // Regression (game msxdgosl-8meok7, seq 894, reported by Fatty75): the AI
  // entered Mount Gram with Balin as the lone, already-tapped company member,
  // holding only Rescue Prisoners. Rescue Prisoners' site-target filter
  // (dark-hold/shadow-hold) matched, and it was wrongly treated as a "no tap
  // needed" permanent event by handHasNoTapPlayableAt, so the tapped-company
  // check never fired. Rescue Prisoners taps a character on success (or
  // discards itself for nothing if none is untapped after its own triggered
  // attack) — it needs an untapped character just like an item does. Balin
  // took the site's automatic-attack for a play that was never even legal.
  test('scores 0 for Rescue Prisoners in hand when the only company member is already tapped', () => {
    const view = makeTappedCompanyRescuePrisonersView();
    const context: AiContext = { view, cardPool: POOL, legalActions: [ENTER_SITE] };
    expect(sitePhaseEvaluator.score(ENTER_SITE, context)).toBe(0);
  });

  // Same game, same seq: Mount Gundabad was *untapped*, so Rescue Prisoners
  // ("playable at an already tapped Dark-hold or Shadow-hold") could not have
  // been played there at all. handHasNoTapPlayableAt must honour the same site
  // gates the engine enforces — the `tapped-site-only` play-flag here.
  test('scores 0 when the only no-tap play requires an already-tapped site that is untapped', () => {
    const view = makeSiteGatedNoTapPlayView('tw-315', false);
    const context: AiContext = { view, cardPool: POOL, legalActions: [ENTER_SITE] };
    expect(sitePhaseEvaluator.score(ENTER_SITE, context)).toBe(0);
  });

  // Contrast for the opposite gate: People Diminished (ba-72) is a permanent
  // event that binds no character, so it is a genuine no-tap play — but only on
  // an *untapped* site (`untapped-site-required`). Entering is justified while
  // the site is untapped, and not once it is tapped.
  test('scores 50 for a no-tap permanent event whose untapped-site gate is met', () => {
    const view = makeUntappedSiteRequiredView(false);
    const context: AiContext = { view, cardPool: POOL, legalActions: [ENTER_SITE] };
    expect(sitePhaseEvaluator.score(ENTER_SITE, context)).toBe(50);
  });

  test('scores 0 for the same event once the site it requires untapped is tapped', () => {
    const view = makeUntappedSiteRequiredView(true);
    const context: AiContext = { view, cardPool: POOL, legalActions: [ENTER_SITE] };
    expect(sitePhaseEvaluator.score(ENTER_SITE, context)).toBe(0);
  });
});

describe('sitePhaseEvaluator play-short-event', () => {
  // Regression (game msq1wzcy-gwjpmx, seq 261): the AI played A Malady
  // Without Healing on its own character (p2-103) instead of an opponent's.
  // The engine legally enumerates a target on either side (`targetScope:
  // any-player`), and left unscored both got the same flat default weight —
  // a coin flip that regularly had the AI killing its own characters via its
  // own corruption event.
  test('scores 0 for A Malady Without Healing targeting the caster\'s own character', () => {
    const view = makeMaladyView();
    const action: GameAction = {
      type: 'play-short-event',
      player: 'p2',
      cardInstanceId: 'h1',
      targetCharacterId: 'c1',
    } as unknown as GameAction;
    const context: AiContext = { view, cardPool: POOL, legalActions: [action] };
    expect(sitePhaseEvaluator.score(action, context)).toBe(0);
  });

  // Contrast: the same card, targeting the opponent's character, is left
  // unscored (falls back to the default weight) rather than suppressed.
  test('does not suppress A Malady Without Healing targeting an opponent\'s character', () => {
    const view = makeMaladyView();
    const action: GameAction = {
      type: 'play-short-event',
      player: 'p2',
      cardInstanceId: 'h1',
      targetCharacterId: 'o1',
    } as unknown as GameAction;
    const context: AiContext = { view, cardPool: POOL, legalActions: [action] };
    expect(sitePhaseEvaluator.score(action, context)).toBeNull();
  });
});
