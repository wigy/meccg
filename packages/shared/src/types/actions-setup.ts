/**
 * @module actions-setup
 *
 * Action types for the pre-game setup phases: character draft, item draft,
 * character deck draft, starting site selection, and initiative roll.
 *
 * These actions occur before the main game loop begins and establish each
 * player's starting position: which characters they drafted, where they
 * placed their starting companies, and who goes first.
 */

import type { PlayerId, CardInstanceId, CardDefinitionId, CompanyId } from './common.js';

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
