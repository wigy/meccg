/**
 * @module rule-9.21-gold-ring-test
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.21: Gold Ring Test
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * When a rule or effect causes a gold ring item to be "tested," the item's player makes a ring test roll, applies any modifications, and may then immediately play a special ring item that matches the final result as listed on the gold ring item. The special ring item replaces the gold ring item, which is immediately discarded regardless of whether a special ring item was played to replace it.
 * Playing a special ring as the result of a gold ring test counts as "playing an item," but is not restricted to the site phase, doesn't tap a site, and doesn't require an untapped site nor an untapped character.
 * When a gold ring item is tested, it can only be replaced with a special ring item of the same alignment.
 */

import { describe, test } from 'vitest';

describe('Rule 9.21 — Gold Ring Test', () => {
  test.todo('Gold ring tested: player rolls, may play matching special ring item to replace gold ring; gold ring discarded regardless');
});
