/**
 * @module rules/definitions/item-draft
 *
 * Declarative rules for item draft eligibility. During the item draft phase,
 * players assign starting minor items to characters. Only non-unique minor
 * items are allowed — unique minor items cannot be starting items per CRF rules.
 *
 * The context builder (server-side) must provide:
 * - `card.name` — card name for messages
 * - `card.isItem` — whether this card is an item type
 * - `card.unique` — whether this card is unique
 * - `card.isHoard` — whether this card is a hoard item (METD §3)
 * - `ctx.assignedCount` — number of items already assigned by this player
 * - `ctx.maxStartingItems` — maximum starting items allowed (2)
 */

import type { RuleSet } from '../types.js';

/** Maximum number of starting minor items a player can have. */
export const MAX_STARTING_ITEMS = 2;

/** Rules governing which pool cards can be assigned as starting items. */
export const ITEM_DRAFT_RULES: RuleSet = {
  name: 'Item Draft Eligibility',
  rules: [
    {
      id: 'is-item',
      condition: { 'card.isItem': true },
      failMessage: '{{card.name}} is a character, not an item',
    },
    {
      id: 'not-unique',
      condition: { 'card.unique': false },
      failMessage: '{{card.name}} is unique and cannot be a starting item',
    },
    {
      id: 'not-hoard',
      condition: { 'card.isHoard': false },
      failMessage: '{{card.name}} is a hoard item and cannot be a starting item',
    },
    {
      id: 'item-limit',
      condition: { 'ctx.assignedCount': { $lt: 2 } },
      failMessage: '{{card.name}}: already at starting item limit ({{ctx.assignedCount}}/{{ctx.maxStartingItems}})',
    },
  ],
};
