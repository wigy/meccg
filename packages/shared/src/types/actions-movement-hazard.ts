/**
 * @module actions-movement-hazard
 *
 * Action types for the Movement/Hazard phase and combat.
 *
 * During Movement/Hazard, the resource player selects which company moves
 * next, declares the travel path, and the hazard player plays creatures
 * and hazards against the moving company. Combat actions handle strike
 * assignment, resolution, support, and body checks.
 */

import type { PlayerId, CardInstanceId, CardDefinitionId, CompanyId, MovementType } from './common.js';

/**
 * Select which company resolves its movement/hazard sub-phase next.
 *
 * At the start of the Movement/Hazard phase (and after each company finishes
 * its sub-phase), the resource player chooses which of the remaining unhandled
 * companies to process next. There is no pass option — a company must be selected.
 */
export interface SelectCompanyAction {
  readonly type: 'select-company';
  /** The resource player selecting the company. */
  readonly player: PlayerId;
  /** The company to handle next. */
  readonly companyId: CompanyId;
}

/**
 * Declare the movement type and site path for the current company.
 *
 * At step 2 of the Movement/Hazard phase, the resource player declares how
 * the company is moving. For starter movement, the path is derived from the
 * site card. For region movement, the player must specify the exact sequence
 * of regions traversed. Under-deeps and special movement have their own rules.
 */
export interface DeclarePathAction {
  readonly type: 'declare-path';
  /** The resource player declaring the path. */
  readonly player: PlayerId;
  /** The type of movement being used. */
  readonly movementType: MovementType;
  /**
   * For region movement: the ordered sequence of region card definition IDs
   * forming the travel path. Must be a valid connected path from the origin
   * site's region to the destination site's region, not exceeding the maximum
   * region count. Ignored for other movement types.
   */
  readonly regionPath?: readonly CardDefinitionId[];
}

/**
 * Submit the order in which ongoing effects should be applied at the start
 * of a company's Movement/Hazard phase (CoE step 4).
 *
 * The hazard player chooses the order for general ongoing effects.
 * Hazard-limit modifications are ordered separately by the resource player.
 * The submitted order must be a permutation of the pending effect IDs.
 */
export interface OrderEffectsAction {
  readonly type: 'order-effects';
  /** The hazard player submitting the effect order. */
  readonly player: PlayerId;
  /**
   * The card instance IDs of the ongoing effects, in the desired
   * resolution order (first element resolves first).
   */
  readonly effectOrder: readonly CardInstanceId[];
}

/**
 * Play a hazard card against the opponent's moving company.
 *
 * The non-active player plays hazards during the opponent's Movement/Hazard
 * phase. Creatures must be keyed to the company's travel path. The number
 * of hazards per company is limited by the hazard limit (company size).
 */
/**
 * Describes how a creature was keyed to the company's travel path.
 * Each match records the keying method and the specific value that matched.
 */
export interface CreatureKeyingMatch {
  /**
   * How the creature was keyed. `keying-bypass` is a special method used
   * when an active constraint (e.g. Dragon's Desolation Mode B) permits
   * the creature play without satisfying any path-based keying — the
   * `value` records the race that was whitelisted.
   */
  readonly method: 'region-type' | 'region-name' | 'site-type' | 'site-name' | 'keying-bypass';
  /** The specific value that matched (e.g. "wilderness", "Arthedain", "ruins-and-lairs", "The Lonely Mountain"). */
  readonly value: string;
}

export interface PlayHazardAction {
  readonly type: 'play-hazard';
  /** The player (the non-active player) playing the hazard. */
  readonly player: PlayerId;
  /** The hazard card instance to play from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The company being targeted by this hazard. */
  readonly targetCompanyId: CompanyId;
  /** For corruption hazards, the specific character being targeted. */
  readonly targetCharacterId?: CardInstanceId;
  /**
   * For site-targeting hazards (e.g. *River*), the site definition ID
   * the hazard is bound to. The card enters play in `cardsInPlay` with
   * `attachedToSite` set to this value, so the engine can fire the
   * `company-arrives-at-site` event hook only for arrivals at that
   * specific site location.
   */
  readonly targetSiteDefinitionId?: import('./common.js').CardDefinitionId;
  /** For creatures, describes which keying rule matched the travel path. */
  readonly keyedBy?: CreatureKeyingMatch;
  /**
   * For faction-targeting hazard short-events (e.g. Muster Disperses),
   * the in-play faction instance being targeted.
   */
  readonly targetFactionInstanceId?: CardInstanceId;
  /**
   * For hazard short-events with a creature-race-choice effect (e.g. Two
   * or Three Tribes Present), the race the player announced when playing.
   */
  readonly chosenCreatureRace?: string;
}

/**
 * Assign one of a creature's strikes to a specific character during combat.
 *
 * The defending player assigns strikes to their characters. Each character
 * typically receives at most one strike, but excess strikes (when there are
 * more strikes than characters) must be assigned to characters who already
 * have one.
 */
export interface AssignStrikeAction {
  readonly type: 'assign-strike';
  /** The defending player assigning the strike. */
  readonly player: PlayerId;
  /** The character who will face this strike. */
  readonly characterId: CardInstanceId;
  /** True when this is an excess strike (-1 prowess penalty) on an already-assigned character. */
  readonly excess?: boolean;
  /** Whether the character is currently tapped (informational, for UI display). */
  readonly tapped?: boolean;
}

/**
 * Resolve the current strike in combat by rolling dice.
 *
 * The defending character rolls 2d6 + their prowess against the creature's
 * prowess. If the roll meets or exceeds the target, the strike is defeated.
 * The character may choose to tap (exhaust) to gain +1 prowess for this strike.
 */
export interface ResolveStrikeAction {
  readonly type: 'resolve-strike';
  /** The defending player resolving the strike. */
  readonly player: PlayerId;
  /** Whether the character taps (exhausts) to gain +1 prowess bonus for this strike. */
  readonly tapToFight: boolean;
  /** The unmodified 2d6 value needed for the character to defeat the strike. */
  readonly need: number;
  /** Human-readable breakdown of character prowess vs creature prowess. */
  readonly explanation: string;
}

/**
 * Have an untapped character support another character's strike in combat.
 *
 * An untapped character in the same company can tap to give +1 prowess to
 * a companion facing a strike. This is declared before the strike is resolved.
 * The supporting character becomes tapped and cannot fight their own strike
 * at full strength.
 */
export interface SupportStrikeAction {
  readonly type: 'support-strike';
  /** The defending player using the support action. */
  readonly player: PlayerId;
  /** The untapped character who taps to provide support. */
  readonly supportingCharacterId: CardInstanceId;
  /** The character receiving the +1 prowess bonus. */
  readonly targetCharacterId: CardInstanceId;
}

/**
 * The defending player chooses which unresolved strike to resolve next.
 *
 * Per CRF: "In an order chosen by the defending player, each assigned
 * strike is then resolved by proceeding through an individual strike sequence."
 */
export interface ChooseStrikeOrderAction {
  /** Action discriminant. */
  readonly type: 'choose-strike-order';
  /** The defending player choosing the strike order. */
  readonly player: PlayerId;
  /** Index into strikeAssignments for the strike to resolve next. */
  readonly strikeIndex: number;
  /** The character facing this strike (informational, for UI display). */
  readonly characterId?: CardInstanceId;
  /** Whether the character is currently tapped (informational, for UI display). */
  readonly tapped?: boolean;
}

/**
 * Cancel an entire attack against the defending company by discarding a
 * short event card from hand. When the card requires a skill cost, a
 * character is tapped; otherwise (e.g. Dark Quarrels) just playing the
 * card suffices. Only legal during assign-strikes before any strikes
 * have been assigned (MECCG pre-assignment window).
 */
export interface CancelAttackAction {
  /** Action discriminant. */
  readonly type: 'cancel-attack';
  /** The defending player canceling the attack. */
  readonly player: PlayerId;
  /** The short event card being played from hand (e.g. Concealment). */
  readonly cardInstanceId: CardInstanceId;
  /** The character being tapped to pay the cost. Absent for costless cancel-attacks. */
  readonly scoutInstanceId?: CardInstanceId;
  /**
   * The character to wound after the attack is cancelled. Set when the card
   * carries a `wound-target-character` effect (e.g. Escape): one action is
   * generated per unwounded character in the defending company, each carrying
   * that character's instance ID here.
   */
  readonly targetCharacterId?: CardInstanceId;
}

/**
 * Tap an in-play item attached to a character in the defending company to
 * modify the current attack's prowess and/or body. The modifiers are
 * applied uniformly to every strike (prowess) and to the creature body
 * check (body). Only legal during assign-strikes before any strikes have
 * been assigned.
 */
export interface ModifyAttackAction {
  /** Action discriminant. */
  readonly type: 'modify-attack';
  /** The defending player activating the item. */
  readonly player: PlayerId;
  /** The in-play item paying its tap cost (or being discarded). */
  readonly cardInstanceId: CardInstanceId;
  /** The character whose item is being activated. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Tap an in-play item to boost the bearer's prowess for the single
 * strike currently being resolved. Legal during `resolve-strike` when
 * the item is untapped and belongs to the character currently assigned
 * the strike. The prowess bonus is accumulated on the current
 * {@link StrikeAssignment.strikeProwessBonus}.
 *
 * Used by Shield of Iron-bound Ash (tw-327) — tap to gain +1 prowess
 * against one strike.
 */
export interface TapItemForStrikeAction {
  /** Action discriminant. */
  readonly type: 'tap-item-for-strike';
  /** The defending player tapping the item. */
  readonly player: PlayerId;
  /** The in-play item being tapped. */
  readonly cardInstanceId: CardInstanceId;
  /** The character bearing the item (must be the current strike target). */
  readonly characterInstanceId: CardInstanceId;
  /** The 2d6 value needed after applying this item's prowess bonus. */
  readonly need: number;
  /** Human-readable breakdown of the modified prowess vs creature prowess. */
  readonly explanation: string;
}

/**
 * Halve the number of strikes in the current attack (rounded up) by
 * discarding a short event card from hand. Only legal during the
 * assign-strikes phase before any strikes have been assigned.
 */
export interface HalveStrikesAction {
  /** Action discriminant. */
  readonly type: 'halve-strikes';
  /** The defending player playing the card. */
  readonly player: PlayerId;
  /** The short event card being played from hand. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Discard a short event card from hand to modify the current attack's
 * strike prowess and/or creature body. Played by the attacker or
 * defender per the card's `modify-attack-from-hand` effect. Only legal
 * during assign-strikes before any strikes have been assigned.
 *
 * Used by Dragon's Desolation (tw-29) Mode A — hazard player plays to
 * give +2 prowess to a Dragon attack.
 */
export interface ModifyAttackFromHandAction {
  /** Action discriminant. */
  readonly type: 'modify-attack-from-hand';
  /** The player playing the card from hand. */
  readonly player: PlayerId;
  /** The short event card being played from hand. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * The defending player taps a non-target character in the company to
 * cancel one of a multi-attack creature's strikes (e.g. Assassin).
 * Available during the 'cancel-by-tap' assignment sub-phase.
 */
export interface CancelByTapAction {
  /** Action discriminant. */
  readonly type: 'cancel-by-tap';
  /** The defending player canceling a strike. */
  readonly player: PlayerId;
  /** The character being tapped to cancel one attack. */
  readonly characterId: CardInstanceId;
}

/**
 * The attacking player rolls for a body check after a strike is resolved.
 * The opponent rolls 2d6 against the target's body value to determine
 * if the entity (character or creature) is eliminated/defeated.
 */
export interface BodyCheckRollAction {
  /** Action discriminant. */
  readonly type: 'body-check-roll';
  /** The player rolling the body check (attacking player). */
  readonly player: PlayerId;
  /** The unmodified 2d6 value needed to eliminate the target (roll >= body). */
  readonly need: number;
  /** Human-readable breakdown of the body check target. */
  readonly explanation: string;
}

/**
 * Transfer one item from an eliminated character to an unwounded companion
 * in the same company. Available during the 'item-salvage' combat phase
 * after a character is eliminated by a body check (CoE rule 3.I.2).
 */
export interface SalvageItemAction {
  /** Action discriminant. */
  readonly type: 'salvage-item';
  /** The defending player performing the salvage. */
  readonly player: PlayerId;
  /** The item being transferred from the eliminated character. */
  readonly itemInstanceId: CardInstanceId;
  /** The unwounded character in the company receiving the item. */
  readonly recipientCharacterId: CardInstanceId;
}

/**
 * Cancel a strike against a character by having another character in
 * the same company pay a cost (e.g. Fatty Bolger taps to cancel a
 * strike against another hobbit).
 */
export interface CancelStrikeAction {
  /** Action discriminant. */
  readonly type: 'cancel-strike';
  /** The defending player canceling the strike. */
  readonly player: PlayerId;
  /** The character paying the cost (tapping) to cancel the strike. */
  readonly cancellerInstanceId: CardInstanceId;
  /** The character whose strike is being canceled. */
  readonly targetCharacterId: CardInstanceId;
}

/**
 * Play a dodge-strike card from hand during resolve-strike to let the
 * target character resolve the strike at full prowess without tapping
 * (unless wounded by the strike).
 */
export interface PlayDodgeAction {
  /** Action discriminant. */
  readonly type: 'play-dodge';
  /** The defending player playing the dodge card. */
  readonly player: PlayerId;
  /** The dodge card instance being played from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The unmodified 2d6 value needed with dodge prowess. */
  readonly need: number;
  /** Human-readable breakdown of dodging character's prowess vs creature prowess. */
  readonly explanation: string;
}

/**
 * Play a modify-strike short event (e.g. Risky Blow) from hand during
 * resolve-strike. The card is discarded and its prowess bonus /
 * body penalty are accumulated onto the current strike.
 */
export interface PlayStrikeEventAction {
  /** Action discriminant. */
  readonly type: 'play-strike-event';
  /** The defending player playing the card. */
  readonly player: PlayerId;
  /** The short-event card instance being played from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The 2d6 value needed after applying this card's prowess bonus. */
  readonly need: number;
  /** Human-readable breakdown of the modified prowess vs creature prowess. */
  readonly explanation: string;
}

/**
 * Play a reroll-strike card from hand during resolve-strike. The target
 * character resolves the strike normally (tap-to-fight, full prowess)
 * but two 2d6 rolls are made and the better total is used.
 *
 * Example: Lucky Strike — warrior only; make two rolls against a strike
 * and choose one of the two results to use.
 */
export interface PlayRerollStrikeAction {
  /** Action discriminant. */
  readonly type: 'play-reroll-strike';
  /** The defending player playing the reroll card. */
  readonly player: PlayerId;
  /** The reroll card instance being played from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The unmodified 2d6 value needed to defeat the strike (tap prowess). */
  readonly need: number;
  /** Human-readable breakdown of character's prowess vs creature prowess. */
  readonly explanation: string;
}

/**
 * Execute the dice roll for a Muster Disperses muster check.
 *
 * Created by the pending-resolution system when a faction-targeting
 * hazard short-event resolves. The faction's owner rolls 2d6 + unused
 * general influence; if the total is less than 11, the faction is
 * discarded.
 */
export interface MusterRollAction {
  readonly type: 'muster-roll';
  /** The faction owner rolling. */
  readonly player: PlayerId;
  /** The targeted faction card instance. */
  readonly factionInstanceId: CardInstanceId;
  /** The 2d6 value needed for the faction to survive (roll + unused GI >= 11). */
  readonly need: number;
  /** Human-readable breakdown of the muster check. */
  readonly explanation: string;
}

/**
 * Accept a pending haven-join-attack offer — move the character from their
 * haven company into the attacked company before strikes are assigned.
 *
 * Created by `on-event: creature-attack-begins` + `apply: offer-char-join-attack`
 * (e.g. Alatar). Available during the assign-strikes cancel-window. The
 * character's allies are discarded (per the offer's configuration), a strike
 * is forced onto them, and post-combat side-effects are scheduled.
 */
export interface HavenJoinAttackAction {
  /** Action discriminant. */
  readonly type: 'haven-join-attack';
  /** The defending player (owner of both the haven company and the attacked company). */
  readonly player: PlayerId;
  /** The character instance being moved into the attacked company. */
  readonly characterId: CardInstanceId;
}

/**
 * Execute the dice roll for a Call of Home check on a character.
 *
 * Created by the pending-resolution system after a hazard short event
 * with a `call-of-home-check` effect resolves. The character's player
 * rolls 2d6; if roll + unused general influence < threshold, the
 * character returns to hand.
 */
export interface CallOfHomeRollAction {
  /** Action discriminant. */
  readonly type: 'call-of-home-roll';
  /** The character's player (who rolls). */
  readonly player: PlayerId;
  /** The targeted character instance. */
  readonly targetCharacterId: CardInstanceId;
  /** The 2d6 value needed for the character to stay (roll + GI >= this). */
  readonly need: number;
  /** Human-readable breakdown of the check. */
  readonly explanation: string;
}
