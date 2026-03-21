/**
 * @module rules/definitions/character-deck-draft
 *
 * Declarative rules for the character deck draft phase. After the starting
 * company is drafted, remaining pool characters can be added to the play deck
 * up to a limit of 10 non-avatar characters.
 *
 * The context builder (server-side) must provide:
 * - `card.name` — character name for messages
 * - `card.isCharacter` — whether this card is a character type
 * - `card.isAvatar` — whether this is an avatar (mind === null)
 * - `ctx.nonAvatarCount` — current count of non-avatar characters in deck
 * - `ctx.nonAvatarLimit` — maximum non-avatar characters allowed (10)
 */

import type { RuleSet } from '../types.js';

/** Rules governing which remaining pool characters can be added to the play deck. */
export const CHARACTER_DECK_DRAFT_RULES: RuleSet = {
  name: 'Character Deck Draft Eligibility',
  rules: [
    {
      id: 'is-character',
      condition: { 'card.isCharacter': true },
      failMessage: '{{card.name}} is not a character',
    },
    {
      id: 'non-avatar-limit',
      condition: {
        $or: [
          { 'card.isAvatar': true },
          { 'ctx.nonAvatarCount': { $lt: 10 } },
        ],
      },
      failMessage: '{{card.name}}: non-avatar character limit reached ({{ctx.nonAvatarCount}}/{{ctx.nonAvatarLimit}})',
    },
  ],
};
