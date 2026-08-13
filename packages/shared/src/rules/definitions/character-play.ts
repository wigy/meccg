/**
 * @module rules/definitions/character-play
 *
 * Declarative rules for playing a character during the organization phase
 * (rule 2.II.2.2 and friends). These are the sequential eligibility gates a
 * candidate character must pass before site selection and influence
 * (GI/DI) affordability are considered — those remain imperative in
 * `legal-actions/organization-characters.ts` because they generate per-site
 * and per-controller actions rather than a single pass/fail verdict.
 *
 * The context builder (server-side, `buildCharacterPlayContext`) must provide:
 * - `card.name` — character name for messages
 * - `card.isAvatar` — true when the card is an avatar (mind is null)
 * - `card.isRingwraithAvatar` — true when the card is a Ringwraith avatar
 * - `card.isHazardAgentOnly` — true when the card declares the
 *   `hazard-agent-only` play-flag (Lobelia dm-28, My Precious dm-29): such
 *   cards deploy only as agent hazards, never as company characters
 * - `card.isAgent` — whether the character carries the `agent` keyword
 * - `card.unique` — whether the character is unique
 * - `card.isOrcOrTroll` — true when the playing player is a Fallen-wizard and
 *   this candidate is an Orc or Troll character (Half-orcs are race Orc)
 * - `ctx.playsAsSauron` — true while the player counts as Sauron (The Lidless
 *   Eye le-203 / Sauron ba-43); Sauron may not reveal a Ringwraith
 * - `ctx.agentsAreHazards` — true for Wizard and Balrog players, for whom
 *   agent cards are hazards in all areas (rules 1.3.W2 / 1.3.B2)
 * - `ctx.characterPlayLimitReached` — true when a character was already played
 *   this turn and neither the buddy-play exception (troll-triplet co-play) nor
 *   the Balrog second-non-unique-character exception applies
 * - `ctx.uniqueAlreadyInPlay` — true when the card is unique and a copy is
 *   already in play (either player)
 * - `ctx.blockingManifestation` — name of an in-play manifestation of the same
 *   entity (glossary g.man.1), or null when none blocks the play
 * - `ctx.hasEliminatedAvatar` — true when this player's avatar has been
 *   eliminated (rule 2.I.5 / CoE 2.05: no second avatar reveal)
 * - `ctx.mustReplayReturnedRingwraith` — true when the player's Ringwraith was
 *   returned to hand and this card is a *different* Ringwraith (MELE §8.R1a)
 * - `ctx.opponentReturnedThisRingwraith` — true when this Ringwraith was
 *   returned to the *opponent's* hand and may not be revealed by this player
 *   (MELE §8.R1b)
 * - `ctx.differentWizardBlockedBySacrifice` — true when this player has
 *   sacrificed a Wizard via Sacrifice of Form (tw-321) and this candidate is a
 *   *different* Wizard avatar (rule 2.II.2.1.1)
 * - `ctx.opponentSacrificedThisWizard` — true when the opponent sacrificed
 *   this exact Wizard via Sacrifice of Form
 * - `ctx.fwOrcTrollPermitted` — true when `card.isOrcOrTroll` is false, or a
 *   Stage resource in play specifically allows Orc/Troll characters
 *   (CoE 2.II.2.2.F2, e.g. Bad Company wh-63)
 */

import type { RuleSet } from '../types.js';

/**
 * Sequential eligibility gates for playing a character from hand (or, for a
 * Balrog player, from discard/sideboard) during the organization phase. All
 * rules must pass before the imperative site/influence tail runs.
 */
export const CHARACTER_PLAY_RULES: RuleSet = {
  name: 'Character Play Eligibility',
  rules: [
    {
      // The Lidless Eye (le-203) / Sauron (ba-43): "You are Sauron, not a
      // Ringwraith. You may not reveal a Ringwraith..." (Ringwraith followers
      // are blocked separately in the follower path.)
      id: 'sauron-cannot-reveal-ringwraith',
      condition: {
        $or: [
          { 'card.isRingwraithAvatar': false },
          { 'ctx.playsAsSauron': false },
        ],
      },
      failMessage: '{{card.name}}: you are Sauron — you may not reveal a Ringwraith while The Lidless Eye is in play',
    },
    {
      // Pure "Hazard Agent" cards (Lobelia dm-28, My Precious dm-29) are
      // deploy-only: played only as agent hazards, never recruited/played as
      // company characters by any player.
      id: 'not-hazard-agent-only',
      condition: { 'card.isHazardAgentOnly': false },
      failMessage: '{{card.name}}: a hazard agent — can only be deployed as an agent, not played as a character',
    },
    {
      // Rules 1.3.W2 / 1.3.B2: Wizard and Balrog players treat agent cards as
      // hazards in all areas. Rule 2.II.2.2.5: only Ringwraith and
      // Fallen-wizard players may play agents as characters.
      id: 'agents-are-hazards',
      condition: {
        $or: [
          { 'card.isAgent': false },
          { 'ctx.agentsAreHazards': false },
        ],
      },
      failMessage: '{{card.name}}: agents are treated as hazard cards for Wizard/Balrog players and cannot be played as characters',
    },
    {
      // Rule: only one character play per turn. The context flag already
      // accounts for the buddy-play (troll-triplet co-play) and Balrog
      // second-non-unique-character exceptions.
      id: 'one-character-per-turn',
      condition: { 'ctx.characterPlayLimitReached': false },
      failMessage: '{{card.name}}: already played a character this turn',
    },
    {
      // Rule: unique characters cannot be in play twice.
      id: 'unique-not-in-play',
      condition: {
        $or: [
          { 'card.unique': false },
          { 'ctx.uniqueAlreadyInPlay': false },
        ],
      },
      failMessage: '{{card.name}}: unique character already in play',
    },
    {
      // Glossary g.man.1: only one manifestation of an entity may be in play,
      // regardless of alignment — e.g. Aragorn II (tw-120) cannot be played
      // normally while Strider (ba-1) is in play. The `manifestation-swap`
      // action is the sanctioned path.
      id: 'no-manifestation-in-play',
      condition: { 'ctx.blockingManifestation': null },
      failMessage: '{{card.name}}: {{ctx.blockingManifestation}}, a manifestation of the same entity, is already in play',
    },
    {
      // Rule 2.I.5 (CoE rule 2.05): a player whose avatar has been eliminated
      // cannot reveal another avatar.
      id: 'no-avatar-after-elimination',
      condition: {
        $or: [
          { 'card.isAvatar': false },
          { 'ctx.hasEliminatedAvatar': false },
        ],
      },
      failMessage: '{{card.name}}: cannot reveal another avatar after one was eliminated',
    },
    {
      // MELE §8.R1a: a player whose Ringwraith returned to hand may not reveal
      // a *different* Ringwraith before re-playing the returned one.
      id: 'replay-returned-ringwraith-first',
      condition: { 'ctx.mustReplayReturnedRingwraith': false },
      failMessage: '{{card.name}}: a Ringwraith has been returned to hand — you must re-play that Ringwraith before revealing a different one',
    },
    {
      // MELE §8.R1b: the opponent may not reveal the Ringwraith that was
      // returned to the other player's hand.
      id: 'opponent-returned-ringwraith',
      condition: { 'ctx.opponentReturnedThisRingwraith': false },
      failMessage: '{{card.name}}: the opponent\'s Ringwraith of this type was returned to their hand and may not be revealed by you',
    },
    {
      // Sacrifice of Form (tw-321): after a Wizard is sacrificed, the player
      // may not reveal a different Wizard (rule 2.II.2.1.1).
      id: 'no-different-wizard-after-sacrifice',
      condition: { 'ctx.differentWizardBlockedBySacrifice': false },
      failMessage: '{{card.name}}: a Wizard was sacrificed with Sacrifice of Form — you may not play a different Wizard',
    },
    {
      // Sacrifice of Form (tw-321): "your opponent may not play the Wizard you
      // sacrificed."
      id: 'opponent-sacrificed-wizard',
      condition: { 'ctx.opponentSacrificedThisWizard': false },
      failMessage: '{{card.name}}: your opponent sacrificed this Wizard with Sacrifice of Form and it may not be revealed by you',
    },
    {
      // CoE 2.II.2.2.F2: a Fallen-wizard player cannot play Orc or Troll
      // characters unless a Stage resource in play specifically allows it
      // (Bad Company wh-63 for any Orc/Troll; A Strident Spawn wh-61 for
      // Half-orcs).
      id: 'fw-orc-troll',
      condition: {
        $or: [
          { 'card.isOrcOrTroll': false },
          { 'ctx.fwOrcTrollPermitted': true },
        ],
      },
      failMessage: '{{card.name}}: a Fallen-wizard cannot play Orc or Troll characters without a Stage resource in play that allows it (e.g. Bad Company)',
    },
  ],
};
