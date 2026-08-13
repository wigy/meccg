/**
 * @module ai/h2/modules/characters/characters.test
 *
 * A character is a score, a cost and a capability at once. These tests pin the
 * part that is exact — the points, priced per source — and the part that is
 * deliberately *not* priced, because reporting the mind cost without inventing
 * a value for what it displaces is the honest shape until the roster plan
 * exists.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus, loadCardPool } from '@meccg/shared';
import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { loadScenario, scenarioView } from '../../scenario-store.js';
import { charactersModule } from './characters.js';

const SCORER = 'tw-scorer';
const CHEAP = 'tw-cheap';
/** A faction an influence attempt could bring in — what freed influence is *for*. */
const FACTION = 'tw-faction';

const POOL = {
  [SCORER]: { name: 'Elrond', marshallingPoints: 3, marshallingCategory: 'character', mind: 8 },
  [CHEAP]: { name: 'A Hobbit', marshallingPoints: 0, marshallingCategory: 'character', mind: 1 },
  [FACTION]: {
    name: 'Rangers of the North', marshallingPoints: 3, marshallingCategory: 'faction', influenceNumber: 10,
  },
} as unknown as Readonly<Record<string, CardDefinition>>;

/** A play action naming a card in hand. */
function play(definitionId: string): GameAction {
  return { type: 'play-character', cardInstanceId: `card-${definitionId}` } as unknown as GameAction;
}

/** A context with both characters in hand and one in play. */
function contextWith(self: Record<string, number>, opponent: Record<string, number>, used = 4): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints(self),
      hand: [SCORER, CHEAP].map(d => ({ instanceId: `card-${d}`, definitionId: d })),
      characters: {
        'held-1': {
          instanceId: 'held-1',
          definitionId: SCORER,
          status: CardStatus.Untapped,
          items: [], allies: [], hazards: [], followers: [],
          effectiveStats: { prowess: 5, body: 7, directInfluence: 3, corruptionPoints: 0 },
        },
      },
      companies: [{ id: 'company', characters: ['held-1'] }],
      cardsInPlay: [],
      generalInfluence: 20,
      generalInfluenceUsed: used,
    },
    opponent: { marshallingPoints: testMarshallingPoints(opponent), characters: {}, cardsInPlay: [] },
    turnNumber: 20,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
    legalActions: [play(SCORER)],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

const BALANCED = { character: 3, item: 3, faction: 3, ally: 3 };

describe('playing a character', () => {
  test('is worth what a point in the character source is worth', () => {
    const evaluation = charactersModule.evaluate(play(SCORER), contextWith(BALANCED, BALANCED))!;
    expect(evaluation.expectedTsd).toBeGreaterThan(0);
  });

  test('is worth nothing when the character source is capped', () => {
    const capped = contextWith({ character: 8, item: 2, faction: 2, ally: 2 }, BALANCED);
    expect(capped.standing.marginal.character).toBe(0);
    expect(charactersModule.evaluate(play(SCORER), capped)!.expectedTsd).toBe(0);
  });

  test('a character with no points is neutral, not negative', () => {
    // Playing it costs mind, but mind is reported rather than priced — so the
    // module must not quietly charge for it.
    const evaluation = charactersModule.evaluate(play(CHEAP), contextWith(BALANCED, BALANCED))!;
    expect(evaluation.expectedTsd).toBe(0);
  });

  test('reports the mind against what the pool has left, without pricing it', () => {
    const evaluation = charactersModule.evaluate(play(SCORER), contextWith(BALANCED, BALANCED, 13))!;
    const text = JSON.stringify(evaluation.rationale);
    expect(text).toContain('7 of 20 general influence free');
    expect(text).toContain('reported, not priced');
    expect(evaluation.assumptions.some(a => a.includes('roster plan'))).toBe(true);
  });
});

describe('changing controller', () => {
  const move = { type: 'move-to-influence', characterId: 'held-1' } as unknown as GameAction;

  test('moves no marshalling points', () => {
    const evaluation = charactersModule.evaluate(move, contextWith(BALANCED, BALANCED))!;
    expect(evaluation.expectedTsd).toBe(0);
    expect(evaluation.outcomes[0].label).toContain('no marshalling points move');
  });

  test('reports the direct influence at stake, since that is what factions spend', () => {
    const evaluation = charactersModule.evaluate(move, contextWith(BALANCED, BALANCED))!;
    expect(JSON.stringify(evaluation.rationale)).toContain('reducer-site.ts');
  });

  test('and prices it when the hand holds something to spend it on', () => {
    // The move buys probability on an influence attempt and nothing else: a
    // follower is held by direct influence equal to its mind, and only a
    // character with free direct influence may attempt a faction. With a
    // faction in hand that attempt gets easier, so the move is worth something.
    const context = contextWith(BALANCED, BALANCED);
    const hand = context.view.self.hand as unknown as { instanceId: string; definitionId: string }[];
    hand.push({ instanceId: `card-${FACTION}`, definitionId: FACTION });

    const evaluation = charactersModule.evaluate(move, context)!;
    expect(evaluation.expectedTsd).toBeGreaterThan(0);
    expect(evaluation.outcomes[0].label).toContain('Rangers of the North');
  });
});

describe('what it declines', () => {
  test('an action naming a character it cannot find', () => {
    const unknown = { type: 'play-character', cardInstanceId: 'nope' } as unknown as GameAction;
    expect(charactersModule.evaluate(unknown, contextWith(BALANCED, BALANCED))).toBeNull();
  });
});

describe('company shape', () => {
  test('splitting is priced by the harm the two shapes invite, and they differ', () => {
    // The hazard limit is the company size, so shape decides both how many
    // slots the opponent gets and what they are aimed at. A module that scored
    // every split alike would have no opinion about which character to send.
    const scenario = loadScenario('organization/replanned-movement');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const context: ModuleContext = {
      view,
      cardPool,
      legalActions: [],
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    };
    const company = [...view.self.companies].sort((a, b) => b.characters.length - a.characters.length)[0];
    expect(company.characters.length).toBeGreaterThan(2);

    const scores = company.characters.map(characterId => charactersModule.evaluate({
      type: 'split-company', sourceCompanyId: company.id, characterId,
    } as unknown as GameAction, context)!.expectedTsd);
    expect(Math.max(...scores)).toBeGreaterThan(Math.min(...scores));
  });

  test('merging is the same comparison run the other way', () => {
    const scenario = loadScenario('organization/replanned-movement');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const context: ModuleContext = {
      view,
      cardPool,
      legalActions: [],
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    };
    if (view.self.companies.length < 2) return;
    const [a, b] = view.self.companies;
    const merged = charactersModule.evaluate({
      type: 'merge-companies', sourceCompanyId: a.id, targetCompanyId: b.id,
    } as unknown as GameAction, context);
    expect(merged).not.toBeNull();
    expect(JSON.stringify(merged!.rationale)).toContain('hazard slot');
  });

  test('merging A into B is worth exactly what merging B into A is', () => {
    // Same resulting company, so the same number. It was not: +2.61% one way
    // and +2.30% the other, because the harm model read the roster in list
    // order. That asymmetry is what let the agent loop.
    const scenario = loadScenario('organization/replanned-movement');
    const view = scenarioView(scenario);
    const context: ModuleContext = {
      view,
      cardPool: loadCardPool(),
      legalActions: [],
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    };
    if (view.self.companies.length < 2) return;
    const [a, b] = view.self.companies;
    const forward = charactersModule.evaluate({
      type: 'merge-companies', sourceCompanyId: a.id, targetCompanyId: b.id,
    } as unknown as GameAction, context)!;
    const backward = charactersModule.evaluate({
      type: 'merge-companies', sourceCompanyId: b.id, targetCompanyId: a.id,
    } as unknown as GameAction, context)!;
    expect(forward.expectedTsd).toBeCloseTo(backward.expectedTsd, 9);
  });

  test('splitting and merging the same pair are exact opposites', () => {
    // The property that stops the agent doing a thing and its undo forever:
    // shape utility has to be a difference of one potential over the whole
    // company set, so any accepted change strictly lowers it and the finitely
    // many shapes cannot be cycled.
    const scenario = loadScenario('organization/replanned-movement');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const context: ModuleContext = {
      view,
      cardPool,
      legalActions: [],
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    };
    const company = [...view.self.companies].sort((a, b) => b.characters.length - a.characters.length)[0];
    expect(company.characters.length).toBeGreaterThan(1);
    const characterId = company.characters[0];

    const split = charactersModule.evaluate({
      type: 'split-company', sourceCompanyId: company.id, characterId,
    } as unknown as GameAction, context)!;

    // The merge that undoes it, evaluated against a view where the split has
    // happened: the two halves as separate companies.
    const departing = new Set<string>([characterId as string]);
    for (const follower of view.self.characters[characterId]?.followers ?? []) {
      departing.add(follower as string);
    }
    const stays = company.characters.filter(id => !departing.has(id as string));
    const goes = company.characters.filter(id => departing.has(id as string));
    const afterSplit = {
      ...view,
      self: {
        ...view.self,
        companies: [
          ...view.self.companies.filter(c => c.id !== company.id),
          { ...company, id: 'company-stay', characters: stays },
          { ...company, id: 'company-go', characters: goes },
        ],
      },
    } as unknown as typeof view;
    const mergeBack = charactersModule.evaluate({
      type: 'merge-companies', sourceCompanyId: 'company-go', targetCompanyId: 'company-stay',
    } as unknown as GameAction, { ...context, view: afterSplit })!;

    expect(mergeBack.expectedTsd).toBeCloseTo(-split.expectedTsd, 6);
  });

  test('declines a shape change it cannot resolve', () => {
    const scenario = loadScenario('organization/replanned-movement');
    const view = scenarioView(scenario);
    const context: ModuleContext = {
      view,
      cardPool: loadCardPool(),
      legalActions: [],
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    };
    expect(charactersModule.evaluate({
      type: 'merge-companies', sourceCompanyId: 'nope', targetCompanyId: 'also-nope',
    } as unknown as GameAction, context)).toBeNull();
  });
});

describe('walking a character between companies', () => {
  test('is the same comparison as a split and a merge at once', () => {
    // `move-to-company` changes two companies' sizes together, so two hazard
    // limits move with it. It is the third operation of the same shape and
    // needs no third model — only the same potential.
    const scenario = loadScenario('organization/replanned-movement');
    const view = scenarioView(scenario);
    const context: ModuleContext = {
      view,
      cardPool: loadCardPool(),
      legalActions: [],
      tunables: DEFAULT_TUNABLES,
      standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
    };
    if (view.self.companies.length < 2) return;
    const [source, target] = [...view.self.companies].sort(
      (a, b) => b.characters.length - a.characters.length);
    const evaluation = charactersModule.evaluate({
      type: 'move-to-company',
      player: view.self.id,
      characterInstanceId: source.characters[0],
      sourceCompanyId: source.id,
      targetCompanyId: target.id,
    } as unknown as GameAction, context);
    expect(evaluation).not.toBeNull();
    expect(JSON.stringify(evaluation!.rationale)).toContain('hazard slot');
  });
});
