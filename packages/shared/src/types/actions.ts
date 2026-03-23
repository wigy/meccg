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

import { PlayerId, CardInstanceId, CardDefinitionId, CompanyId } from './common.js';

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
  /** The character definition to draft from the player's pool. */
  readonly characterDefId: CardDefinitionId;
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
  /** The character definition to add to the play deck. */
  readonly characterDefId: CardDefinitionId;
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
  /**
   * Marks this action as undoing previous progress. The AI avoids regressive
   * actions, and the UI renders them with a red glow.
   */
  readonly regress: true;
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

// ---- Movement/Hazard phase ----

/**
 * Play a hazard card against the opponent's moving company.
 *
 * The non-active player plays hazards during the opponent's Movement/Hazard
 * phase. Creatures must be keyed to the company's travel path. The number
 * of hazards per company is limited by the hazard limit (company size).
 */
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

// ---- Site phase ----

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
 * Fetch a specific card from the sideboard into the player's hand or play deck.
 *
 * The sideboard serves as a reserve of cards that can be accessed under
 * specific game conditions, allowing players to adapt their strategy
 * without being limited to their main deck contents.
 */
export interface FetchFromSideboardAction {
  readonly type: 'fetch-from-sideboard';
  /** The player fetching from their sideboard. */
  readonly player: PlayerId;
  /** The card instance to fetch from the sideboard. */
  readonly cardInstanceId: CardInstanceId;
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
  | PlayCharacterAction
  | SplitCompanyAction
  | MoveToCompanyAction
  | MergeCompaniesAction
  | TransferItemAction
  | MoveToInfluenceAction
  | PlanMovementAction
  | CancelMovementAction
  | PlayPermanentEventAction
  | PlayHazardAction
  | AssignStrikeAction
  | ResolveStrikeAction
  | SupportStrikeAction
  | PlayHeroResourceAction
  | InfluenceAttemptAction
  | PlayMinorItemAction
  | CorruptionCheckAction
  | DrawCardsAction
  | DiscardCardAction
  | PassAction
  | CallFreeCouncilAction
  | FetchFromSideboardAction
  | NotPlayableAction;
