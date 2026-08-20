/**
 * @module ai/h2/services/character-value.test
 *
 * Bug report: Fatty75 (game mt1u3wx0-cj9r7v, turn 10, seq 537) — the h2
 * `combat` module tapped every character in a company to resolve one
 * automatic-attack strike (a tap-to-fight plus two support taps), leaving
 * nobody untapped to act during the site phase even though the hand held
 * playable resource cards. `tapCost` priced every one of those taps at the
 * flat `tapTempoCost`, because it only knew to price a forfeited influence
 * attempt — not the resource plays the company's last untapped body takes
 * with it.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus } from '@meccg/shared';
import type { CardDefinition, PlayerView } from '@meccg/shared';
import { computeCharacterValue } from './character-value.js';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import type { MpDelta } from '../core/tsd.js';
import type { Standing } from './standing.js';

const CHARACTER = 'tw-character';
const ITEM = 'tw-item';
const HAZARD = 'tw-hazard';

const POOL = {
  [CHARACTER]: { name: 'Character', cardType: 'hero-character', mind: 2, marshallingPoints: 1 },
  [ITEM]: { name: 'Item', cardType: 'hero-resource-item' },
  [HAZARD]: { name: 'Hazard', cardType: 'hazard-event' },
} as unknown as Readonly<Record<string, CardDefinition>>;

/** Standing whose `tsdAfter` reports the `item` MP delta directly, so the
 * denial term comes out to exactly `deniedPlayMp` when it fires at all. */
const STANDING = {
  tsd: 0,
  marginal: { faction: 0 },
  tsdAfter: (selfDelta: MpDelta) => selfDelta.item ?? 0,
} as unknown as Standing;

/** A view with one company of untapped characters and the given hand. */
function viewWith(characterIds: readonly string[], handDefIds: readonly string[]): PlayerView {
  const characters: Record<string, unknown> = {};
  for (const id of characterIds) {
    characters[id] = {
      instanceId: id,
      definitionId: CHARACTER,
      status: CardStatus.Untapped,
      items: [],
      allies: [],
      followers: [],
      effectiveStats: { prowess: 5, body: 7, directInfluence: 0, corruptionPoints: 0 },
    };
  }
  return {
    self: {
      id: 'p1',
      hand: handDefIds.map((definitionId, i) => ({ instanceId: `h${i}`, definitionId })),
      characters,
      companies: [{ id: 'company', characters: characterIds }],
      cardsInPlay: [],
      generalInfluence: 20,
      generalInfluenceUsed: 0,
    },
    opponent: { characters: {}, cardsInPlay: [] },
  } as unknown as PlayerView;
}

describe('tapCost — resource plays forfeited by emptying the company', () => {
  test('is charged when this is the company\'s last untapped character and a resource card is held', () => {
    const view = viewWith(['solo'], [ITEM]);
    const value = computeCharacterValue(view, POOL, STANDING, DEFAULT_TUNABLES);
    const price = value.tapCost('solo' as never);
    expect(price.tsd).toBeCloseTo(DEFAULT_TUNABLES.tapTempoCost + DEFAULT_TUNABLES.deniedPlayMp, 9);
  });

  test('is not charged while a company mate stays untapped to play it instead', () => {
    const view = viewWith(['a', 'b'], [ITEM]);
    const value = computeCharacterValue(view, POOL, STANDING, DEFAULT_TUNABLES);
    const price = value.tapCost('a' as never);
    expect(price.tsd).toBeCloseTo(DEFAULT_TUNABLES.tapTempoCost, 9);
  });

  test('is not charged when the hand holds no resource cards to lose the play of', () => {
    const view = viewWith(['solo'], [HAZARD]);
    const value = computeCharacterValue(view, POOL, STANDING, DEFAULT_TUNABLES);
    const price = value.tapCost('solo' as never);
    expect(price.tsd).toBeCloseTo(DEFAULT_TUNABLES.tapTempoCost, 9);
  });

  test('is not charged for a character already tapped or wounded', () => {
    const view = viewWith(['solo'], [ITEM]);
    (view.self.characters['solo' as never] as { status: CardStatus }).status = CardStatus.Inverted;
    const value = computeCharacterValue(view, POOL, STANDING, DEFAULT_TUNABLES);
    const price = value.tapCost('solo' as never);
    expect(price.tsd).toBe(0);
  });
});
