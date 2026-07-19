/**
 * @module rule-9.18-item-movement-restrictions
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.18: Item Movement Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement restrictions on an item (e.g. discarding the item if the company moves) are always implemented regardless of whether the item is being used and regardless of the alignment of the item, its controlling character, or its player.
 */

import { describe, test } from 'vitest';

// There is no DSL effect type for "discard this item if the company moves
// [below N members]", and no movement-resolution code path consults
// per-item effects at all (movement-hazard.ts / reducer-move.ts operate on
// company/site state, not borne items). The two cards whose text describes
// this exact mechanic — Palantír of Amon Sûl and Palantír of Osgiliath
// (le-items.json) — both carry an empty `effects: []` array, so there is no
// certified, reachable card to drive a test even once the mechanism exists.
describe('Rule 9.18 — Item Movement Restrictions', () => {
  test.todo('Movement restrictions on items always apply regardless of use status or alignment');
});
