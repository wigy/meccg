/**
 * @module actions-site
 *
 * Action types for the Site phase.
 *
 * During the Site phase, companies enter sites to play resources (items,
 * allies, factions), face automatic attacks and on-guard hazards, and
 * attempt influence against opponent characters. These actions cover
 * entering sites, managing on-guard cards, playing resources, and
 * conducting influence attempts.
 */

import type { PlayerId, CardInstanceId, CompanyId } from './common.js';

/**
 * Declare that a company will enter its current site during the site phase.
 *
 * The alternative is to pass (do nothing), which ends the company's site
 * phase immediately. Entering commits the company to facing automatic
 * attacks, on-guard creatures, and agent attacks before any resources
 * can be played. (CoE lines 341–343)
 */
export interface EnterSiteAction {
  /** Action discriminant. */
  readonly type: 'enter-site';
  /** The resource player entering the site. */
  readonly player: PlayerId;
  /** The company entering its current site. */
  readonly companyId: CompanyId;
}

/**
 * Place a card face-down as an on-guard card at the active company's site
 * during the Movement/Hazard phase.
 *
 * Any card in the hazard player's hand may be placed on-guard (bluffing is
 * allowed). Only one on-guard placement per company per M/H phase.
 * Counts against the hazard limit.
 */
export interface PlaceOnGuardAction {
  /** Action discriminant. */
  readonly type: 'place-on-guard';
  /** The hazard player placing the on-guard card. */
  readonly player: PlayerId;
  /** The card instance being placed face-down. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Reveal an on-guard card placed on a company's site during the site phase.
 *
 * Used at two points:
 * - Step 1 (CoE line 345): when entering a site with automatic-attacks,
 *   the hazard player may reveal creatures keyed to the site or events
 *   affecting the automatic-attacks.
 * - During resource play (CoE line 376): when the resource player
 *   attempts to play a resource that taps the site, the hazard player
 *   may reveal an on-guard event that directly affects the company.
 */
export interface RevealOnGuardAction {
  /** Action discriminant. */
  readonly type: 'reveal-on-guard';
  /** The hazard player revealing the on-guard card. */
  readonly player: PlayerId;
  /** The on-guard card instance being revealed. */
  readonly cardInstanceId: CardInstanceId;
  /** Target character for hazard events "playable on a character" (e.g. Foolish Words). */
  readonly targetCharacterId?: CardInstanceId;
}

/**
 * Declare that an agent hazard at the company's site will attack.
 *
 * Step 3 of entering a site (CoE line 358). The agent must be revealed
 * when the attack is declared if not already revealed. An agent can
 * only attack once per site phase. Agent attacks are not keyed to anything.
 */
export interface DeclareAgentAttackAction {
  /** Action discriminant. */
  readonly type: 'declare-agent-attack';
  /** The hazard player declaring the agent attack. */
  readonly player: PlayerId;
  /** The agent card instance that will attack. */
  readonly agentInstanceId: CardInstanceId;
}

/**
 * Play a hero resource card (item, ally, or event) at the current site.
 *
 * Resources are the primary way to score marshalling points. The resource
 * must be playable at the company's current site type. Only one "major"
 * resource can typically be played per company per site phase.
 */
export interface PlayHeroResourceAction {
  readonly type: 'play-hero-resource';
  /** The active player playing the resource. */
  readonly player: PlayerId;
  /** The resource card instance to play from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The company at the site where the resource is being played. */
  readonly companyId: CompanyId;
  /** For items, the character who will carry the item. */
  readonly attachToCharacterId?: CardInstanceId;
}

/**
 * Attempt to influence a faction card using a character's influence.
 *
 * The influencing character rolls 2d6 and must meet or exceed the faction's
 * influence number, modified by the character's direct influence and any
 * racial bonuses. Success brings the faction under the player's control
 * for marshalling points.
 */
export interface InfluenceAttemptAction {
  readonly type: 'influence-attempt';
  /** The active player making the attempt. */
  readonly player: PlayerId;
  /** The faction card instance being played from hand. */
  readonly factionInstanceId: CardInstanceId;
  /** The character making the influence roll. */
  readonly influencingCharacterId: CardInstanceId;
  /** The unmodified 2d6 value needed for success (roll + modifiers >= influence #). */
  readonly need: number;
  /** Human-readable breakdown of the target number, DI, and bonuses. */
  readonly explanation: string;
}

/**
 * Declare an influence attempt against an opponent's in-play character or ally.
 *
 * The resource player taps one of their untapped characters to attempt to
 * influence away an opponent's card at the same site. This triggers a
 * two-roll resolution: the attacker rolls first, then the defender rolls.
 * The attacker's roll is modified by their unused DI, minus the opponent's
 * unused GI, minus the defender's roll, minus the controller's unused DI.
 * The result must exceed the target's mind value to succeed.
 *
 * CoE rules section 10, rules 10.10–10.12.
 */
export interface OpponentInfluenceAttemptAction {
  readonly type: 'opponent-influence-attempt';
  /** The resource player making the influence attempt. */
  readonly player: PlayerId;
  /** The untapped character being tapped to make the attempt. */
  readonly influencingCharacterId: CardInstanceId;
  /** The opponent player whose card is being targeted. */
  readonly targetPlayer: PlayerId;
  /** The instance ID of the opponent's card being influenced. */
  readonly targetInstanceId: CardInstanceId;
  /** Whether the target is a character or ally. */
  readonly targetKind: 'character' | 'ally';
  /**
   * Optional: instance ID of an identical card revealed from hand.
   * When set, the comparison value (target mind) is treated as 0.
   * The revealed card is removed from hand regardless of outcome;
   * on failure it goes to the discard pile.
   *
   * CoE rule 10.11: "the resource player may reveal an identical resource
   * card in their hand (of any alignment)".
   */
  readonly revealedCardInstanceId?: CardInstanceId;
  /** Human-readable breakdown of modifiers for the influence check. */
  readonly explanation: string;
}

/**
 * The hazard player rolls their defensive dice for an opponent influence attempt.
 *
 * After the resource player has rolled their attack dice, the hazard player
 * rolls 2d6 which is subtracted from the attacker's modified result.
 * The final result is then compared to the target's mind value.
 *
 * CoE rules section 10, rule 10.12 step 4.
 */
export interface OpponentInfluenceDefendAction {
  readonly type: 'opponent-influence-defend';
  /** The hazard player rolling the defensive dice. */
  readonly player: PlayerId;
  /** Human-readable breakdown of the influence check so the defender knows the situation before rolling. */
  readonly explanation: string;
}

/**
 * Execute the dice roll for a faction influence attempt.
 *
 * Created by the pending-resolution system after the chain of effects
 * has fully resolved. The game pauses so the UI can display a situation
 * banner with the target number, DI, and all modifiers before the player
 * commits to rolling.
 */
export interface FactionInfluenceRollAction {
  readonly type: 'faction-influence-roll';
  /** The resource player rolling. */
  readonly player: PlayerId;
  /** The faction card being influenced. */
  readonly factionInstanceId: CardInstanceId;
  /** The character making the influence roll. */
  readonly influencingCharacterId: CardInstanceId;
  /** The 2d6 value needed for success (roll + modifiers >= influence #). */
  readonly need: number;
  /** Human-readable breakdown of the target number, DI, and bonuses. */
  readonly explanation: string;
}

/**
 * Play a minor item on a character without requiring a specific site type.
 *
 * Minor items have relaxed play conditions compared to major/greater items.
 * They can sometimes be played as a "bonus" action that doesn't count as
 * the company's resource play for the phase.
 */
/**
 * Cancel an opponent's influence check by playing a cancel-influence card
 * from hand. The influence attempt is automatically canceled (no defensive
 * roll needed). The character who pays the cost makes a corruption check.
 *
 * Played during the opponent's site phase while an
 * `opponent-influence-defend` pending resolution is queued.
 */
export interface CancelInfluenceAction {
  readonly type: 'cancel-influence';
  /** The defending player canceling the influence attempt. */
  readonly player: PlayerId;
  /** The cancel-influence card played from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The character paying the cost (e.g. the wizard). */
  readonly characterId: CardInstanceId;
}

export interface PlayMinorItemAction {
  readonly type: 'play-minor-item';
  /** The active player playing the minor item. */
  readonly player: PlayerId;
  /** The minor item card instance to play from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The character at the site (used for proximity validation). */
  readonly characterId: CardInstanceId;
  /** The character who will carry the minor item. */
  readonly attachToCharacterId: CardInstanceId;
}
