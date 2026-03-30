/**
 * @module rule-9.15-item-usage
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.15: Item Usage
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Characters can bear any number of items, but each character can only use one weapon, armor, shield, and helmet at a time. Items that aren't in use don't have any effect on their bearer.
 * An item's effects are only implemented while the item is in use, including modifications that the item applies to its bearer's prowess, body, direct influence, skills, and/or other attributes. This rule does not apply to the item's marshalling points or corruption points, because those are attributes of the item card and not its effects.
 * When an item is played on a character that is able to use its effects, the item is considered to be in use upon resolution and any modifications to the bearer's attributes are applied immediately.
 */

import { describe, test } from 'vitest';

describe('Rule 9.15 — Item Usage', () => {
  test.todo('Characters may bear any number of items but only use one weapon, armor, shield, helmet; unused items have no effect');
});
