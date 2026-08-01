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

import type { PlayerId, CardInstanceId, CardDefinitionId, CompanyId, MovementType, Race } from './common.js';

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
  readonly method: 'region-type' | 'region-name' | 'site-type' | 'site-name' | 'site-keyword' | 'adjacent-to-site-keyword' | 'keying-bypass';
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
   * For hazards played on an opponent's stored item (e.g. Neither so Ancient
   * Nor so Potent dm-73), the stored item instance (in the opponent's
   * marshalling-point pile) being targeted.
   */
  readonly targetStoredItemInstanceId?: CardInstanceId;
  /**
   * For hazard short-events with a creature-race-choice effect (e.g. Two
   * or Three Tribes Present), the race the player announced when playing.
   */
  readonly chosenCreatureRace?: Race;
  /**
   * For hazard short-events that tap an agent at the target company's new
   * site (e.g. An Article Missing dm-43, Cunning Foes dm-50), the agent
   * character instance being tapped. The agent must be at the destination site.
   */
  readonly agentInstanceId?: CardInstanceId;
  /**
   * For a hazard permanent-event played on one of the hazard player's own
   * face-down agents (Inner Cunning dm-68, mode 1), the agent's virtual-company
   * id. The card enters play in the hazard player's `cardsInPlay` with
   * `attachedToAgentId` set to this value.
   */
  readonly targetAgentId?: CompanyId;
  /**
   * For tap-agent-at-site effects where the agent is face-down: a home
   * site instance from the hazard player's location deck to place with the
   * agent on reveal. If absent, the agent is revealed without a home site
   * and discarded at end of turn (rule 9.04).
   */
  readonly homeSiteInstanceId?: CardInstanceId;
  /**
   * For Stay Her Appetite (le-140): the ally instance being targeted.
   * The ally must be in the target company's characters' ally lists.
   */
  readonly targetAllyId?: CardInstanceId;
  /**
   * For hazard short-events declaring `play-option` effects (e.g. Weariness
   * of the Heart le-149), the id of the chosen option. The legal-action
   * generator emits one `play-hazard` action per (character, option) pair;
   * the chain resolver dispatches the selected option's `apply` clause.
   */
  readonly optionId?: string;
  /**
   * For an untargeted `play-option` mode whose apply acts on one specific card
   * instance (Returned Beyond All Hope as-35: the creature in the discard pile,
   * the Maia permanent-event in play, or the eliminated creature to recover),
   * the instance the player declared when playing. Drawn from the option's
   * `candidates` pool; threaded onto the chain payload and consumed by the
   * chain resolver.
   */
  readonly optionTargetInstanceId?: CardInstanceId;
  /**
   * For dual-mode hazard-creature cards (`creature-alt-event`, e.g. Mouth of
   * Sauron tw-65), selects the alternative event mode instead of normal
   * keyed-creature combat. When set, the card is played as an event of this
   * kind against the target company (counting against the hazard limit); its
   * top-level effects resolve through the corresponding event chain path.
   */
  readonly altEventMode?: 'short-event' | 'permanent-event';
  /**
   * For hazard short-events carrying a {@link PlayDiscardCostEffect} (e.g. Faces
   * of the Dead dm-57: "discard any Undead hazard creature from your hand"), the
   * hand card the playing player discards to pay the play cost. The legal-action
   * generator emits one action per (target × matching cost card) so the player
   * chooses which card to sacrifice; the reducer moves it to the discard pile.
   */
  readonly costDiscardInstanceId?: CardInstanceId;
}

/**
 * Tap an in-play dual-mode creature that was played as a permanent-event
 * (`creature-alt-event` mode `permanent-event`, e.g. Adûnaphel tw-2, Ûvatha
 * tw-107) during the opponent's movement/hazard phase. Per the card text, when
 * tapped the permanent-event "becomes a short-event": it is removed from play,
 * discarded, counts one against the hazard limit, and its on-tap effects
 * resolve through the ordinary short-event chain path (e.g. tw-107 fetches a
 * hazard creature from discard to hand; tw-2 taps a chosen character).
 */
export interface TapAltPermanentEventAction {
  readonly type: 'tap-alt-permanent-event';
  /** The hazard player tapping their in-play creature-permanent-event. */
  readonly player: PlayerId;
  /** The creature-permanent-event instance in `cardsInPlay`. */
  readonly cardInstanceId: CardInstanceId;
  /**
   * For a `tap-character` on-tap effect (tw-2), the character to tap. The
   * legal-action generator emits one action per eligible target character.
   */
  readonly targetCharacterId?: CardInstanceId;
}

/**
 * My Precious (dm-29): resolving an `agent-play-manifestation-offer` — the
 * defender taps one character in the target company and plays the agent's other
 * manifestation (Gollum) from hand; the attacking agent is then discarded. (The
 * defender may instead `pass`, leaving the agent in play.)
 */
export interface PlayAgentManifestationAction {
  readonly type: 'play-agent-manifestation';
  /** The defending (resource) player. */
  readonly player: PlayerId;
  /** The attacking agent to discard. */
  readonly agentId: CompanyId;
  /** The character in the target company to tap. */
  readonly characterId: CardInstanceId;
  /** The manifestation card (Gollum) in the defender's hand to play. */
  readonly manifestationCardInstanceId: CardInstanceId;
}

/**
 * Sideboarding with a Nazgûl (rule 5.24).
 *
 * As an action during the movement/hazard phase's play-hazards step, the
 * hazard player may tap and discard an untapped Nazgûl permanent-event they
 * control (a hazard-event carrying the `Nazgûl` keyword, currently in
 * `cardsInPlay`) to either bring up to five hazards from their sideboard to
 * their discard pile, or — if their play deck has at least five cards —
 * bring one hazard from their sideboard directly into their play deck and
 * shuffle. The Nazgûl's normal tap effect (converting to a short-event)
 * does not apply; it is discarded on declaration. Counts as one against the
 * hazard limit. Follow-up card picks use the shared
 * {@link FetchHazardFromSideboardAction} (same action, reused across the
 * untap-phase and movement/hazard-phase sideboard sub-flows).
 */
export interface SideboardWithNazgulAction {
  readonly type: 'sideboard-with-nazgul';
  /** The hazard player tapping and discarding the Nazgûl. */
  readonly player: PlayerId;
  /** The Nazgûl permanent-event instance in `cardsInPlay`. */
  readonly cardInstanceId: CardInstanceId;
  /** Which sub-option is being taken. */
  readonly destination: 'discard' | 'deck';
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
  /**
   * CvCC only: the attacking character who is backing this strike.
   * Set during the attacker-phase assignment step. Absent for creature combat.
   */
  readonly attackingCharacterId?: CardInstanceId;
}

/**
 * CvCC only — allocate one excess strike as a -1 prowess modifier to the
 * defending character currently facing their strike (rule 3.V.ii).
 * Available during Step 2 (attacker's window before the defender resolves).
 * The last strike to resolve forces any remaining excess to be applied.
 */
export interface AllocateCvccExcessAction {
  readonly type: 'allocate-cvcc-excess';
  readonly player: PlayerId;
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
 * The attacking player rolls 2d6 for the agent's strike in agent combat.
 *
 * Rule 3.iv.6.1: for agent hazard attacks, both players roll simultaneously.
 * The attacker rolls first and adds the agent's modified prowess. The defender
 * then rolls and adds character prowess. The character's total is compared
 * against the agent's total to determine the outcome.
 */
export interface AgentStrikeRollAction {
  readonly type: 'agent-strike-roll';
  /** The attacking (hazard) player rolling for the agent. */
  readonly player: PlayerId;
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
  /**
   * Which mode of a dual-mode cancel card the player chose. `"cancel"` (the
   * default when absent) cancels the attack outright; `"reduce-prowess"`
   * instead lowers the attack's prowess by the effect's `prowessPenalty`. Set
   * only for cards that declare a `prowessPenalty` (e.g. The Tormented Earth,
   * as-102). `"free-later-cancel"` is the deferred free cancellation granted by
   * a `free-attack-cancel` constraint (Darkness Wielded ba-55): no card is
   * played from hand — `cardInstanceId` names the granting card (now in discard)
   * only for logging; the constraint is consumed and the attack cancelled
   * immediately.
   */
  readonly mode?: 'cancel' | 'reduce-prowess' | 'free-later-cancel';
  /**
   * The replacement site chosen from the canceling player's location deck, set
   * only for a `cancel-attack` effect carrying a `siteSwap` payload (Farmer
   * Maggot as-48). Resolving the action swaps the defending company's current
   * site card for this one before the attack is canceled.
   */
  readonly replacementSiteInstanceId?: CardInstanceId;
}

/**
 * Play a resource permanent-event carrying a `convert-creature-to-ally`
 * effect (e.g. Ready to His Will le-220) during the creature's attack. All of
 * the creature's attacks are canceled and the creature becomes an ally
 * controlled by `controllingCharacterId`, which taps.
 */
export interface ConvertCreatureToAllyAction {
  /** Action discriminant. */
  readonly type: 'convert-creature-to-ally';
  /** The defending player playing the event. */
  readonly player: PlayerId;
  /** The permanent-event card being played from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The character that takes control of the new ally (and taps, if the card requires it). */
  readonly controllingCharacterId: CardInstanceId;
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
  /** The player activating the card (defending player for items; attacker or defender for hand cards). */
  readonly player: PlayerId;
  /** The item or hand card being activated. */
  readonly cardInstanceId: CardInstanceId;
  /**
   * The character whose item is being activated.
   * Absent when the card is played from hand (`fromHand` effect flag).
   */
  readonly characterInstanceId?: CardInstanceId;
}

/**
 * Apply an in-play card's optional `attacker-attack-option` to the current
 * combat: the attacking (hazard) player chooses to modify a matching-race
 * attack their opponent faces (e.g. Ungoliant's Progeny ba-27 — a Spider
 * attack gains +1 prowess and becomes detainment). Legal only in the
 * attacking player's `resolve-strike` Step 1 window before any strike has
 * resolved, and only once per attack.
 */
export interface ApplyAttackerAttackOptionAction {
  /** Action discriminant. */
  readonly type: 'apply-attacker-attack-option';
  /** The attacking (hazard) player applying the option. */
  readonly player: PlayerId;
  /** The in-play card whose `attacker-attack-option` effect is applied. */
  readonly cardInstanceId: CardInstanceId;
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
 * Tap an in-play `face-strike-on-tap` item (e.g. Bow of Alatar wh-90) during
 * the `assign-strikes` defender phase to let its bearer face one of the
 * attack's strikes regardless of the attack's normal capabilities and the
 * bearer's status. Legal while the item is untapped, its bearer is in the
 * defending company, and an unassigned strike remains. Taps the item and adds a
 * strike assignment to the bearer flagged to reduce the attack's body if the
 * bearer parries it.
 */
export interface FaceStrikeOnTapAction {
  /** Action discriminant. */
  readonly type: 'face-strike-on-tap';
  /** The defending player tapping the item. */
  readonly player: PlayerId;
  /** The in-play `face-strike-on-tap` item being tapped. */
  readonly cardInstanceId: CardInstanceId;
  /** The character bearing the item (must be in the defending company). */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Tap an in-play `combat-cancel-weapon` item (Whip of Many Thongs ba-82) during
 * a company-vs-company combat to cancel all effects of one chosen weapon in the
 * opponent's company until the end of the combat. Legal while the combat is
 * CvCC, the item is untapped and borne by The Balrog in a participating
 * company, and the target is an un-suppressed `weapon`-keyword item on a
 * character in the opposing company. Taps the item and adds the target weapon
 * to {@link CombatState.suppressedWeaponInstanceIds}; the weapon is not
 * discarded.
 */
export interface CancelWeaponEffectsAction {
  /** Action discriminant. */
  readonly type: 'cancel-weapon-effects';
  /** The player tapping the item (the controller of The Balrog). */
  readonly player: PlayerId;
  /** The in-play `combat-cancel-weapon` item being tapped (the Whip). */
  readonly cardInstanceId: CardInstanceId;
  /** The opponent-company weapon item whose effects are cancelled. */
  readonly weaponInstanceId: CardInstanceId;
}

/**
 * Tap an in-play ally during combat to grant an attack-scoped stat boost to
 * matching characters in the ally's own company (e.g. Great Lord of
 * Goblin-gate as-75: "Tap to give +2 prowess to all Orcs in its company").
 * The ally carries a `combat-tap-company-boost` effect; activating it taps the
 * ally and adds attack-scoped `character-stat-modifier` constraints.
 */
export interface TapAllyCombatBoostAction {
  /** Action discriminant. */
  readonly type: 'tap-ally-combat-boost';
  /** The player who owns the ally being tapped. */
  readonly player: PlayerId;
  /** The in-play ally being tapped. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Tap an in-play ally during the `body-check` combat phase to add its
 * `ally-body-check-boost` value to its controlling character's effective
 * body for the pending body check (e.g. War-warg le-156: "tap War-warg to
 * give +2 body to its controlling character"). Offered only when the ally
 * and its controlling character were both struck by the same attack.
 */
export interface TapAllyBodyCheckBoostAction {
  /** Action discriminant. */
  readonly type: 'tap-ally-body-check-boost';
  /** The player who owns the ally being tapped. */
  readonly player: PlayerId;
  /** The in-play ally being tapped. */
  readonly cardInstanceId: CardInstanceId;
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
  /**
   * In the "cancel a strike against a wounded character" variant (Carrion
   * Feeders ba-11, `cancelStrikeAgainstWounded`), the wounded character whose
   * pre-assigned strike is removed. Absent for the single-target Assassin
   * variant, which pops the last assignment.
   */
  readonly strikeCharacterId?: CardInstanceId;
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
 * Roll 2d6 to determine whether the Sable Shield is discarded after absorbing
 * a successful strike. Available during the 'shield-discard-roll' combat phase.
 * Offered to the attacking player (who "makes the roll" per card text). If the
 * roll strictly exceeds the item's {@link AbsorbWoundEffect.rollThreshold},
 * the shield is discarded; otherwise it stays in play. Combat then continues
 * to the next strike or finalization.
 *
 * Used by *Sable Shield* (le-341).
 */
export interface ShieldDiscardRollAction {
  /** Action discriminant. */
  readonly type: 'shield-discard-roll';
  /** The attacking player rolling. */
  readonly player: PlayerId;
  /** The threshold: shield is discarded if roll strictly exceeds this value. */
  readonly rollThreshold: number;
  /** The instance ID of the shield item being checked. */
  readonly itemInstanceId: CardInstanceId;
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
 * Discard one item from the defending company after a successful agent strike
 * with `strikeEffect: 'discard-item'` (An Article Missing, dm-43).
 * The defending character is not wounded; instead the company loses an item.
 * Available during the 'discard-item-from-company' combat phase.
 */
export interface DiscardItemFromCompanyAction {
  /** Action discriminant. */
  readonly type: 'discard-item-from-company';
  /** The defending player performing the discard. */
  readonly player: PlayerId;
  /** The instance ID of the item being discarded. */
  readonly itemInstanceId: CardInstanceId;
}

/**
 * Resolve one repetition of a `nazgul-multi-cancel` pending resolution
 * (Praise to Elbereth tw-305): tap `characterId` (must be untapped, owned by
 * the actor) to cancel the Nazgûl-keyworded card at `targetInstanceId` — an
 * unresolved chain entry or an in-play card. The resolution stays queued
 * afterward so the actor may repeat with a different character/target pair;
 * `pass` ends the window.
 */
export interface NazgulMultiCancelTapAction {
  /** Action discriminant. */
  readonly type: 'nazgul-multi-cancel-tap';
  /** The declaring player (owner of `characterId`). */
  readonly player: PlayerId;
  /** The untapped character being tapped to pay for this cancellation. */
  readonly characterId: CardInstanceId;
  /** The Nazgûl-keyworded chain entry or in-play card being canceled. */
  readonly targetInstanceId: CardInstanceId;
}

/**
 * Resolve a `force-discard-card` pending resolution: the actor picks one
 * candidate card (a ring) to discard. Used by *Rolled down to the Sea*
 * (wh-29), where the card-player's opponent must discard one ring from their
 * hand or from one of their characters.
 */
export interface ForceDiscardCardAction {
  /** Action discriminant. */
  readonly type: 'force-discard-card';
  /** The player forced to discard (the card-player's opponent). */
  readonly player: PlayerId;
  /** The chosen ring instance to discard (from hand or a character). */
  readonly cardInstanceId: CardInstanceId;
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
 * Play a `flee-from-strike` permanent-event (e.g. Fled into Darkness ba-18)
 * from hand during the resolve-strike sub-phase. The current strike against
 * the named character (The Balrog) is canceled, the character taps if untapped,
 * and the card enters play with a one-shot skip-next-untap constraint.
 */
export interface FleeFromStrikeAction {
  /** Action discriminant. */
  readonly type: 'flee-from-strike';
  /** The defending player playing the card. */
  readonly player: PlayerId;
  /** The `flee-from-strike` card being played from hand. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Play a `protect-from-strike-assignment` short event (e.g. Ruse mode B)
 * from hand during the assign-strikes phase. The targeted character cannot
 * be assigned any strike from the current attack.
 */
export interface ProtectFromStrikeAssignmentAction {
  /** Action discriminant. */
  readonly type: 'protect-from-assignment';
  /** The defending player playing the card. */
  readonly player: PlayerId;
  /** The short event card (e.g. Ruse) being played from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The character to protect — must have the required skill. */
  readonly targetCharacterId: CardInstanceId;
}

/**
 * Play a strike-modifier short event (Dodge, Risky Blow, Lucky Strike, etc.)
 * from hand during resolve-strike. The engine consults the card's
 * `strike-modifier` effect to determine the resolution mode (dodge, reroll,
 * or prowess/body modifier). All three share the same action shape.
 */
export interface PlayStrikeEventAction {
  /** Action discriminant. */
  readonly type: 'play-strike-event';
  /** The defending player playing the card. */
  readonly player: PlayerId;
  /** The strike-modifier card instance being played from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The 2d6 value needed (tap or dodge prowess, or unmodified need for reroll). */
  readonly need: number;
  /** Human-readable breakdown of the modified prowess vs creature prowess. */
  readonly explanation: string;
}

/**
 * Resolve a pending generic `dice-check` resolution (P08): roll 2d6, apply the
 * kind's modifiers/threshold/comparison, and run its onPass/onFail. Shared by
 * every collapsed roll-vs-threshold check (muster, glamour, cvcc-ally-discard,
 * call-of-home, body-check) — the kind on the pending resolution carries all
 * the per-check data, so this action only identifies the rolling player.
 */
export interface ResolveDiceCheckAction {
  readonly type: 'resolve-dice-check';
  /** The player rolling (the resolution's actor). */
  readonly player: PlayerId;
  /** Human-readable breakdown of the check (roll target vs threshold). */
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
 * Execute the dice roll for a flattery attempt (td-116 Flatter a Foe).
 *
 * Created by the pending-resolution system after Flatter a Foe's chain
 * entry resolves. The defending player rolls 2d6; total = roll + unusedDI
 * (+ diplomat bonus). If total > threshold, the attack is cancelled and
 * the hazard limit decreases.
 */
export interface FlateryAttemptRollAction {
  /** Action discriminant. */
  readonly type: 'flattery-attempt';
  /** The defending player (who rolls). */
  readonly player: PlayerId;
  /** The character making the flattery attempt. */
  readonly characterInstanceId: CardInstanceId;
  /** roll >= need means success (already accounts for DI and diplomat bonus). */
  readonly need: number;
  /** Human-readable breakdown of the check. */
  readonly explanation: string;
}

/**
 * Discard a company item and execute the dice roll for a goodwill attempt
 * (dm-160 Token of Goodwill).
 *
 * Created by the pending-resolution system after the diplomat passes his
 * corruption check. The player picks which qualifying item to discard;
 * the discard and the roll (2d6 + unused DI) happen together. If the total
 * exceeds the threshold, the attack is cancelled.
 */
export interface GoodwillAttemptRollAction {
  /** Action discriminant. */
  readonly type: 'goodwill-attempt';
  /** The defending player (who rolls). */
  readonly player: PlayerId;
  /** The diplomat making the goodwill attempt. */
  readonly characterInstanceId: CardInstanceId;
  /** The company item discarded to enable the roll. */
  readonly itemInstanceId: CardInstanceId;
  /** roll >= need means success (already accounts for unused DI). */
  readonly need: number;
  /** Human-readable breakdown of the check. */
  readonly explanation: string;
}

/**
 * Roll 2d6 for the Under-deeps movement check.
 *
 * Required when a company moves from an Under-deeps site to an adjacent
 * site and the adjacency number on the origin card is > 0 (CoE 2.IV.i.1).
 * The resource player rolls; if the total is less than the required number
 * the company stays and the destination is returned to the location deck.
 */
export interface UnderDeepsRollAction {
  /** Action discriminant. */
  readonly type: 'under-deeps-roll';
  /** The resource player rolling. */
  readonly player: PlayerId;
}

/**
 * Gangways over the Fire (ba-60): during the `gangways-offer` step the active
 * player selects a new Under-deeps destination for the company that just
 * finished its movement/hazard phase, triggering another Under-deeps
 * movement/hazard phase (with a cumulative roll penalty). Passing instead
 * finishes the company.
 */
export interface GangwaysExtraMoveAction {
  /** Action discriminant. */
  readonly type: 'gangways-extra-move';
  /** The active (resource) player. */
  readonly player: PlayerId;
  /** The company taking another Under-deeps movement/hazard phase. */
  readonly companyId: CompanyId;
  /** The chosen Under-deeps destination site (an instance in the site deck). */
  readonly destinationSite: CardInstanceId;
}

/**
 * `grant-extra-mh-phase` resources (Forced March le-185, Bridge tw-202, Leg It
 * Double Quick le-202, Ûvatha Unleashed le-248): during the `extra-mh-move-offer`
 * step the active player chooses a new destination for the company that just
 * completed its movement/hazard phase, sending it on another movement (a fresh
 * movement/hazard phase). Passing instead finishes the company.
 */
export interface ExtraMHMoveAction {
  /** Action discriminant. */
  readonly type: 'extra-mh-move';
  /** The active (resource) player. */
  readonly player: PlayerId;
  /** The company taking another movement/hazard phase. */
  readonly companyId: CompanyId;
  /** The chosen destination site (an instance in the site deck). */
  readonly destinationSite: CardInstanceId;
}

/**
 * `ally-tap-extra-mh-phase` (Shadowfax tw-326): during the `ally-tap-mh-offer`
 * step the active player taps the qualifying untapped ally to advance to the
 * shared `extra-mh-move-offer` step for the company that just completed its
 * movement/hazard phase. Passing instead finishes the company without tapping
 * the ally.
 */
export interface AllyTapExtraMHPhaseAction {
  /** Action discriminant. */
  readonly type: 'ally-tap-extra-mh-phase';
  /** The active (resource) player. */
  readonly player: PlayerId;
  /** The company that just completed its movement/hazard phase. */
  readonly companyId: CompanyId;
  /** The ally instance being tapped (e.g. Shadowfax). */
  readonly allyInstanceId: CardInstanceId;
}

/**
 * Tap an in-play ally (Goldberry) to negate a `force-return-to-origin`
 * chain entry before it resolves. Legal during M/H chain declaring when
 * the ally is untapped and the chain contains an unresolved entry tagged
 * with `force-return-to-origin`.
 */
export interface CancelReturnToOriginAction {
  /** Action discriminant. */
  readonly type: 'cancel-return-to-origin';
  /** The resource player tapping the ally. */
  readonly player: PlayerId;
  /** The ally instance being tapped (e.g. Goldberry). */
  readonly allyInstanceId: CardInstanceId;
  /** The chain entry's card instance to negate. */
  readonly targetInstanceId: CardInstanceId;
}

/**
 * Discard an in-play card carrying `cancel-hazard-event-play` (The Great Eye
 * as-85) during chain declaring to negate an unresolved hazard *event* entry
 * (short, long, or permanent) declared by the opponent, before it resolves.
 * Entries revealed from on-guard (`payload.fromOnGuard`) are never legal
 * targets.
 */
export interface CancelHazardEventAction {
  /** Action discriminant. */
  readonly type: 'cancel-hazard-event';
  /** The player discarding the in-play canceler card. */
  readonly player: PlayerId;
  /** The in-play card being discarded to pay for the cancel (e.g. The Great Eye). */
  readonly cardInstanceId: CardInstanceId;
  /** The chain entry's card instance to negate (the opponent's hazard event). */
  readonly targetInstanceId: CardInstanceId;
}

/**
 * Play a hazard short-event (Black Vapour ba-14) from hand — or reveal it from
 * on-guard — during a combat chain to counter an opponent's chain entry that
 * would cancel a creature attack of a matching race. The card is pushed onto
 * the chain as a short-event entry carrying {@link targetInstanceId}; when it
 * resolves it enqueues a roll (2d6 + the attack's prowess) that, on success,
 * negates the target cancel and boosts the surviving attack.
 */
export interface PlayCounterCancelRollAction {
  /** Action discriminant. */
  readonly type: 'counter-cancel-roll';
  /** The attacking (hazard) player playing the counter-cancel card. */
  readonly player: PlayerId;
  /** The Black Vapour card being played (in hand or on-guard on the defender). */
  readonly cardInstanceId: CardInstanceId;
  /** The chain entry's card instance to counter (the opponent's cancel-attack). */
  readonly targetInstanceId: CardInstanceId;
}

/**
 * Play a Balrog resource short-event (Great Fissure ba-61) from hand during a
 * chain to negate an unresolved chain entry that would cancel an attack by The
 * Balrog's company against an opponent's company. The counter-cancel counterpart
 * to {@link CancelReturnToOriginAction}: sourced from a discarded hand card
 * rather than a tapped ally.
 */
export interface CounterCancelAttackAction {
  /** Action discriminant. */
  readonly type: 'counter-cancel-attack';
  /** The Balrog player playing the counter-cancel card. */
  readonly player: PlayerId;
  /** The hand card being played and discarded (e.g. Great Fissure). */
  readonly cardInstanceId: CardInstanceId;
  /** The chain entry's card instance to negate (the opponent's cancel-attack). */
  readonly targetInstanceId: CardInstanceId;
}

/**
 * Tap an in-play ally to discard a hazard permanent-event attached to the
 * ally's (moving) company or to a character in it. Backs the discard mode of
 * Last Child of Ungoliant (le-153): "tap this ally to ... discard one hazard
 * permanent-event on such a company or on a character in such a company."
 */
export interface TapAllyDiscardHazardAction {
  /** Action discriminant. */
  readonly type: 'tap-ally-discard-hazard';
  /** The (resource/active) player tapping the ally. */
  readonly player: PlayerId;
  /** The ally instance being tapped (e.g. le-153). */
  readonly allyInstanceId: CardInstanceId;
  /** The attached hazard permanent-event instance to discard. */
  readonly targetInstanceId: CardInstanceId;
}

/**
 * Execute the dice roll for a Seized by Terror check on a character.
 *
 * Created by the pending-resolution system after a hazard short event
 * with a `seized-by-terror-check` effect resolves. The character's player
 * rolls 2d6; if roll + character mind < threshold (12), the character
 * splits off into a new company that returns to the original company's
 * site of origin.
 */
export interface SeizedByTerrorRollAction {
  /** Action discriminant. */
  readonly type: 'seized-by-terror-roll';
  /** The character's player (who rolls). */
  readonly player: PlayerId;
  /** The targeted character instance. */
  readonly targetCharacterId: CardInstanceId;
  /** The 2d6 value needed for the character to stay (roll + mind >= this). */
  readonly need: number;
  /** Human-readable breakdown of the check. */
  readonly explanation: string;
}

/**
 * Execute one dice roll of a pending `company-tap-roll` resolution
 * (Heedless Revelry le-114).
 *
 * Created by the pending-resolution system after a hazard short event with a
 * `company-tap-roll` effect resolves on the company. The company's controller
 * rolls 2d6 for the named character; if roll + modifier is strictly greater
 * than the character's effective mind, the character becomes tapped.
 */
export interface CompanyTapRollAction {
  /** Action discriminant. */
  readonly type: 'company-tap-roll';
  /** The company's controller (who rolls). */
  readonly player: PlayerId;
  /** The character this roll is for (head of the pending `remaining` list). */
  readonly targetCharacterId: CardInstanceId;
  /** Roll modifier applied to this character's roll (e.g. -2 for heroes). */
  readonly modifier: number;
  /** Human-readable breakdown of the check. */
  readonly explanation: string;
}

/**
 * Play an agent character card from hand as a face-down hazard.
 *
 * The hazard player plays an agent character (identified by the `agent` keyword)
 * from hand as a free-roaming hazard. The agent is placed face-down without a
 * site — the home site is chosen at reveal time (rule 9.04). This counts 1
 * against the hazard limit (rule 2.IV.vii.1).
 *
 * The agent cannot take an agent action on the turn it was played
 * (`inPlayAtTurnStart` is set to `false`; it flips to `true` at the next untap).
 */
export interface PlayAgentHazardAction {
  /** Action discriminant. */
  readonly type: 'play-agent-hazard';
  /** The hazard player playing the agent. */
  readonly player: PlayerId;
  /** The agent character card instance being played from hand. */
  readonly agentCardInstanceId: CardInstanceId;
}

/**
 * Reveal a face-down agent hazard during the resource player's M/H phase.
 *
 * Revealing is not an agent action and does not count against the hazard
 * limit (CoE rule 4.2). The hazard player may reveal any of their face-down
 * agents at any time during the resource player's Movement/Hazard phase.
 *
 * Per rule 9.04, the hazard player must place a site card from their own
 * location deck that matches one of the agent's home sites when revealing.
 * If no matching site is available, the reveal is still legal but the agent
 * is immediately discarded at the end of the current turn (rule 9.04).
 *
 * On reveal, movement legality of the site stack is checked. If any hop is
 * illegal, the agent is immediately discarded and the home site is returned
 * to the location deck. If legal, the current site becomes face-up (in play).
 *
 * Uniqueness is then checked: if a unique agent shares its definition with
 * any face-up character or agent already in play, the newly-revealed agent
 * is discarded (rule 4.2.3).
 */
export interface RevealAgentAction {
  /** Action discriminant. */
  readonly type: 'reveal-agent';
  /** The hazard player revealing the agent. */
  readonly player: PlayerId;
  /** The CompanyId of the agent to reveal. */
  readonly agentId: CompanyId;
  /**
   * A site instance from the hazard player's own location deck that matches
   * one of the agent's home sites (rule 9.04). If omitted, no matching site
   * was available and the agent will be discarded at end of turn.
   */
  readonly homeSiteInstanceId?: CardInstanceId;
}

/**
 * Move a face-down agent hazard to a site in the same or an adjacent region.
 *
 * This is an agent action (costs 1 hazard slot, rule 9.02). The agent must
 * have been in play at the start of the turn (`inPlayAtTurnStart = true`) and
 * not already acted this turn (`actedThisTurn = false`). The agent is tapped
 * after moving (rule 9.02). The destination site is pushed onto `siteStack`.
 * Excludes Under-deeps sites and haven sites (rules 9.02, 9.07).
 */
export interface AgentMoveAction {
  /** Action discriminant. */
  readonly type: 'agent-move';
  /** The hazard player taking the action. */
  readonly player: PlayerId;
  /** The CompanyId of the moving agent. */
  readonly agentId: CompanyId;
  /** Destination site from the hazard player's location deck. */
  readonly destinationSiteInstanceId: CardInstanceId;
}

/**
 * Move a face-down agent one step back along its site stack.
 *
 * This is an agent action (costs 1 hazard slot, rule 9.02). The most recent
 * site is popped from `siteStack` and returned to the location deck.
 * Only legal if `siteStack.length > 1` (there is a prior site to return to).
 * The agent is tapped after moving.
 */
export interface AgentMoveBackAction {
  /** Action discriminant. */
  readonly type: 'agent-move-back';
  /** The hazard player taking the action. */
  readonly player: PlayerId;
  /** The CompanyId of the moving agent. */
  readonly agentId: CompanyId;
}

/**
 * Return an agent to its home site.
 *
 * This is an agent action (costs 1 hazard slot, rule 9.02). All current
 * `siteStack` entries are returned to the location deck. This does NOT tap
 * the agent (rule 4.1). For a face-down agent, siteStack becomes empty (the
 * agent is conceptually at home without a site card). For a face-up agent,
 * a home site card from the location deck must be placed with the agent
 * (homeSiteInstanceId required).
 */
export interface AgentReturnHomeAction {
  /** Action discriminant. */
  readonly type: 'agent-return-home';
  /** The hazard player taking the action. */
  readonly player: PlayerId;
  /** The CompanyId of the agent returning home. */
  readonly agentId: CompanyId;
  /**
   * Home site instance from the hazard player's location deck.
   * Required only when the agent is face-up (rule 4.1); omitted for
   * face-down agents (siteStack simply becomes empty).
   */
  readonly homeSiteInstanceId?: CardInstanceId;
}

/**
 * Heal a wounded agent (Inverted) to tapped (Tapped) status.
 *
 * This is an agent action (costs 1 hazard slot, rule 9.02). Only legal if
 * `agent.character.status === CardStatus.Inverted` (wounded).
 */
export interface AgentHealAction {
  /** Action discriminant. */
  readonly type: 'agent-heal';
  /** The hazard player taking the action. */
  readonly player: PlayerId;
  /** The CompanyId of the agent to heal. */
  readonly agentId: CompanyId;
}

/**
 * Untap a tapped agent.
 *
 * This is an agent action (costs 1 hazard slot, rule 9.02). Only legal if
 * `agent.character.status === CardStatus.Tapped`.
 */
export interface AgentUntapAction {
  /** Action discriminant. */
  readonly type: 'agent-untap';
  /** The hazard player taking the action. */
  readonly player: PlayerId;
  /** The CompanyId of the agent to untap. */
  readonly agentId: CompanyId;
}

/**
 * Turn a revealed (face-up) agent face-down.
 *
 * This is an agent action (costs 1 hazard slot, rule 9.02). Only legal if
 * the agent is revealed (`revealed = true`) and untapped
 * (`character.status === CardStatus.Untapped`). Does not tap the agent.
 * The current face-up site remains in `siteStack` (now face-down again).
 */
export interface AgentTurnFaceDownAction {
  /** Action discriminant. */
  readonly type: 'agent-turn-face-down';
  /** The hazard player taking the action. */
  readonly player: PlayerId;
  /** The CompanyId of the agent to turn face-down. */
  readonly agentId: CompanyId;
}

/**
 * Tap an untapped agent to make creatures keyable to its current site.
 *
 * This is an agent action (costs 1 hazard slot, rule 9.02). The agent must
 * be untapped (`character.status === CardStatus.Untapped`). After this action,
 * hazard creatures may be keyed to the agent's current site for the rest of
 * the turn. Taps the agent.
 */
export interface AgentKeyCreaturesAction {
  /** Action discriminant. */
  readonly type: 'agent-key-creatures';
  /** The hazard player taking the action. */
  readonly player: PlayerId;
  /** The CompanyId of the agent keying creatures. */
  readonly agentId: CompanyId;
}

/**
 * The hazard player taps an agent to make an influence attempt during
 * the opponent's M/H phase (rule 10.14).
 *
 * This does NOT count as an agent action (actedThisTurn is not set)
 * and does NOT count against the hazard limit. The agent taps and is
 * revealed. The attempt resolves as a standard opponent-influence-defend
 * with the rule 10.14 bonuses already baked in.
 */
export interface AgentInfluenceAttemptAction {
  /** Action discriminant. */
  readonly type: 'agent-influence-attempt';
  /** The hazard player making the attempt. */
  readonly player: PlayerId;
  /** The CompanyId of the agent performing the influence attempt. */
  readonly agentId: CompanyId;
  /** The player whose card is being targeted. */
  readonly targetPlayer: PlayerId;
  /** The instance ID of the card being targeted. */
  readonly targetInstanceId: CardInstanceId;
  /** Whether the target is a character, ally, or faction. */
  readonly targetKind: 'character' | 'ally' | 'faction';
  /** Human-readable breakdown for logging. */
  readonly explanation: string;
}

/**
 * The hazard player taps an agent to attack a company during the opponent's
 * M/H phase (agent-tap-attack effect, e.g. The Grimburgoth dm-15).
 *
 * This does NOT count as an agent action (actedThisTurn is not set)
 * and does NOT count against the hazard limit. The agent taps and is
 * revealed. Combat resolves as a standard agent attack.
 */
export interface AgentTapAttackAction {
  /** Action discriminant. */
  readonly type: 'agent-tap-attack';
  /** The hazard player initiating the attack. */
  readonly player: PlayerId;
  /** The CompanyId of the agent performing the attack. */
  readonly agentId: CompanyId;
  /**
   * For face-down agents: a home site instance from the hazard player's
   * location deck to place with the agent on reveal. If absent, the agent
   * is revealed without a home site and discarded at end of turn (rule 9.04).
   */
  readonly homeSiteInstanceId?: CardInstanceId;
}

/**
 * The hazard player discards an agent at the moving company's new site to
 * force the company to return to its site of origin (the
 * `agent-discard-return-to-origin` effect, e.g. Baduila dm-2).
 *
 * This does NOT count as an agent action and does NOT count against the
 * hazard limit. Per CoE rule 2.IV.4 the company's movement/hazard phase
 * immediately ends and its site phase is blocked.
 */
export interface AgentDiscardReturnToOriginAction {
  /** Action discriminant. */
  readonly type: 'agent-discard-return-to-origin';
  /** The hazard player discarding the agent. */
  readonly player: PlayerId;
  /** The CompanyId of the agent being discarded. */
  readonly agentId: CompanyId;
}

/**
 * Power Built by Waiting (as-34): the hazard player taps this card from
 * their cardsInPlay to increase the hazard limit against the current target
 * company by the card's {@link TapForHazardLimitEffect.value}.
 *
 * Does NOT count against the hazard limit itself.
 */
export interface TapHazardCardForLimitAction {
  readonly type: 'tap-hazard-card-for-limit';
  /** The hazard player activating the ability. */
  readonly player: PlayerId;
  /** The instance ID of the cardsInPlay card to tap. */
  readonly cardInstanceId: CardInstanceId;
  /** The company whose hazard limit is increased. */
  readonly targetCompanyId: CompanyId;
}

/**
 * Power Built by Waiting (as-34): the hazard player spends hazard limit slots
 * to untap this card during the M/H phase against the current target company.
 *
 * Consumes {@link UntapByHazardLimitEffect.cost} hazard limit slots
 * (increments hazardsPlayedThisCompany) and sets the card's status to Untapped.
 */
export interface PayHazardLimitToUntapCardAction {
  readonly type: 'pay-hazard-limit-to-untap-card';
  /** The hazard player activating the ability. */
  readonly player: PlayerId;
  /** The instance ID of the cardsInPlay card to untap. */
  readonly cardInstanceId: CardInstanceId;
  /** The company whose hazard limit is being spent. */
  readonly targetCompanyId: CompanyId;
}

/**
 * Dragon "At Home" permanent-events (METD §4): the hazard player discards this
 * card from play during the opponent's movement/hazard phase (not counting
 * against the hazard limit) to increase the hazard limit against one company
 * by the card's {@link DiscardForHazardLimitEffect.value}.
 *
 * The card moves from cardsInPlay to the owner's discard pile; the boost is
 * applied as a `hazard-limit-modifier` constraint scoped to the target
 * company's current M/H phase.
 */
export interface DiscardCardForHazardLimitAction {
  readonly type: 'discard-card-for-hazard-limit';
  /** The hazard player activating the ability. */
  readonly player: PlayerId;
  /** The instance ID of the cardsInPlay card to discard. */
  readonly cardInstanceId: CardInstanceId;
  /** The company whose hazard limit is increased. */
  readonly targetCompanyId: CompanyId;
}

/**
 * An Orc or Troll character takes a defeated creature card as a trophy
 * (MELE §8.37). The trophy is placed under the character and counts as a
 * minor item worth 0 CP. Total printed MPs grant stat bonuses.
 *
 * Available during the `trophy-offer` combat phase after a non-detainment
 * creature defeat. The defending player may take a trophy for each eligible
 * Orc/Troll character that faced a strike, or pass to skip all trophies.
 */
export interface TakeTrophyAction {
  /** Action discriminant. */
  readonly type: 'take-trophy';
  /** The defending player offering the trophy. */
  readonly player: PlayerId;
  /** The character who will hold the trophy (must be Orc or Troll, not half-orc). */
  readonly characterId: CardInstanceId;
  /** The creature instance being taken as a trophy. */
  readonly creatureInstanceId: CardInstanceId;
}

/**
 * Move a Dragon or Drake hazard creature from hand into the Summons from Long
 * Sleep (as-39) reservation slot. Does not count against the hazard limit.
 */
export interface ReserveCreatureAction {
  /** Action discriminant. */
  readonly type: 'reserve-creature';
  /** The hazard player making the reservation. */
  readonly player: PlayerId;
  /** The Dragon/Drake creature card instance being reserved. */
  readonly cardInstanceId: CardInstanceId;
  /** The AS-39 permanent-event instance that provides the reservation slot. */
  readonly sourceCardInstanceId: CardInstanceId;
}

/**
 * Play a Dragon or Drake hazard creature from the Summons from Long Sleep
 * (as-39) reservation slot, treating it as though it were in hand.
 * Counts against the hazard limit; creature attacks with +2 prowess.
 */
export interface PlayReservedCreatureAction {
  /** Action discriminant. */
  readonly type: 'play-reserved-creature';
  /** The hazard player playing the reserved creature. */
  readonly player: PlayerId;
  /** The AS-39 permanent-event instance whose reserved creature is being played. */
  readonly sourceCardInstanceId: CardInstanceId;
  /** The company the creature is targeting. */
  readonly targetCompanyId: CompanyId;
  /** Keying match (same as play-hazard creature). */
  readonly keyedBy?: CreatureKeyingMatch;
}

/**
 * Play a hazard creature from the hazard player's own discard pile as an
 * immediate attack against the active company, driven by a hazard short-event
 * carrying a `play-creature-from-discard` effect (Exhalation of Decay, dm-55).
 *
 * Does NOT count against the hazard limit. The event card is discarded on
 * play; the creature attacks with the effect's prowess modifier applied.
 */
export interface PlayCreatureFromDiscardAction {
  /** Action discriminant. */
  readonly type: 'play-creature-from-discard';
  /** The hazard player playing the creature. */
  readonly player: PlayerId;
  /** The short-event card instance (in hand) driving the effect. */
  readonly cardInstanceId: CardInstanceId;
  /** The hazard-creature instance in the discard pile being brought into play. */
  readonly creatureInstanceId: CardInstanceId;
  /** The company the creature is targeting. */
  readonly targetCompanyId: CompanyId;
  /** Keying match (same as a play-hazard creature). */
  readonly keyedBy?: CreatureKeyingMatch;
}

/**
 * Replay a hazard creature from the hazard player's own discard pile as an
 * immediate attack, granted by an in-play permanent-event carrying a
 * `grant-replay-attacked-creature` effect (Monstrosity of Diverse Shape,
 * ba-21).
 *
 * The creature must have already attacked the target company earlier this
 * movement/hazard phase. Unlike {@link PlayCreatureFromDiscardAction}, this
 * play DOES count against the hazard limit and may be used only once per
 * company's movement/hazard phase per source permanent-event.
 */
export interface SpawnReplayCreatureAction {
  /** Action discriminant. */
  readonly type: 'spawn-replay-creature';
  /** The hazard player replaying the creature. */
  readonly player: PlayerId;
  /** The in-play permanent-event instance granting the ability. */
  readonly sourceInstanceId: CardInstanceId;
  /** The hazard-creature instance in the discard pile being brought into play. */
  readonly creatureInstanceId: CardInstanceId;
  /** The company the creature is targeting. */
  readonly targetCompanyId: CompanyId;
  /** Keying match (same as a play-hazard creature). */
  readonly keyedBy?: CreatureKeyingMatch;
}

/**
 * Roll 2d6 to resolve a Stay Her Appetite (le-140) condition check.
 * Resolves the queued `stay-her-appetite-roll` pending resolution.
 */
export interface StayHerAppetiteRollAction {
  /** Action discriminant. */
  readonly type: 'stay-her-appetite-roll';
  /** The hazard player making the roll. */
  readonly player: PlayerId;
}

/**
 * Resolve a queued `transfer-returned-item` pending resolution (Pilfer Anything
 * Unwatched as-33). The returned character's owner either transfers one item to
 * a company-mate (both fields present) or declines (both omitted); the rest of
 * the items stay in the discard pile.
 */
export interface TransferReturnedItemAction {
  /** Action discriminant. */
  readonly type: 'transfer-returned-item';
  /** The returned character's owner (resolves the pending resolution). */
  readonly player: PlayerId;
  /** The item to transfer (from the owner's discard pile); omitted to decline. */
  readonly itemInstanceId?: CardInstanceId;
  /** The company-mate that receives the item; omitted to decline. */
  readonly targetCharacterId?: CardInstanceId;
}

/**
 * Resolve a queued `discard-substitute-offer` pending resolution (Leaf Brooch
 * dm-171). The owner of the doomed cards either names one card to save — the
 * substitute item is discarded in its place — or declines by omitting
 * `itemInstanceId`, letting the forced discard go through unchanged.
 */
export interface UseDiscardSubstituteAction {
  /** Action discriminant. */
  readonly type: 'use-discard-substitute';
  /** Owner of both the substitute and the doomed cards. */
  readonly player: PlayerId;
  /** The card saved from discard; omitted to decline the substitution. */
  readonly itemInstanceId?: CardInstanceId;
}
