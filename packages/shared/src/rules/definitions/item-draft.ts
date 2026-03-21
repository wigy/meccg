/**
 * @module rules/definitions/item-draft
 *
 * Declarative rules for item draft eligibility. During the item draft phase,
 * players assign starting minor items to characters. Non-item cards in the
 * pool are shown as non-viable with an explanation.
 *
 * The context builder (server-side) must provide:
 * - `card.name` — card name for messages
 * - `card.isItem` — whether this card is an item type
 */

import type { RuleSet } from '../types.js';

/** Rules governing which pool cards can be assigned as starting items. */
export const ITEM_DRAFT_RULES: RuleSet = {
  name: 'Item Draft Eligibility',
  rules: [
    {
      id: 'is-item',
      condition: { 'card.isItem': true },
      failMessage: '{{card.name}} is a character, not an item',
    },
  ],
};
