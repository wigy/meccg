/**
 * @module rules/definitions/character-draft
 *
 * Declarative rules for character draft eligibility. During the draft phase,
 * both players simultaneously pick characters from their pool. These rules
 * determine which characters can be selected on each pick.
 *
 * The context builder (server-side) must provide:
 * - `card.name` — character name for messages
 * - `card.isCharacter` — whether this card is a character type
 * - `card.mind` — character's mind value (null for avatars)
 * - `card.unique` — whether the character is unique
 * - `ctx.opponentHasCard` — true if opponent already drafted this character
 * - `ctx.projectedMind` — currentMind + card.mind (pre-computed)
 * - `ctx.currentMind` — total mind of already-drafted characters
 * - `ctx.mindLimit` — general influence limit (20)
 */

import type { RuleSet } from '../types.js';

/** Rules governing character eligibility during the simultaneous draft phase. */
export const CHARACTER_DRAFT_RULES: RuleSet = {
  name: 'Character Draft Eligibility',
  rules: [
    {
      id: 'is-character',
      condition: { 'card.isCharacter': true },
      failMessage: '{{card.name}} is not a character',
    },
    {
      id: 'unique-available',
      condition: {
        $or: [
          { 'card.unique': false },
          { 'ctx.opponentHasCard': false },
        ],
      },
      failMessage: '{{card.name}} is unique and already drafted by opponent',
    },
    {
      id: 'mind-limit',
      condition: {
        $or: [
          { 'card.mind': null },
          { 'ctx.projectedMind': { $lte: 20 } },
        ],
      },
      failMessage: '{{card.name}}: mind {{card.mind}} would exceed limit ({{ctx.currentMind}} + {{card.mind}} > {{ctx.mindLimit}})',
    },
  ],
};
