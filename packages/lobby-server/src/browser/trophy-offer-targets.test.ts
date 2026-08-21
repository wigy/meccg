/**
 * @module trophy-offer-targets.test
 *
 * Regression test for bug report 5e2c9d7d741d9dee (game mt2lucpb-hozgi5, seq
 * 335): "I don't know how to take a creature as a trophy." The reporter
 * defeated all 5 strikes of an Orc-warband (tw-076 — no body; MELE §8.37
 * trophies never involve a body check) and the engine correctly transitioned
 * combat into the `trophy-offer` phase, offering `take-trophy` for each
 * eligible Orc/Troll character. Two renderer bugs then hid the offer:
 *
 * 1. `TakeTrophyAction` was never re-exported from `@meccg/shared`'s
 *    `types/actions.ts` (only imported into the internal `GameAction` union),
 *    so the combat renderer could not even reference the type to wire up a
 *    click handler.
 * 2. The situation banner had no `trophy-offer` case, so it fell into the
 *    generic fallback that unconditionally read "Body Check" — exactly what
 *    the reporter saw, despite Orc-warband having no body.
 *
 * `buildTakeTrophyMap` (used to decide which characters get the clickable
 * "assignable" highlight and click handler in `combat-view.ts`) and
 * `trophyOfferBannerText` are now extracted here so both are covered without
 * needing to render the full combat view.
 */

import { describe, test, expect } from 'vitest';
import type { CardInstanceId, PlayerId, TakeTrophyAction } from '@meccg/shared';
import { buildTakeTrophyMap, trophyOfferBannerText } from './trophy-offer-targets.js';

const P1 = 'p1' as PlayerId;
const CAPTAIN_INST = 'p1-101' as CardInstanceId; // Orc Captain (le-31) — trophy-eligible
const CREATURE_INST = 'p2-42' as CardInstanceId; // Orc-warband (tw-076)

const takeTrophyAction: TakeTrophyAction = {
  type: 'take-trophy',
  player: P1,
  characterId: CAPTAIN_INST,
  creatureInstanceId: CREATURE_INST,
} as TakeTrophyAction;

describe('buildTakeTrophyMap', () => {
  test('keys the take-trophy action by the eligible character receiving the trophy', () => {
    const map = buildTakeTrophyMap([takeTrophyAction]);
    expect(map.get(CAPTAIN_INST as string)).toBe(takeTrophyAction);
  });

  test('produces an empty map when no character is offered a trophy', () => {
    const map = buildTakeTrophyMap([]);
    expect(map.size).toBe(0);
  });
});

describe('trophyOfferBannerText', () => {
  test('invites the player to choose a trophy instead of reporting a body check', () => {
    const text = trophyOfferBannerText('Orc — ', 1);
    expect(text).not.toContain('Body Check');
    expect(text).toContain('Choose a Trophy');
  });

  test('tells the player to pass when nobody is eligible', () => {
    const text = trophyOfferBannerText('', 0);
    expect(text).not.toContain('Body Check');
    expect(text).toContain('Pass to continue');
  });
});
