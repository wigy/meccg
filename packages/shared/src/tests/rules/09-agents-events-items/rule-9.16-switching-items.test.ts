/**
 * @module rule-9.16-switching-items
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.16: Switching Items
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The resource player may declare that one of their characters will begin using an item that the character is bearing but not currently using, which causes the item's effects to be implemented upon resolution for as long as the item is still in use on the character.
 * A character may bear multiple items with the same keyword, but only one weapon, armor, shield, and helmet item may be in use on a character at a time (i.e. one of each type). If a character begins using a new item while already using an item of the same type of which only one item can be in use, the previous item's effects cease immediately.
 */

import { describe, test } from 'vitest';

describe('Rule 9.16 — Switching Items', () => {
  test.todo('Resource player may declare character begins using a non-active item; previous same-type item effects cease');
});
