/**
 * @module ai/h2/services/defence.test
 *
 * The service exists to answer one comparison — is this company better as one
 * or as two? — so the tests are about the shape of the answer rather than its
 * magnitude: more slots hurt more, a bigger roster answers better, and the
 * threat is described rather than invented.
 */

import { describe, expect, test } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import { computeStanding } from './standing.js';
import { computeDefence } from './defence.js';
import { rosterOf } from './strike/prowess.js';
import { loadScenario, scenarioView } from '../scenario-store.js';
import { testWinProbModel } from '../test-support.js';

/** An organization phase with a five-character company. */
const SCENARIO = 'organization/replanned-movement';

/** The defence service and the acting player's largest company roster. */
function position() {
  const scenario = loadScenario(SCENARIO);
  const view = scenarioView(scenario);
  const cardPool = loadCardPool();
  const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
  const company = [...view.self.companies].sort((a, b) => b.characters.length - a.characters.length)[0];
  return {
    view,
    cardPool,
    standing,
    company,
    defence: computeDefence(view, cardPool, standing, DEFAULT_TUNABLES),
    roster: rosterOf(company, view.self.characters, cardPool),
  };
}

describe('what a shape invites', () => {
  test('more hazard slots hurt more', () => {
    const { defence, roster } = position();
    expect(defence.expectedHarm(roster, 3)).toBeGreaterThan(defence.expectedHarm(roster, 1));
  });

  test('an empty roster and an empty budget both cost nothing', () => {
    const { defence, roster } = position();
    expect(defence.expectedHarm([], 5)).toBe(0);
    expect(defence.expectedHarm(roster, 0)).toBe(0);
  });

  test('harm is positive — callers subtract it', () => {
    const { defence, roster } = position();
    expect(defence.expectedHarm(roster, 2)).toBeGreaterThan(0);
  });

  test('the answer depends on who is in the company, not on the order of the list', () => {
    // The invariant that makes `Σ harm(company)` a potential. Strike targets are
    // picked by lowest need with ties falling back to array order, so without a
    // canonical ordering the same company scores differently depending on how it
    // was assembled — and a shape change and its undo can then both look like an
    // improvement. One self-play game spent 4000 decisions on exactly that,
    // cycling split → plan-movement → merge in a single organization phase.
    const { defence, roster } = position();
    const shuffled = [...roster].reverse();
    expect(defence.expectedHarm(shuffled, 3)).toBeCloseTo(defence.expectedHarm(roster, 3), 9);
  });

  test('the answer does not depend on how the rest of the board is arranged', () => {
    // The second half of the potential property, and the one that cost a second
    // self-play game. Harm used to be priced through `character-value`, whose
    // tap cost includes the influence attempt the tap forfeits — and *that*
    // depends on which company the character is in. Splitting scored +1.28 tsd
    // and merging the pair straight back scored +0.48, because the prices had
    // moved underneath the comparison.
    const { view, cardPool, standing, company, roster, defence } = position();
    const resplit = {
      ...view,
      self: {
        ...view.self,
        companies: [
          ...view.self.companies.filter(c => c.id !== company.id),
          { ...company, id: 'company-a', characters: company.characters.slice(0, 1) },
          { ...company, id: 'company-b', characters: company.characters.slice(1) },
        ],
      },
    } as unknown as typeof view;
    const other = computeDefence(resplit, cardPool, standing, DEFAULT_TUNABLES);
    expect(other.expectedHarm(roster, 3)).toBeCloseTo(defence.expectedHarm(roster, 3), 9);
  });

  test('a bigger roster answers the same attack better, per slot', () => {
    // Not per company: a bigger company also invites more slots, which is the
    // whole tension the shape decision sits in. Held at one slot, the extra
    // parriers can only help.
    const { defence, roster } = position();
    expect(roster.length).toBeGreaterThan(2);
    const small = roster.slice(0, 1);
    expect(defence.expectedHarm(roster, 1)).toBeLessThanOrEqual(defence.expectedHarm(small, 1));
  });
});

describe('the typical attack', () => {
  test('is a whole-numbered creature, because the dice tables are', () => {
    // A fractional prowess makes a fractional 2d6 target, which reads as an
    // unreachable roll and silently prices every attack at zero harm — which is
    // exactly what the first version of this did.
    const { defence } = position();
    expect(Number.isInteger(defence.typical.prowess)).toBe(true);
    expect(Number.isInteger(defence.typical.strikes)).toBe(true);
    expect(defence.typical.strikes).toBeGreaterThanOrEqual(1);
    if (defence.typical.body !== null) expect(Number.isInteger(defence.typical.body)).toBe(true);
  });

  test('says whether it came from the opponent or from the card pool', () => {
    const { defence } = position();
    expect(defence.typical.fromPool).toBe(defence.typical.seen === 0);
  });
});
