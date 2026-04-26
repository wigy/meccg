/**
 * @module actions-organization
 *
 * Action types for the Organization phase.
 *
 * During Organization, the resource player restructures their companies:
 * playing new characters, splitting/merging companies, transferring items,
 * planning movement destinations, and reorganizing influence control.
 * These actions set up the turn's strategic choices before movement begins.
 */

import type { PlayerId, CardInstanceId, CompanyId, CardDefinitionId } from './common.js';

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
 * Store an item at the current site during the Organization phase.
 *
 * Per MECCG rules, items with a storable-at effect can be moved from
 * a character to the player's stored-items pile when the character is
 * at a matching site. The item earns marshalling points safely, and
 * the initial bearer must make a corruption check.
 */
export interface StoreItemAction {
  readonly type: 'store-item';
  /** The player storing the item. */
  readonly player: PlayerId;
  /** The item card instance being stored. */
  readonly itemInstanceId: CardInstanceId;
  /** The character currently holding the item. */
  readonly characterId: CardInstanceId;
}

/**
 * Execute the dice roll for a gold-ring auto-test triggered by storing
 * the ring at a site with the `auto-test-gold-ring` rule (e.g. a
 * Darkhaven). The storing player rolls 2d6, applies the site's
 * modifier, and the gold ring is discarded regardless of the result.
 *
 * Rule 9.21's replacement-with-special-ring step is not yet implemented;
 * today the handler rolls, logs, and discards.
 */
export interface GoldRingTestRollAction {
  /** Action discriminant. */
  readonly type: 'gold-ring-test-roll';
  /** The ring's owner (who rolls). */
  readonly player: PlayerId;
  /** The gold-ring item instance being tested. */
  readonly goldRingInstanceId: CardInstanceId;
  /** Roll modifier from the triggering site (e.g. -2 at a Darkhaven). */
  readonly rollModifier: number;
  /** Human-readable breakdown of the test (site name, modifier). */
  readonly explanation: string;
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
  /** For character-targeting permanent events (e.g. Align Palantír), the target character. */
  readonly targetCharacterId?: CardInstanceId;
  /** For site-targeting permanent events (e.g. Rebuild the Town, The White Tree), the target site definition. */
  readonly targetSiteDefinitionId?: import('./common.js').CardDefinitionId;
  /** Card instance to discard as a play cost (e.g. Sapling of the White Tree for The White Tree). */
  readonly discardCardInstanceId?: CardInstanceId;
}

/**
 * Activate a granted action from a card effect (e.g. tap to attempt
 * to remove an attached hazard permanent event).
 *
 * During Organization, characters with `grant-action` effects on their
 * attached hazards (or items/allies) can activate those abilities.
 * The engine handles the cost (tapping) and resolution (dice roll, etc.).
 */
export interface ActivateGrantedAction {
  readonly type: 'activate-granted-action';
  /** The player activating the ability. */
  readonly player: PlayerId;
  /** The character performing the action (will be tapped as cost). */
  readonly characterId: CardInstanceId;
  /** The card providing the grant-action effect. */
  readonly sourceCardId: CardInstanceId;
  /** The definition ID of the source card (for logging). */
  readonly sourceCardDefinitionId: CardDefinitionId;
  /** The grant-action identifier (e.g. "remove-self-on-roll"). */
  readonly actionId: string;
  /** The roll threshold required for success (minimum total to succeed). */
  readonly rollThreshold: number;
  /** Optional target card for the action (e.g. which gold ring to test). */
  readonly targetCardId?: CardInstanceId;
  /**
   * METD §7 / rule 10.08 — for `remove-self-on-roll` from a corruption
   * card: when true, the character does NOT tap, the roll suffers -3,
   * and a per-character per-card lock blocks any further removal
   * attempts on this card for the rest of the turn.
   */
  readonly noTap?: true;
}

// ---- Wizard-search window (The Windlord Found Me) ----

/**
 * Resource player selects a Wizard from their play deck or discard pile
 * during a wizard-search-on-store resolution window (The Windlord Found Me).
 *
 * Playing the Wizard at the Haven does not count toward the one-character-per-turn limit.
 */
export interface PlayWizardFromSearchAction {
  readonly type: 'play-wizard-from-search';
  readonly player: PlayerId;
  /** Definition ID of the chosen Wizard. */
  readonly wizardDefinitionId: CardDefinitionId;
  /** Which pile the wizard comes from. */
  readonly source: 'play-deck' | 'discard-pile';
}

/** Skip the wizard-search window — no Wizard desired. */
export interface SkipWizardSearchAction {
  readonly type: 'skip-wizard-search';
  readonly player: PlayerId;
}
