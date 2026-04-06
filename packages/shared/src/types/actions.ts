/**
 * @module actions
 *
 * Game action types representing every possible player input in MECCG.
 *
 * The game engine is a pure reducer: `(GameState, GameAction) -> GameState`.
 * Each action type corresponds to a specific player decision at a specific
 * point in the game. The server validates that incoming actions are legal
 * for the current phase and game state before applying them.
 *
 * Actions are grouped by the phase in which they are primarily used,
 * plus a set of universal actions available across multiple phases.
 */

import { PlayerId, CardInstanceId, CardDefinitionId, CompanyId, MovementType } from './common.js';

// ---- Character draft phase ----

/**
 * Select a character from the draft pool during the pre-game draft.
 *
 * Both players make simultaneous face-down picks each round. If picks
 * don't collide, both characters are drafted. If they collide, the
 * character is set aside and neither player gets it.
 */
export interface DraftPickAction {
  readonly type: 'draft-pick';
  /** The player making the pick. */
  readonly player: PlayerId;
  /** The character instance to draft from the player's pool. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Voluntarily stop drafting during the pre-game draft.
 *
 * A player who stops keeps all characters they have drafted so far
 * but cannot draft any more. The draft ends when both players have
 * stopped or all rounds are complete.
 */
export interface DraftStopAction {
  readonly type: 'draft-stop';
  /** The player choosing to stop. */
  readonly player: PlayerId;
}

// ---- Item draft phase ----

/**
 * Assign a starting minor item to a character in the starting company.
 *
 * After the character draft completes, each player assigns their starting
 * minor items to any character in their starting company. Both players
 * assign simultaneously.
 */
export interface AssignStartingItemAction {
  readonly type: 'assign-starting-item';
  /** The player assigning the item. */
  readonly player: PlayerId;
  /** The minor item definition to assign (resolved to an instance by the reducer). */
  readonly itemDefId: CardDefinitionId;
  /** The character instance that will carry the item. */
  readonly characterInstanceId: CardInstanceId;
}

// ---- Character deck draft phase ----

/**
 * Add a remaining pool character to the play deck.
 *
 * After item assignment, players may add undrafted characters from their
 * pool to the play deck, up to a total of 10 non-avatar characters.
 */
export interface AddCharacterToDeckAction {
  readonly type: 'add-character-to-deck';
  /** The player adding the character. */
  readonly player: PlayerId;
  /** The character instance to add to the play deck. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Shuffle the player's play deck. Required after adding characters to the
 * deck, and reusable in other phases that modify the deck contents.
 */
export interface ShufflePlayDeckAction {
  readonly type: 'shuffle-play-deck';
  /** The player shuffling their deck. */
  readonly player: PlayerId;
}

/**
 * Select a site from the site deck as a starting site.
 * Creates an empty company at the selected site.
 */
export interface SelectStartingSiteAction {
  readonly type: 'select-starting-site';
  /** The player selecting the site. */
  readonly player: PlayerId;
  /** The site instance ID from the player's site deck. */
  readonly siteInstanceId: CardInstanceId;
}

/**
 * Assign a character to a specific starting company.
 * Used when two starting sites are selected and characters must be
 * distributed between the two companies.
 */
export interface PlaceCharacterAction {
  readonly type: 'place-character';
  /** The player placing the character. */
  readonly player: PlayerId;
  /** The character instance to move. */
  readonly characterInstanceId: CardInstanceId;
  /** The target company to place the character in. */
  readonly companyId: CompanyId;
}

/**
 * Roll 2d6 for initiative to determine who goes first.
 * The server resolves the roll using the game's RNG.
 */
export interface RollInitiativeAction {
  readonly type: 'roll-initiative';
  /** The player rolling. */
  readonly player: PlayerId;
}

// ---- Untap phase ----

/**
 * The resource player untaps all their tapped cards and heals wounded
 * characters at havens. This is an explicit action so the player sees
 * their cards change state before proceeding.
 */
export interface UntapAction {
  readonly type: 'untap';
  /** The active (resource) player performing the untap. */
  readonly player: PlayerId;
}

// ---- Organization phase ----

/**
 * Play a character card from hand into a company at a site.
 *
 * Characters can be played at their home site if a company is there,
 * or at any haven. They must be controlled via general influence or
 * direct influence from another character already in play.
 */
export interface PlayCharacterAction {
  readonly type: 'play-character';
  /** The player playing the character. */
  readonly player: PlayerId;
  /** The character card instance to play from hand. */
  readonly characterInstanceId: CardInstanceId;
  /** The site where the character enters play (must match homesite or be a haven). */
  readonly atSite: CardInstanceId;
  /**
   * How the new character is controlled:
   * - `'general'` -- Under the player's general influence (costs mind value from the 20-point pool).
   * - A `CardInstanceId` -- As a follower under another character's direct influence.
   */
  readonly controlledBy: 'general' | CardInstanceId;
}

/**
 * Split a character (and their followers) from an existing company into a new company.
 *
 * Used during Organization to divide forces, allowing characters to
 * travel to different destinations. The specified character and their
 * followers leave the source company and form a new company at the same site.
 */
export interface SplitCompanyAction {
  readonly type: 'split-company';
  /** The player splitting the company. */
  readonly player: PlayerId;
  /** The company to split characters from. */
  readonly sourceCompanyId: CompanyId;
  /** The character instance ID to move into the new company. Followers move automatically. */
  readonly characterId: CardInstanceId;
  /** When true, this action undoes a previous merge this phase (regressive). */
  readonly regress?: true;
}

/**
 * Move a character (and their followers) from one company to another
 * existing company at the same site during Organization.
 *
 * Only characters under general influence can move between companies.
 * Their followers automatically accompany them. The source company
 * must not become empty after the move.
 */
export interface MoveToCompanyAction {
  readonly type: 'move-to-company';
  /** The player moving the character. */
  readonly player: PlayerId;
  /** The character being moved (must be under GI). */
  readonly characterInstanceId: CardInstanceId;
  /** The company the character is currently in. */
  readonly sourceCompanyId: CompanyId;
  /** The company the character is moving to (must be at the same site). */
  readonly targetCompanyId: CompanyId;
  /** When true, this action undoes a previous move this phase (regressive). */
  readonly regress?: true;
}

/**
 * Merge two companies at the same site into one.
 *
 * Used during Organization to consolidate forces before movement,
 * increasing the company's combat strength but also raising the
 * opponent's hazard limit (which equals company size).
 */
export interface MergeCompaniesAction {
  readonly type: 'merge-companies';
  /** The player merging companies. */
  readonly player: PlayerId;
  /** The company that will be absorbed. */
  readonly sourceCompanyId: CompanyId;
  /** The company that will absorb the source company's characters. */
  readonly targetCompanyId: CompanyId;
  /** When true, this action undoes a previous split this phase (regressive). */
  readonly regress?: true;
}

/**
 * Transfer an item from one character to another at the same site.
 *
 * Per CoE rules (2.II.5), items can be transferred between two characters
 * at the same site (not necessarily in the same company) during Organization.
 * After the transfer, the initial bearer must make a corruption check —
 * no other organization actions are legal until the check is resolved.
 */
export interface TransferItemAction {
  readonly type: 'transfer-item';
  /** The player transferring the item. */
  readonly player: PlayerId;
  /** The item card instance being transferred. */
  readonly itemInstanceId: CardInstanceId;
  /** The character currently holding the item. */
  readonly fromCharacterId: CardInstanceId;
  /** The character who will receive the item. */
  readonly toCharacterId: CardInstanceId;
  /** When true, this action undoes a previous transfer this phase (regressive). */
  readonly regress?: true;
}

/**
 * Set a company's destination site for this turn.
 *
 * Movement is planned during Organization but resolved during the
 * Movement/Hazard phase, where the movement type and region path
 * will be determined.
 */
export interface PlanMovementAction {
  readonly type: 'plan-movement';
  /** The player planning movement. */
  readonly player: PlayerId;
  /** The company that will travel. */
  readonly companyId: CompanyId;
  /** The site card instance the company intends to move to. */
  readonly destinationSite: CardInstanceId;
  /** When true, this action undoes a previous cancel this phase (regressive). */
  readonly regress?: true;
}

/**
 * Cancel a previously planned movement, keeping the company at its current site.
 *
 * Can be used during Organization to change plans before the Movement/Hazard
 * phase begins. The company will stay at its current location this turn.
 */
export interface CancelMovementAction {
  readonly type: 'cancel-movement';
  /** The player canceling movement. */
  readonly player: PlayerId;
  /** The company whose movement is being canceled. */
  readonly companyId: CompanyId;
  /** When true, this action undoes a previous plan this phase (regressive). */
  readonly regress?: true;
}

/**
 * Move a character between general influence and direct influence control
 * during the Organization phase.
 *
 * Two directions are supported:
 * - **To DI**: Move a non-avatar character (without followers) under the
 *   direct influence of a non-follower character in the same company.
 *   The character's mind must not exceed the controller's available DI.
 * - **To GI**: Move a follower back to general influence, provided the
 *   total non-follower mind would not exceed the player's maximum GI.
 */
export interface MoveToInfluenceAction {
  readonly type: 'move-to-influence';
  /** The player reorganizing influence. */
  readonly player: PlayerId;
  /** The character being moved between influence pools. */
  readonly characterInstanceId: CardInstanceId;
  /**
   * The new influence controller:
   * - `'general'` -- Move the character to general influence (un-follow).
   * - A `CardInstanceId` -- Make the character a follower of this character.
   */
  readonly controlledBy: 'general' | CardInstanceId;
  /** When true, this action undoes a previous move this phase (regressive). */
  readonly regress?: true;
}

/**
 * Play a permanent-event resource card from hand during the Organization phase.
 *
 * Permanent resource events (e.g. "A Short Rest", "Fellowship") are played
 * directly to the table without requiring a site. They remain in play
 * indefinitely, providing ongoing beneficial effects.
 */
export interface PlayPermanentEventAction {
  readonly type: 'play-permanent-event';
  /** The player playing the event. */
  readonly player: PlayerId;
  /** The permanent-event card instance to play from hand. */
  readonly cardInstanceId: CardInstanceId;
}

// ---- Short-event (resource) ----

/**
 * Play a short-event card as a resource to cancel and discard an environment.
 *
 * When targeting an environment card (e.g. Twilight canceling a long-event),
 * the `targetInstanceId` identifies the card to cancel. The short event
 * initiates a chain so both players can respond before resolution.
 *
 * When played during the long-event phase as a resource short-event (e.g.
 * Smoke Rings), no target is needed. The card may trigger sub-flows such as
 * fetching a card from the sideboard or discard pile.
 */
export interface PlayShortEventAction {
  readonly type: 'play-short-event';
  /** The player playing the short event. */
  readonly player: PlayerId;
  /** The short-event card instance to play from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The environment card instance to cancel and discard (when targeting an environment). */
  readonly targetInstanceId?: CardInstanceId;
}

/**
 * Select a card from the sideboard or discard pile to fetch into the play deck.
 *
 * This action is part of the fetch-to-deck sub-flow initiated by resource
 * short events like Smoke Rings. The player must select exactly one eligible
 * card from the available sources.
 */
export interface FetchFromPileAction {
  readonly type: 'fetch-from-pile';
  /** The player fetching the card. */
  readonly player: PlayerId;
  /** The card instance to fetch. */
  readonly cardInstanceId: CardInstanceId;
  /** Which pile the card is being fetched from. */
  readonly source: 'sideboard' | 'discard-pile';
}

// ---- Long-event phase ----

/**
 * Play a resource long-event card from hand during the Long-event phase.
 *
 * Resource long-events can only be played during the long-event phase.
 * They remain in play for one full turn cycle (one of your turns and one
 * of your opponent's turns), then are discarded at the beginning of your
 * next long-event phase.
 */
export interface PlayLongEventAction {
  readonly type: 'play-long-event';
  /** The player playing the long-event. */
  readonly player: PlayerId;
  /** The long-event card instance to play from hand. */
  readonly cardInstanceId: CardInstanceId;
}

// ---- Movement/Hazard phase ----

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
  /** How the creature was keyed: by region type, region name, or site type. */
  readonly method: 'region-type' | 'region-name' | 'site-type';
  /** The specific value that matched (e.g. "wilderness", "Arthedain", "ruins-and-lairs"). */
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
  /** For creatures, describes which keying rule matched the travel path. */
  readonly keyedBy?: CreatureKeyingMatch;
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

// ---- Site phase ----

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
}

/**
 * Play a minor item on a character without requiring a specific site type.
 *
 * Minor items have relaxed play conditions compared to major/greater items.
 * They can sometimes be played as a "bonus" action that doesn't count as
 * the company's resource play for the phase.
 */
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

// ---- Universal ----

/**
 * Trigger a corruption check on one of your own characters.
 *
 * The character rolls 2d6. If the roll is greater than their total
 * corruption points (from items + corruption hazards + modifiers), they
 * pass. Otherwise, they fail and are removed from the game -- the
 * opponent does NOT receive marshalling points for this loss.
 * Corruption checks can be called by either player during Movement/Hazard,
 * Site, and Free Council phases.
 */
export interface CorruptionCheckAction {
  readonly type: 'corruption-check';
  /** The player whose character is making the check. */
  readonly player: PlayerId;
  /** The character instance making the corruption check. */
  readonly characterId: CardInstanceId;
  /** The character's total corruption points at the time the check was generated. */
  readonly corruptionPoints: number;
  /**
   * Total modifier applied to the 2d6 roll. Includes the character's own
   * corruption check modifier from the card definition, plus any situational
   * bonuses (e.g. +2 for Ringwraith/Balrog in company).
   */
  readonly corruptionModifier: number;
  /**
   * Card instance IDs of possessions (items, allies, corruption cards) that
   * will be discarded if the corruption check fails. Pre-computed at action
   * generation time so the client can display what's at stake.
   */
  readonly possessions: readonly CardInstanceId[];
  /** The unmodified 2d6 value needed for success (roll > CP, adjusted for modifier). */
  readonly need: number;
  /** Human-readable breakdown of the target number and modifiers. */
  readonly explanation: string;
}

/**
 * Draw cards from the play deck into hand.
 *
 * Used primarily during the End-of-Turn phase to refill to hand size.
 * If the deck is empty, the discard pile is reshuffled to form a new deck
 * (incrementing deckExhaustionCount).
 */
export interface DrawCardsAction {
  readonly type: 'draw-cards';
  /** The player drawing cards. */
  readonly player: PlayerId;
  /** Number of cards to draw. */
  readonly count: number;
}

/**
 * Discard a card from hand to the discard pile.
 *
 * Used during End-of-Turn to trim down to hand size, or at other
 * times when the rules require discarding.
 */
export interface DiscardCardAction {
  readonly type: 'discard-card';
  /** The player discarding. */
  readonly player: PlayerId;
  /** The card instance to discard from hand. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Pass priority, indicating the player has no more actions this phase.
 *
 * Available in every phase. In some phases (like Untap and Long-event),
 * passing is the only available action and simply advances to the next phase.
 * In other phases, it signals the player is done with their optional actions.
 */
export interface PassAction {
  readonly type: 'pass';
  /** The player passing. */
  readonly player: PlayerId;
}

/**
 * Call the Free Council, triggering the endgame.
 *
 * Available during End-of-Turn phase. Once called, the game proceeds to
 * the Free Council phase after the current turn completes. Both players
 * then face final corruption checks and marshalling points are tallied.
 * The Free Council is also automatically triggered when a player exhausts
 * their deck for the second time.
 */
export interface CallFreeCouncilAction {
  readonly type: 'call-free-council';
  /** The player calling the Free Council. */
  readonly player: PlayerId;
}

/**
 * Acknowledge deck exhaustion: return sites to location deck, shuffle the
 * discard pile into a new play deck, and increment the exhaustion counter.
 *
 * This is triggered as an explicit action when a player's play deck runs
 * empty after drawing. In the future, sideboard exchange will be added as
 * additional interactive steps before the reshuffle.
 */
export interface DeckExhaustAction {
  readonly type: 'deck-exhaust';
  /** The player whose deck is exhausted. */
  readonly player: PlayerId;
}

/**
 * Exchange one card between discard pile and sideboard during deck exhaustion.
 *
 * Per CoE rule §10, when a player's deck is exhausted they may exchange
 * up to 5 cards between their discard pile and sideboard (any card type)
 * before the discard is reshuffled into a new play deck.
 */
export interface ExchangeSideboardAction {
  readonly type: 'exchange-sideboard';
  /** The player exchanging cards. */
  readonly player: PlayerId;
  /** The card moving from the discard pile to the sideboard. */
  readonly discardCardInstanceId: CardInstanceId;
  /** The card moving from the sideboard to the discard pile. */
  readonly sideboardCardInstanceId: CardInstanceId;
}

/**
 * Declare intent to fetch 1 card from sideboard to the play deck.
 *
 * Per CoE rule 2.II.6, the resource player taps their avatar and then
 * selects exactly 1 resource/character from the sideboard to shuffle
 * into the play deck. Requires at least 5 cards in the play deck.
 *
 * This action taps the avatar and enters the sideboard-to-deck sub-flow.
 * The player must then select a card via {@link FetchFromSideboardAction}.
 */
export interface StartSideboardToDeckAction {
  readonly type: 'start-sideboard-to-deck';
  /** The player starting sideboard access. */
  readonly player: PlayerId;
  /** The avatar character being tapped. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Declare intent to fetch up to 5 cards from sideboard to the discard pile.
 *
 * Per CoE rule 2.II.6, the resource player taps their avatar and then
 * selects 1–5 resources/characters from the sideboard to place in the
 * discard pile.
 *
 * This action taps the avatar and enters the sideboard-to-discard sub-flow.
 * The player then selects cards one at a time via {@link FetchFromSideboardAction},
 * and may pass after at least 1 card has been fetched.
 */
export interface StartSideboardToDiscardAction {
  readonly type: 'start-sideboard-to-discard';
  /** The player starting sideboard access. */
  readonly player: PlayerId;
  /** The avatar character being tapped. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Fetch a specific card from the sideboard during the sideboard access sub-flow.
 *
 * Can only be used after a {@link StartSideboardToDeckAction} or
 * {@link StartSideboardToDiscardAction} has been executed. The destination
 * (deck or discard) is determined by which start action was used.
 */
export interface FetchFromSideboardAction {
  readonly type: 'fetch-from-sideboard';
  /** The player fetching from their sideboard. */
  readonly player: PlayerId;
  /** The sideboard card being fetched. */
  readonly sideboardCardInstanceId: CardInstanceId;
}

// ---- Untap hazard sideboard access ----

/**
 * Declare intent to fetch 1 hazard from sideboard to the play deck during untap.
 *
 * Per CoE rule 2.I, the hazard player may access their sideboard if the
 * resource player's avatar is in play. Fetching 1 hazard to deck requires
 * at least 5 cards in the play deck. This halves the hazard limit for
 * the upcoming M/H phase.
 */
export interface StartHazardSideboardToDeckAction {
  readonly type: 'start-hazard-sideboard-to-deck';
  /** The hazard (non-active) player accessing their sideboard. */
  readonly player: PlayerId;
}

/**
 * Declare intent to fetch up to 5 hazards from sideboard to the discard pile during untap.
 *
 * Per CoE rule 2.I, the hazard player may access their sideboard if the
 * resource player's avatar is in play. This halves the hazard limit for
 * the upcoming M/H phase.
 */
export interface StartHazardSideboardToDiscardAction {
  readonly type: 'start-hazard-sideboard-to-discard';
  /** The hazard (non-active) player accessing their sideboard. */
  readonly player: PlayerId;
}

/**
 * Fetch a specific hazard from the sideboard during the untap hazard sideboard sub-flow.
 *
 * Can only be used after a {@link StartHazardSideboardToDeckAction} or
 * {@link StartHazardSideboardToDiscardAction} has been executed.
 */
export interface FetchHazardFromSideboardAction {
  readonly type: 'fetch-hazard-from-sideboard';
  /** The hazard player fetching from their sideboard. */
  readonly player: PlayerId;
  /** The sideboard card being fetched. */
  readonly sideboardCardInstanceId: CardInstanceId;
}

// ---- Non-viable placeholder ----

/**
 * Placeholder action attached to hand cards that have no legal play
 * during the current phase. Never submitted — exists only as a
 * non-viable {@link EvaluatedAction} so the client can show a tooltip
 * explaining why the card cannot be used right now.
 */
export interface NotPlayableAction {
  readonly type: 'not-playable';
  /** The player holding the card. */
  readonly player: PlayerId;
  /** The card instance in hand that cannot be played. */
  readonly cardInstanceId: CardInstanceId;
}

// ---- Chain of Effects actions ----

/**
 * Pass priority in the current chain of effects.
 *
 * When a player has priority during the declaring phase of a chain,
 * they may pass instead of declaring an action. When both players pass
 * consecutively, the chain transitions to resolving mode.
 */
export interface PassChainPriorityAction {
  readonly type: 'pass-chain-priority';
  /** The player passing priority. */
  readonly player: PlayerId;
}

/**
 * Choose the order of multiple simultaneously-triggered passive conditions.
 *
 * When multiple passive conditions trigger at the same time during chain
 * resolution, the resource player chooses the order in which they are
 * declared in the follow-up chain.
 */
export interface OrderPassivesAction {
  readonly type: 'order-passives';
  /** The player ordering the passives (always the resource player). */
  readonly player: PlayerId;
  /** The ordered list of source card instance IDs, in the desired declaration order. */
  readonly order: readonly CardInstanceId[];
}

/**
 * Acknowledge the game result and record it to player history.
 * Sent by each player after reviewing the final scoring table.
 */
export interface FinishedAction {
  readonly type: 'finished';
  /** The player acknowledging the result. */
  readonly player: PlayerId;
}

// ---- Discriminated union ----

/**
 * The top-level union of all possible game actions.
 *
 * Discriminated by the `type` field. The game engine's reducer accepts
 * a `GameAction` and produces a new `GameState`. Actions are validated
 * against `LEGAL_ACTIONS_BY_PHASE` before being applied.
 */
export type GameAction =
  | DraftPickAction
  | DraftStopAction
  | AssignStartingItemAction
  | AddCharacterToDeckAction
  | ShufflePlayDeckAction
  | SelectStartingSiteAction
  | PlaceCharacterAction
  | RollInitiativeAction
  | UntapAction
  | PlayCharacterAction
  | SplitCompanyAction
  | MoveToCompanyAction
  | MergeCompaniesAction
  | TransferItemAction
  | MoveToInfluenceAction
  | PlanMovementAction
  | CancelMovementAction
  | PlayPermanentEventAction
  | PlayShortEventAction
  | FetchFromPileAction
  | PlayLongEventAction
  | SelectCompanyAction
  | DeclarePathAction
  | OrderEffectsAction
  | PlayHazardAction
  | AssignStrikeAction
  | ResolveStrikeAction
  | SupportStrikeAction
  | ChooseStrikeOrderAction
  | BodyCheckRollAction
  | EnterSiteAction
  | PlaceOnGuardAction
  | RevealOnGuardAction
  | DeclareAgentAttackAction
  | PlayHeroResourceAction
  | InfluenceAttemptAction
  | OpponentInfluenceAttemptAction
  | OpponentInfluenceDefendAction
  | PlayMinorItemAction
  | CorruptionCheckAction
  | DrawCardsAction
  | DiscardCardAction
  | PassAction
  | CallFreeCouncilAction
  | DeckExhaustAction
  | ExchangeSideboardAction
  | StartSideboardToDeckAction
  | StartSideboardToDiscardAction
  | FetchFromSideboardAction
  | StartHazardSideboardToDeckAction
  | StartHazardSideboardToDiscardAction
  | FetchHazardFromSideboardAction
  | PassChainPriorityAction
  | OrderPassivesAction
  | FinishedAction
  | NotPlayableAction;
