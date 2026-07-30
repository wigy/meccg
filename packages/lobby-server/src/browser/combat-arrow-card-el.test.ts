/**
 * @module combat-arrow-card-el.test
 *
 * Regression test for bug report "Battle arrows" (game ms6gbt8d-5na91m, seq 472):
 * an Orc-watch (tw-078) creature attack assigned its 3rd strike to Stinker
 * (le-154), an ally attached to a character. `drawStrikeArrows` found
 * Stinker's element via `data-combat-char-id` but then called
 * `.querySelector('.company-card')` on it looking for a descendant image —
 * for allies/items rendered by `createCardImageFromDefId`, the element found
 * *is* the `.company-card` image itself, so the descendant search returned
 * null and the arrow was silently dropped.
 */

import { describe, test, expect } from 'vitest';
import { resolveCardElement } from './combat-arrow-card-el.js';

interface FakeElement {
  matches(): boolean;
  querySelector(): FakeElement | null;
}

function fakeElement(matchesResult: boolean, querySelectorResult: FakeElement | null): FakeElement {
  return {
    matches: () => matchesResult,
    querySelector: () => querySelectorResult,
  };
}

describe('resolveCardElement', () => {
  test('returns the element itself when it is the bare .company-card image (ally/item case)', () => {
    const stinkerImg = fakeElement(true, null);
    expect(resolveCardElement(stinkerImg)).toBe(stinkerImg);
  });

  test('returns the descendant .company-card when the element is a wrapping column (character case)', () => {
    const cardImg = fakeElement(true, null);
    const characterColumn = fakeElement(false, cardImg);
    expect(resolveCardElement(characterColumn)).toBe(cardImg);
  });

  test('returns null when neither the element nor its descendants match', () => {
    const empty = fakeElement(false, null);
    expect(resolveCardElement(empty)).toBeNull();
  });
});
