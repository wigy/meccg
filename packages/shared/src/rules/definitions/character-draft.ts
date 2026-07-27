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
 * - `card.cannotBeStartingCharacter` — true if the character declares the
 *   `not-starting-character` play-flag (e.g. Fram Framson)
 * - `card.isAgent` — whether the character carries the `agent` keyword
 * - `ctx.opponentHasCard` — true if opponent already drafted this character
 * - `ctx.projectedMind` — currentMind + card.mind (pre-computed)
 * - `ctx.currentMind` — total mind of already-drafted characters
 * - `ctx.mindLimit` — general influence limit (20)
 * - `ctx.fwMindGateActive` — true when the drafting player is a Fallen-wizard
 *   who has no unconsumed enabling Stage resource (Thrall of the Voice) left;
 *   each vehicle enables only one gated character, so the gate re-activates once
 *   every drafted vehicle has been spent on a gated character. While active,
 *   characters with mind > 5 cannot be drafted (rule 1.44)
 * - `ctx.fwAgentGateActive` — true under the same Fallen-wizard condition;
 *   while active, agent characters cannot be drafted (rule 1.42)
 * - `ctx.ringwraithAgentGateActive` — true when the drafting player is a
 *   Ringwraith who has no unconsumed agent-summons enabler (Open to the Summons);
 *   while active, agent characters cannot be drafted (rule 1.41). The enabler
 *   must be drafted "in lieu of a minor item" in an earlier round before it lifts
 *   the gate; each drafted one lifts it for a single agent (CoE 1.9.R2).
 * - `card.isOrcOrTroll` — true when the drafting player is a Fallen-wizard and
 *   this candidate is an Orc or Troll character (Half-orcs count as Orcs)
 * - `ctx.fwOrcTrollPermitted` — true when `card.isOrcOrTroll` is false, or a
 *   drafted Stage resource specifically allows Orc/Troll characters (e.g. Bad
 *   Company, wh-63); while false, the candidate cannot be drafted (rule 1.43)
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
      id: 'not-avatar',
      condition: { 'card.mind': { $ne: null } },
      failMessage: '{{card.name}} is an avatar and cannot be drafted as a starting character',
    },
    {
      id: 'not-starting-character',
      condition: { 'card.cannotBeStartingCharacter': false },
      failMessage: '{{card.name}} may not be one of the starting characters',
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
    {
      // Rule 1.44: a Fallen-wizard cannot reveal a character with mind > 5
      // during the draft unless an enabling Stage resource (Thrall of the
      // Voice) has already been drafted.
      id: 'fw-draft-mind-limit',
      condition: {
        $or: [
          { 'ctx.fwMindGateActive': false },
          { 'card.mind': null },
          { 'card.mind': { $lte: 5 } },
        ],
      },
      failMessage: '{{card.name}}: a Fallen-wizard cannot draft a character with mind > 5 without an enabling Stage resource (Thrall of the Voice)',
    },
    {
      // Rule 1.42: a Fallen-wizard cannot reveal an agent character during the
      // draft unless an enabling Stage resource (Thrall of the Voice) has
      // already been drafted.
      id: 'fw-draft-agent',
      condition: {
        $or: [
          { 'ctx.fwAgentGateActive': false },
          { 'card.isAgent': false },
        ],
      },
      failMessage: '{{card.name}}: a Fallen-wizard cannot draft an agent character without an enabling Stage resource (Thrall of the Voice)',
    },
    {
      // Rule 1.41 (CoE 1.9.R2): a Ringwraith cannot reveal an agent character
      // during the draft unless an enabling resource (Open to the Summons) has
      // been drafted for the starting company "in lieu of a minor item" in an
      // earlier round. Each drafted enabler lifts the gate for one agent; without
      // one the gate stays active.
      id: 'rw-draft-agent',
      condition: {
        $or: [
          { 'ctx.ringwraithAgentGateActive': false },
          { 'card.isAgent': false },
        ],
      },
      failMessage: '{{card.name}}: a Ringwraith cannot draft an agent character during the character draft',
    },
    {
      // Rule 1.43 (CoE 1.9.F2): a Fallen-wizard cannot reveal an Orc or Troll
      // character during the draft unless a drafted Stage resource
      // specifically allows it (e.g. Bad Company, wh-63).
      id: 'fw-draft-orc-troll',
      condition: {
        $or: [
          { 'card.isOrcOrTroll': false },
          { 'ctx.fwOrcTrollPermitted': true },
        ],
      },
      failMessage: '{{card.name}}: a Fallen-wizard cannot draft an Orc or Troll character without an enabling Stage resource (e.g. Bad Company)',
    },
  ],
};

/**
 * Rules governing the drafting of Fallen-wizard "Stage" resources (Thrall of
 * the Voice wh-82, Hidden Haven wh-75) during the character draft. These cards
 * sit in the same pool as characters but are not characters; only a
 * Fallen-wizard player may draft them.
 *
 * The context builder must provide:
 * - `card.name` — card name for messages
 * - `card.isStageResource` — whether this pool card is a recognized Stage resource
 * - `card.isAgentSummonsEnabler` — whether this card is an agent-summons enabler
 *   (Open to the Summons, wh-46), the one Stage resource a Ringwraith may draft
 *   "in lieu of a minor item" (CoE 1.9.R2)
 * - `ctx.isFallenWizard` — whether the drafting player is a Fallen-wizard
 * - `ctx.isRingwraith` — whether the drafting player is a Ringwraith
 * - `ctx.duplicationLimitReached` — true when the player has already drafted as
 *   many copies of this Stage resource as its player-scoped `duplication-limit`
 *   allows ("Cannot be duplicated by a given player" — Bad Company wh-63)
 */
export const STAGE_RESOURCE_DRAFT_RULES: RuleSet = {
  name: 'Stage Resource Draft Eligibility',
  rules: [
    {
      id: 'is-stage-resource',
      condition: { 'card.isStageResource': true },
      failMessage: '{{card.name}} is not a draftable Stage resource',
    },
    {
      // Stage resources are Fallen-wizard-only (CoE 1.9.F4), with one exception:
      // an agent-summons enabler (Open to the Summons, wh-46) is a Ringwraith
      // resource brought "in lieu of a minor item", so a Ringwraith may draft it
      // too (CoE 1.9.R2).
      id: 'fallen-wizard-only',
      condition: {
        $or: [
          { 'ctx.isFallenWizard': true },
          {
            $and: [
              { 'ctx.isRingwraith': true },
              { 'card.isAgentSummonsEnabler': true },
            ],
          },
        ],
      },
      failMessage: '{{card.name}} is a Fallen-wizard Stage resource and cannot be drafted by this player',
    },
    {
      // "Cannot be duplicated by a given player" (Bad Company wh-63): every
      // drafted Stage resource ends up in that player's play area (CoE 1.9.F4),
      // so a player-scoped duplication limit already bites during the draft.
      id: 'stage-resource-not-duplicated',
      condition: { 'ctx.duplicationLimitReached': false },
      failMessage: '{{card.name}} cannot be duplicated by a given player',
    },
  ],
};
