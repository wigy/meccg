import { describe, test, expect } from 'vitest';
import { Alignment } from '@meccg/shared';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import { movementHazardEvaluator } from './movement-hazard.js';
import type { AiContext } from '../strategy.js';

// Full of Froth and Rage (as-30): a hazard permanent-event boosting all
// Spider/Animal attacks by +2 prowess while in play. Worthless once played
// after a matching creature's attack has already resolved.
const FULL_OF_FROTH_AND_RAGE: CardDefinition = {
  cardType: 'hazard-event',
  id: 'as-30',
  eventType: 'permanent',
  effects: [
    {
      type: 'stat-modifier',
      stat: 'prowess',
      value: 2,
      target: 'all-attacks',
      when: { 'enemy.race': { $in: ['spider', 'animal'] } },
    },
  ],
} as unknown as CardDefinition;

// Lesser Spiders (td-42): a Spider creature the boost above would strengthen.
const LESSER_SPIDERS: CardDefinition = {
  cardType: 'hazard-creature',
  id: 'td-42',
  strikes: 4,
  prowess: 7,
  race: 'spider',
} as unknown as CardDefinition;

// Stirring Bones (dm-111): an Undead creature the boost above does NOT match.
const STIRRING_BONES: CardDefinition = {
  cardType: 'hazard-creature',
  id: 'dm-111',
  strikes: 2,
  prowess: 9,
  race: 'undead',
} as unknown as CardDefinition;

// Doors of Night (tw-28): a permanent environment event with no effect this
// evaluator otherwise scores above the flat hazard-event baseline.
const DOORS_OF_NIGHT: CardDefinition = {
  cardType: 'hazard-event',
  id: 'tw-28',
  name: 'Doors of Night',
  eventType: 'permanent',
  effects: [
    {
      type: 'on-event',
      event: 'self-enters-play',
      apply: { type: 'move', select: 'filter-all', from: 'in-play', to: 'discard', filter: {} },
    },
  ],
} as unknown as CardDefinition;

// An Unexpected Outpost (dm-45): fetches one hazard from sideboard/discard,
// or two if Doors of Night is already in play.
const UNEXPECTED_OUTPOST: CardDefinition = {
  cardType: 'hazard-event',
  id: 'dm-45',
  name: 'An Unexpected Outpost',
  eventType: 'short',
  effects: [
    { type: 'move', select: 'target', from: ['sideboard', 'discard'], to: 'deck', count: 1 },
    {
      type: 'move', select: 'target', from: ['sideboard', 'discard'], to: 'deck', count: 1,
      when: { inPlay: 'Doors of Night' },
    },
  ],
} as unknown as CardDefinition;

// Alone and Unadvised (as-24): a corruption-keyword hazard event offering
// one legal action per eligible character in the targeted company.
const ALONE_AND_UNADVISED: CardDefinition = {
  cardType: 'hazard-event',
  id: 'as-24',
  name: 'Alone and Unadvised',
  eventType: 'permanent',
  keywords: ['corruption'],
  effects: [{ type: 'stat-modifier', stat: 'corruption-points', value: 4 }],
} as unknown as CardDefinition;

// Region cards from the Rivendell-to-Lórien bug report: the AI declared the
// path Rhudaur -> High Pass -> Anduin Vales -> Wold & Foothills (3 wilderness
// regions plus the Anduin Vales border-land), rather than the equally-long,
// all-wilderness Rhudaur -> Hollin -> Redhorn Gate -> Wold & Foothills.
const RHUDAUR: CardDefinition = { cardType: 'region', id: 'tw-482', name: 'Rhudaur', regionType: 'wilderness' } as unknown as CardDefinition;
const HIGH_PASS: CardDefinition = { cardType: 'region', id: 'tw-465', name: 'High Pass', regionType: 'wilderness' } as unknown as CardDefinition;
const ANDUIN_VALES: CardDefinition = { cardType: 'region', id: 'tw-442', name: 'Anduin Vales', regionType: 'border' } as unknown as CardDefinition;
const WOLD_AND_FOOTHILLS: CardDefinition = { cardType: 'region', id: 'tw-490', name: 'Wold & Foothills', regionType: 'wilderness' } as unknown as CardDefinition;
const HOLLIN: CardDefinition = { cardType: 'region', id: 'tw-466', name: 'Hollin', regionType: 'wilderness' } as unknown as CardDefinition;
const REDHORN_GATE: CardDefinition = { cardType: 'region', id: 'tw-481', name: 'Redhorn Gate', regionType: 'wilderness' } as unknown as CardDefinition;
// One region of each remaining type, for the alignment-dependent danger order.
const THE_SHIRE: CardDefinition = { cardType: 'region', id: 'tw-486', name: 'The Shire', regionType: 'free' } as unknown as CardDefinition;
const LINDON: CardDefinition = { cardType: 'region', id: 'tw-474', name: 'Lindon', regionType: 'free' } as unknown as CardDefinition;
const ANGMAR: CardDefinition = { cardType: 'region', id: 'tw-444', name: 'Angmar', regionType: 'shadow' } as unknown as CardDefinition;
const GUNDABAD: CardDefinition = { cardType: 'region', id: 'tw-462', name: 'Gundabad', regionType: 'dark' } as unknown as CardDefinition;

// Wandering Eldar (le-97): a creature whose own text makes its attack
// detainment against a hero company — it taps rather than wounds, and awards
// no kill marshalling points when it is defeated (CoE 3.II.3).
const WANDERING_ELDAR: CardDefinition = {
  cardType: 'hazard-creature',
  id: 'le-97',
  name: 'Wandering Eldar',
  strikes: 1,
  prowess: 4,
  race: 'elf',
  keyedTo: [],
  effects: [{ type: 'combat-detainment', when: { 'defender.alignment': 'hero' } }],
} as unknown as CardDefinition;

const POOL: Record<string, CardDefinition> = {
  'as-30': FULL_OF_FROTH_AND_RAGE,
  'td-42': LESSER_SPIDERS,
  'dm-111': STIRRING_BONES,
  'le-97': WANDERING_ELDAR,
  'tw-28': DOORS_OF_NIGHT,
  'dm-45': UNEXPECTED_OUTPOST,
  'as-24': ALONE_AND_UNADVISED,
  'tw-482': RHUDAUR,
  'tw-465': HIGH_PASS,
  'tw-442': ANDUIN_VALES,
  'tw-490': WOLD_AND_FOOTHILLS,
  'tw-466': HOLLIN,
  'tw-481': REDHORN_GATE,
  'tw-486': THE_SHIRE,
  'tw-474': LINDON,
  'tw-444': ANGMAR,
  'tw-462': GUNDABAD,
};

function makeContext(handDefIds: readonly string[]): AiContext {
  const view = {
    self: {
      hand: handDefIds.map((definitionId, i) => ({ instanceId: `h${i}`, definitionId })),
    },
    opponent: {
      companies: [],
      characters: {},
    },
  } as unknown as PlayerView;
  return { view, cardPool: POOL, legalActions: [] };
}

function playHazard(cardInstanceId: string): GameAction {
  return {
    type: 'play-hazard',
    player: 'p2',
    cardInstanceId,
    targetCompanyId: 'company-p1-0',
  } as unknown as GameAction;
}

describe('movementHazardEvaluator play-hazard sequencing', () => {
  test('scores a matching board-wide boost above the creature it would strengthen', () => {
    const context = makeContext(['as-30', 'td-42']);
    const boostScore = movementHazardEvaluator.score(playHazard('h0'), context);
    const creatureScore = movementHazardEvaluator.score(playHazard('h1'), context);
    expect(boostScore).not.toBeNull();
    expect(creatureScore).not.toBeNull();
    expect(boostScore!).toBeGreaterThan(creatureScore!);
  });

  test('falls back to the flat baseline when hand has no matching creature', () => {
    const context = makeContext(['as-30', 'dm-111']);
    const boostScore = movementHazardEvaluator.score(playHazard('h0'), context);
    expect(boostScore).toBe(5);
  });

  test('scores Doors of Night above An Unexpected Outpost\'s baseline when both are in hand', () => {
    // Bug report: the AI played An Unexpected Outpost, then Doors of Night
    // afterwards in the same hazard round — wasting Outpost's double-fetch
    // bonus, which only applies if Doors of Night is already in play.
    const context = makeContext(['dm-45', 'tw-28']);
    const outpostScore = movementHazardEvaluator.score(playHazard('h0'), context);
    const doorsScore = movementHazardEvaluator.score(playHazard('h1'), context);
    expect(outpostScore).toBe(5);
    expect(doorsScore).not.toBeNull();
    expect(doorsScore!).toBeGreaterThan(outpostScore!);
  });

  test('Doors of Night falls back to the flat baseline without a dependent card in hand', () => {
    const context = makeContext(['tw-28']);
    const doorsScore = movementHazardEvaluator.score(playHazard('h0'), context);
    expect(doorsScore).toBe(5);
  });
});

function playHazardOnCharacter(cardInstanceId: string, targetCharacterId: string): GameAction {
  return {
    ...playHazard(cardInstanceId),
    targetCharacterId,
  } as unknown as GameAction;
}

describe('movementHazardEvaluator play-hazard corruption-keyword targeting', () => {
  // Bug report: the AI played Alone and Unadvised on Dâsakûn, a throwaway
  // follower, while Théoden — the company's other eligible target, already
  // carrying 2 corruption points — went untouched. Both targets scored the
  // same flat baseline, so the choice was a coin flip instead of preferring
  // the character closer to being buried by corruption.
  test('prefers the target already carrying more corruption points', () => {
    const context: AiContext = {
      ...makeContext(['as-24']),
      view: {
        self: { hand: [{ instanceId: 'h0', definitionId: 'as-24' }] },
        opponent: {
          companies: [],
          characters: {
            theoden: { effectiveStats: { corruptionPoints: 2 } },
            dasakun: { effectiveStats: { corruptionPoints: 0 } },
          },
        },
      } as unknown as PlayerView,
    };

    const theodenScore = movementHazardEvaluator.score(playHazardOnCharacter('h0', 'theoden'), context)!;
    const dasakunScore = movementHazardEvaluator.score(playHazardOnCharacter('h0', 'dasakun'), context)!;

    expect(theodenScore).toBeGreaterThan(dasakunScore);
  });

  test('falls back to the flat baseline without a resolvable target', () => {
    const context = makeContext(['as-24']);
    const score = movementHazardEvaluator.score(playHazardOnCharacter('h0', 'unknown'), context);
    expect(score).toBe(5);
  });
});

describe('movementHazardEvaluator play-hazard creature keying-variant splitting', () => {
  // Bug report: the AI played Orc-warband, then Minions Stir (a board-wide
  // +1 strike/+1 prowess boost to Orc attacks) afterwards, wasting the boost
  // on a creature that had already resolved. Orc-warband was keyable two
  // ways at once (region-type "wilderness" and site-type "ruins-and-lairs"),
  // so computeLegalActions offered two separate play-hazard actions for the
  // same card. Each scored at the full, undiscounted creature-threat weight,
  // so their combined probability mass roughly doubled relative to a
  // single-keying creature — nearly matching the boost's score and turning
  // "the boost is sequenced first" from a reliable preference into a coin
  // flip.
  test('splits creature-threat weight across keying-variant duplicates of the same card', () => {
    const singleKeyingContext = { ...makeContext(['td-42']), legalActions: [playHazard('h0')] };
    const singleScore = movementHazardEvaluator.score(playHazard('h0'), singleKeyingContext)!;

    const twoKeyingsContext = {
      ...makeContext(['td-42']),
      legalActions: [playHazard('h0'), playHazard('h0')],
    };
    const perVariantScore = movementHazardEvaluator.score(playHazard('h0'), twoKeyingsContext)!;

    // Two keying justifications for the same card play as one decision, not two.
    expect(perVariantScore * 2).toBeCloseTo(singleScore);
  });

  test('a matching boost still outscores the combined weight of all keying variants', () => {
    const context = {
      ...makeContext(['as-30', 'td-42']),
      legalActions: [playHazard('h1'), playHazard('h1')],
    };
    const boostScore = movementHazardEvaluator.score(playHazard('h0'), context)!;
    const perVariantScore = movementHazardEvaluator.score(playHazard('h1'), context)!;

    expect(boostScore).toBeGreaterThan(perVariantScore * 2);
  });
});

describe('movementHazardEvaluator play-hazard detainment sequencing', () => {
  /** A hero company of two characters for the hazards to be aimed at. */
  function contextAgainstHeroCompany(handDefIds: readonly string[]): AiContext {
    const view = {
      self: {
        hand: handDefIds.map((definitionId, i) => ({ instanceId: `h${i}`, definitionId })),
        cardsInPlay: [],
      },
      opponent: {
        alignment: 'wizard',
        cardsInPlay: [],
        companies: [{
          id: 'company-p1-0',
          characters: ['c0', 'c1'],
          currentSite: null,
          revealedDestinationSite: null,
        }],
        characters: {
          c0: { effectiveStats: { prowess: 5 } },
          c1: { effectiveStats: { prowess: 4 } },
        },
      },
      combat: null,
    } as unknown as PlayerView;
    return {
      view,
      cardPool: POOL,
      legalActions: handDefIds.map((_, i) => playHazard(`h${i}`)),
    };
  }

  test('a detainment attack is played before a creature that can be beaten for points', () => {
    // The reported instinct: tap the defenders with the attack that costs
    // nothing to lose, and the creature that *can* hand over kill MP arrives
    // against a tapped company. Lesser Spiders is by far the bigger attack, so
    // without the lift it is played first and the detainment attack meets an
    // already-spent hazard limit — or is never played at all.
    const context = contextAgainstHeroCompany(['td-42', 'le-97']);
    const spidersScore = movementHazardEvaluator.score(playHazard('h0'), context)!;
    const eldarScore = movementHazardEvaluator.score(playHazard('h1'), context)!;

    expect(eldarScore).toBeGreaterThan(spidersScore);
  });

  test('against a company it does not detain, the bigger attack still leads', () => {
    // The same two cards against a minion company: §3.II.2's hero clause does
    // not fire, Wandering Eldar wounds like anything else, and the ordering is
    // decided by threat alone.
    const context = contextAgainstHeroCompany(['td-42', 'le-97']);
    const minionView = {
      ...context.view,
      opponent: { ...context.view.opponent, alignment: 'ringwraith' },
    } as unknown as PlayerView;
    const minionContext: AiContext = { ...context, view: minionView };

    const spidersScore = movementHazardEvaluator.score(playHazard('h0'), minionContext)!;
    const eldarScore = movementHazardEvaluator.score(playHazard('h1'), minionContext)!;

    expect(spidersScore).toBeGreaterThan(eldarScore);
  });
});

function marvelsTold(discardTargetInstanceId: string): GameAction {
  return {
    type: 'play-short-event',
    player: 'p2',
    cardInstanceId: 'td-134-instance',
    targetScoutInstanceId: 'scout-instance',
    discardTargetInstanceId,
  } as unknown as GameAction;
}

describe('movementHazardEvaluator play-short-event discard targeting', () => {
  // Bug report: the AI played Marvels Told (forces discard of an in-play
  // hazard-event) and chose to discard Foolish Words off Faramir — but
  // Faramir was in the *opponent's* company, so removing it undid the AI's
  // own hindrance and benefited the opponent instead of the AI. Meanwhile
  // the same legal-action set offered discarding Power Built by Waiting,
  // an opponent-played hazard raising the limit against the AI's own
  // company — the actually beneficial choice, left unscored alongside the
  // harmful one.
  test('scores discarding a hazard-event on the opponent\'s character as zero', () => {
    const context: AiContext = {
      view: {
        self: { hand: [], characters: {}, cardsInPlay: [] },
        opponent: {
          companies: [],
          characters: {
            'p1-101': { hazards: [{ instanceId: 'p2-91', definitionId: 'le-112' }] },
          },
          cardsInPlay: [],
        },
      } as unknown as PlayerView,
      cardPool: POOL,
      legalActions: [],
    };

    expect(movementHazardEvaluator.score(marvelsTold('p2-91'), context)).toBe(0);
  });

  test('scores discarding an opponent\'s board-wide hazard event above zero', () => {
    const context: AiContext = {
      view: {
        self: { hand: [], characters: {}, cardsInPlay: [] },
        opponent: {
          companies: [],
          characters: {},
          cardsInPlay: [{ instanceId: 'p1-52', definitionId: 'as-34' }],
        },
      } as unknown as PlayerView,
      cardPool: POOL,
      legalActions: [],
    };

    expect(movementHazardEvaluator.score(marvelsTold('p1-52'), context)).toBeGreaterThan(0);
  });
});

function placeOnGuard(cardInstanceId: string): GameAction {
  return { type: 'place-on-guard', player: 'p2', cardInstanceId } as unknown as GameAction;
}

describe('movementHazardEvaluator place-on-guard weighting', () => {
  // Bug report: "the AI always places a card on guard". One place-on-guard
  // action exists per hand card (any card can be the face-down bluff), so a
  // flat per-action weight let the category's combined odds scale with hand
  // size, drowning out "pass" whenever the hand had more than a couple of
  // cards.
  test('splits a fixed total weight across all place-on-guard options instead of scoring each one flatly', () => {
    const manyOptions = Array.from({ length: 8 }, (_, i) => placeOnGuard(`h${i}`));
    const context: AiContext = {
      ...makeContext(['as-30']),
      legalActions: [...manyOptions, { type: 'pass', player: 'p2' } as unknown as GameAction],
    };

    const perActionScore = movementHazardEvaluator.score(manyOptions[0], context)!;
    const totalGuardWeight = perActionScore * manyOptions.length;

    // The combined weight of "place something on guard" stays at the
    // original single-decision magnitude regardless of hand size.
    expect(totalGuardWeight).toBeCloseTo(4);
  });

  test('scores the single-option case the same as before the fix', () => {
    const context: AiContext = {
      ...makeContext(['as-30']),
      legalActions: [placeOnGuard('h0'), { type: 'pass', player: 'p2' } as unknown as GameAction],
    };
    expect(movementHazardEvaluator.score(placeOnGuard('h0'), context)).toBe(4);
  });
});

function declarePath(regionPath: readonly string[]): GameAction {
  return { type: 'declare-path', player: 'p2', movementType: 'region', regionPath } as unknown as GameAction;
}

function pathContext(alignment?: Alignment): AiContext {
  const base = makeContext([]);
  const view = { ...base.view, self: { ...base.view.self, alignment } } as unknown as PlayerView;
  return { ...base, view, legalActions: [] };
}

function pathScore(regionPath: readonly string[], alignment?: Alignment): number {
  return movementHazardEvaluator.score(declarePath(regionPath), pathContext(alignment))!;
}

const path = (...regions: readonly CardDefinition[]): string[] => regions.map(r => r.id);

describe('movementHazardEvaluator declare-path region danger scoring', () => {
  // Bug report: Saruman travelled Rivendell to Lórien via Region Movement and
  // declared Rhudaur -> High Pass -> Anduin Vales -> Wold & Foothills — the
  // same length as the all-wilderness Rhudaur -> Hollin -> Redhorn Gate ->
  // Wold & Foothills alternative, but with a gratuitous Anduin Vales
  // border-land added on top, for no offsetting benefit. Both paths
  // previously scored the same flat 8, so the AI picked between them
  // uniformly at random. No creature keys to more than three Wilderness
  // regions, so the fourth Wilderness of the safe route costs nothing while
  // the Border-land opens Men creatures the other route never faces.
  test('prefers an all-wilderness path over an equal-length path with a border-land', () => {
    const viaAnduinVales = pathScore(path(RHUDAUR, HIGH_PASS, ANDUIN_VALES, WOLD_AND_FOOTHILLS));
    const viaRedhornGate = pathScore(path(RHUDAUR, HOLLIN, REDHORN_GATE, WOLD_AND_FOOTHILLS));
    expect(viaRedhornGate).toBeGreaterThan(viaAnduinVales);
  });

  test('a wilderness costs a hero company more than a free-domain', () => {
    expect(pathScore(path(THE_SHIRE))).toBeGreaterThan(pathScore(path(RHUDAUR)));
  });

  test('each extra wilderness up to the third costs more, the fourth nothing', () => {
    const one = pathScore(path(RHUDAUR));
    const two = pathScore(path(RHUDAUR, HOLLIN));
    const three = pathScore(path(RHUDAUR, HOLLIN, REDHORN_GATE));
    const four = pathScore(path(RHUDAUR, HOLLIN, REDHORN_GATE, WOLD_AND_FOOTHILLS));
    expect(one).toBeGreaterThan(two);
    expect(two).toBeGreaterThan(three);
    expect(four).toBe(three);
  });

  test('shadow-lands and dark-domains cost a hero company more than wilderness', () => {
    expect(pathScore(path(RHUDAUR))).toBeGreaterThan(pathScore(path(ANGMAR)));
    expect(pathScore(path(ANGMAR))).toBeGreaterThan(pathScore(path(GUNDABAD)));
  });

  test('a free-domain-only path scores the full baseline for a hero company', () => {
    expect(pathScore(path(THE_SHIRE, LINDON))).toBe(8);
  });

  test('never ties two paths of different danger, however dangerous', () => {
    const grim = pathScore(path(GUNDABAD, GUNDABAD, GUNDABAD, ANGMAR));
    const grimmer = pathScore(path(GUNDABAD, GUNDABAD, GUNDABAD, ANGMAR, ANGMAR));
    expect(grim).toBeGreaterThan(grimmer);
    expect(grimmer).toBeGreaterThan(0);
  });

  // The order runs the other way for a minion company: an attack keyed to a
  // Dark-domain is detainment against it (CoE §3.II.2.R1/B1), while the Men
  // and Elves of a Free-domain attack it for real.
  test.each([Alignment.Ringwraith, Alignment.Balrog])('%s: a dark-domain is safer than a free-domain', alignment => {
    expect(pathScore(path(GUNDABAD), alignment)).toBeGreaterThan(pathScore(path(ANGMAR), alignment));
    expect(pathScore(path(ANGMAR), alignment)).toBeGreaterThan(pathScore(path(RHUDAUR), alignment));
    expect(pathScore(path(RHUDAUR), alignment)).toBeGreaterThan(pathScore(path(ANDUIN_VALES), alignment));
    expect(pathScore(path(ANDUIN_VALES), alignment)).toBeGreaterThan(pathScore(path(THE_SHIRE), alignment));
    expect(pathScore(path(GUNDABAD, GUNDABAD), alignment)).toBe(8);
  });

  test.each([Alignment.Wizard, Alignment.FallenWizard])('%s: a free-domain is safer than a dark-domain', alignment => {
    expect(pathScore(path(THE_SHIRE), alignment)).toBeGreaterThan(pathScore(path(GUNDABAD), alignment));
  });

  test('charges a path entry that resolves to no region card as a mild unknown', () => {
    expect(pathScore(['unknown-region'])).toBeLessThan(8);
    expect(pathScore(['unknown-region'])).toBeGreaterThan(pathScore(path(RHUDAUR)));
  });
});

function corruptionCheckRoll(characterId: string, need: number): GameAction {
  return {
    type: 'corruption-check',
    player: 'p2',
    characterId,
    corruptionPoints: 0,
    corruptionModifier: 0,
    possessions: [],
    need,
    explanation: '',
  } as unknown as GameAction;
}

function supportCorruptionCheck(supportingCharacterId: string, targetCharacterId: string): GameAction {
  return {
    type: 'support-corruption-check',
    player: 'p2',
    supportingCharacterId,
    targetCharacterId,
  } as unknown as GameAction;
}

describe('movementHazardEvaluator support-corruption-check tap-in-support weighting', () => {
  // Bug report: Marvels Told forced a corruption check on Balin (need > -1
  // to survive, i.e. `need: 0`) after the AI had already tapped one company
  // mate in support, dropping the check's need to 2 — a natural roll of 2 is
  // the lowest possible on 2d6, so the check could no longer fail. The AI
  // went on to tap two more company mates in support anyway, leaving them
  // uselessly tapped for the site phase, because every support option scored
  // the same flat default weight as the roll action itself.
  test('scores support as zero once the check is already unfailable', () => {
    const context = {
      ...makeContext([]),
      legalActions: [corruptionCheckRoll('balin', 2), supportCorruptionCheck('scout', 'balin')],
    };
    const score = movementHazardEvaluator.score(supportCorruptionCheck('scout', 'balin'), context);
    expect(score).toBe(0);
  });

  test('scores support above zero while the check can still fail', () => {
    const context = {
      ...makeContext([]),
      legalActions: [corruptionCheckRoll('balin', 3), supportCorruptionCheck('scout', 'balin')],
    };
    const score = movementHazardEvaluator.score(supportCorruptionCheck('scout', 'balin'), context);
    expect(score).toBeGreaterThan(0);
  });

  test('falls back to a flat weight when the paired roll action is not offered', () => {
    const context = { ...makeContext([]), legalActions: [supportCorruptionCheck('scout', 'balin')] };
    expect(movementHazardEvaluator.score(supportCorruptionCheck('scout', 'balin'), context)).toBe(3);
  });
});
