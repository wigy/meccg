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
  /**
   * Recruitment-vehicle play (Thrall of the Voice, wh-82). When set, this is
   * the in-hand permanent resource-event with a `recruitment-vehicle` effect
   * that enables an otherwise-ineligible character (a minion agent, or one
   * with printed mind above the Fallen-wizard maximum, up to the vehicle's
   * `maxMind`) to be brought into play "instead of a normal character". On
   * resolution the vehicle is placed with the recruited character. Absent for
   * a normal character play.
   */
  readonly viaRecruitmentInstanceId?: CardInstanceId;
  /**
   * Character-recruitment event play (A Chance Meeting tw-188, We Have Come to
   * Kill le-252). When set, this is the in-hand short resource-event with a
   * `recruit-character` effect that lets the player bring a character into play
   * outside the normal organization-phase rules: at a relaxed set of site types,
   * during any phase a company is at a site, and without consuming the
   * one-character-per-turn slot. On resolution the event card is discarded.
   * Absent for a normal character play.
   */
  readonly viaEventInstanceId?: CardInstanceId;
}

/**
 * Reanimate a character from the discard pile into play at a site as a new
 * company, tapping the player's Ringwraith who is present at that site as the
 * cost. Enabled by the `ringwraith-reanimate-from-discard` site-rule — Urlurtsu
 * Nurn (le-409): "If your Ringwraith is at this site, he may tap during the
 * organization phase to bring one Orc or Troll character from your discard pile
 * into play at this site (as another company)."
 */
export interface ReanimateFromDiscardAction {
  readonly type: 'reanimate-from-discard';
  /** The player activating the ability. */
  readonly player: PlayerId;
  /** The player's Ringwraith (avatar) at the site — tapped to pay the cost. */
  readonly ringwraithInstanceId: CardInstanceId;
  /** The character in the player's discard pile to bring into play. */
  readonly characterInstanceId: CardInstanceId;
  /** The site instance where the new company forms (the Ringwraith's site). */
  readonly siteInstanceId: CardInstanceId;
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
 * Choose which of a multi-roll gold-ring test's totals the test uses
 * (Wizard's Test tw-365: "make two rolls and choose one result to use for the
 * test"). Emitted once per distinct rolled total after the last roll of a
 * `gold-ring-test` resolution whose `rollCount` is greater than 1; the chosen
 * total then drives the ring's `ring-test-table` exactly as a single roll does.
 */
export interface ChooseGoldRingTestRollAction {
  /** Action discriminant. */
  readonly type: 'choose-gold-ring-test-roll';
  /** The ring's owner (who chooses). */
  readonly player: PlayerId;
  /** The gold-ring item instance being tested. */
  readonly goldRingInstanceId: CardInstanceId;
  /** The modified 2d6 total to use for the test — one of the rolled totals. */
  readonly rollTotal: number;
  /** Human-readable breakdown (the total and the ring categories it opens). */
  readonly explanation: string;
}

/**
 * Play a special ring card from hand as the replacement ring after a gold
 * ring test (Rule 9.21). Resolves a `ring-play-offer` pending resolution.
 *
 * The ring is placed on the character who bore the gold ring (or in stored
 * state if the test was triggered at a Darkhaven). To skip without playing,
 * the player sends a generic `pass` action instead.
 */
export interface PlayRingAfterTestAction {
  /** Action discriminant. */
  readonly type: 'play-ring-after-test';
  /** The ring's owner (who plays). */
  readonly player: PlayerId;
  /** The special ring card instance to play. */
  readonly ringInstanceId: CardInstanceId;
  /**
   * Where the ring card comes from. Defaults to `'hand'` when absent (the
   * normal case). Set to `'play-deck'` or `'discard-pile'` when the card
   * was found via a `ring-test-search` effect (e.g. Gleaming Gold Ring).
   */
  readonly source?: 'hand' | 'play-deck' | 'discard-pile';
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
  /** For company-targeting permanent events (e.g. Fellowship), the target company ID. */
  readonly targetCompanyId?: import('./common.js').CompanyId;
  /** For item-targeting permanent events (e.g. Barrow-blade dm-119), the target item instance. */
  readonly targetItemInstanceId?: CardInstanceId;
  /** For faction-targeting permanent events (Long Grievous Siege ba-40), the target in-play faction instance. */
  readonly targetFactionInstanceId?: CardInstanceId;
  /** For long-event-targeting permanent events (Echo of All Joy td-110), the target in-play resource long-event instance. */
  readonly targetLongEventInstanceId?: CardInstanceId;
  /**
   * For a `faction-siege` permanent event (Long Grievous Siege ba-40), the site
   * card instance in the player's location deck chosen to be besieged — moved
   * "off to the side" with the event on resolution.
   */
  readonly besiegedSiteInstanceId?: CardInstanceId;
  /** Card instance to discard as a play cost (e.g. Sapling of the White Tree for The White Tree). */
  readonly discardCardInstanceId?: CardInstanceId;
  /**
   * For a `play-with-stored-card` event (Wizard's Trove wh-85), the named
   * companion card in hand (e.g. The White Tree) that enters play together
   * with this card at `targetSiteDefinitionId`.
   */
  readonly companionCardInstanceId?: CardInstanceId;
  /**
   * For a `storage-site-transfer` event (Wizard's Trove wh-85), the item to
   * store at `targetSiteDefinitionId` when this card resolves.
   */
  readonly storeItemInstanceId?: CardInstanceId;
  /** For a `storage-site-transfer` event: the character currently bearing `storeItemInstanceId`. */
  readonly storeCharacterId?: CardInstanceId;
  /**
   * For an `opposed-roll` event (No More Nonsense le-210), the second character
   * — "another character in the company" — that rolls against
   * `targetCharacterId`. One action is emitted per (target, opponent) pair.
   */
  readonly opposedCharacterId?: CardInstanceId;
}

/**
 * Execute one of the two dice rolls of a pending `opposed-roll` resolution
 * (No More Nonsense le-210).
 *
 * The challenger (the card's play-target) rolls first; the chosen opposing
 * character rolls second. After the second roll the engine adds each side's
 * `addStat` to its total, compares them, and applies the source card's
 * `onWin` / `onLose` outcomes.
 */
export interface OpposedRollAction {
  /** Action discriminant. */
  readonly type: 'opposed-roll';
  /** The player who controls both characters (and therefore rolls). */
  readonly player: PlayerId;
  /** The character this roll is for — the challenger first, then the opponent. */
  readonly characterId: CardInstanceId;
  /** Human-readable breakdown of the contest so far. */
  readonly explanation: string;
}

/**
 * Pair a resource card from hand with an in-play Crown of Flowers, directly
 * entering the resource into play linked to Crown of Flowers.
 * Offered as a non-blocking organization-phase action while an unpaired
 * Crown of Flowers is in play (see `cofPairResourceActions`).
 *
 * The paired resource is considered to be played and in play as though
 * Gates of Morning were in play and Doors of Night were not.
 */
export interface PairResourceWithCofAction {
  readonly type: 'pair-resource-with-cof';
  /** The player performing the pairing. */
  readonly player: PlayerId;
  /** The resource card instance from hand to pair with Crown of Flowers. */
  readonly cardInstanceId: CardInstanceId;
  /** The Crown of Flowers instance already in play. */
  readonly cofInstanceId: CardInstanceId;
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
  /** The character performing the action (tapped as cost, unless `noTap` is set). */
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
   * Optional target company for actions that apply to a chosen company
   * (e.g. Dwar's Darkhaven buff — targets any one of the player's companies).
   * Set by the legal-action emitter when `targets.scope === "player-companies"`.
   */
  readonly targetCompanyId?: import('./common.js').CompanyId;
  /**
   * Second character involved in the cost, used when `cost.tap ===
   * "sage-and-scout-in-company"`. Carries the scout's instance ID while
   * `characterId` carries the sage's instance ID.
   */
  readonly secondCharacterId?: CardInstanceId;
  /**
   * Second target card for actions that require two item targets
   * (e.g. Hermit's Hill "discard-minors-for-major": `targetCardId`
   * carries the first minor item, this field carries the second).
   */
  readonly secondTargetCardId?: CardInstanceId;
  /**
   * Recipient character for a `place-item-on-character` apply (The
   * Forge-master wh-117): the character at the bearer's site that receives
   * the fetched item, while `targetCardId` carries the fetched item's
   * instance ID. The recipient is not tapped to receive the item.
   */
  readonly recipientCharacterId?: CardInstanceId;
  /**
   * METD §7 / rule 10.08 — for `remove-self-on-roll` from a corruption
   * card: when true, the character does NOT tap, the roll suffers -3,
   * and a per-character per-card lock blocks any further removal
   * attempts on this card for the rest of the turn.
   */
  readonly noTap?: true;
}

/**
 * Replace an in-play character with another manifestation of the same
 * entity from hand (a `manifestation-swap` card effect — e.g. Strider
 * ba-1: "You may bring Aragorn II into play with Strider's company,
 * removing Strider from the game and automatically transferring all
 * cards on Strider to Aragorn II").
 *
 * The new manifestation enters the old one's company untapped at the
 * same position; every card attached to the old manifestation (items,
 * allies, hazards, trophies) and every control relationship (its
 * controller, its followers) transfers to the new instance. The old
 * manifestation's card is removed from the game (out-of-play pile).
 * Per CRF 22 (Strider), the swap may be performed at any time a normal
 * resource could be played.
 */
export interface ManifestationSwapAction {
  readonly type: 'manifestation-swap';
  /** The player performing the swap. */
  readonly player: PlayerId;
  /** The in-play character carrying the `manifestation-swap` effect (removed from the game). */
  readonly characterId: CardInstanceId;
  /** The hand card (the named manifestation) brought into play in its place. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Discard an in-play character carrying a `discard-to-recruit` effect to bring
 * a matching character from hand into that character's company (e.g. Folco
 * Boffin dm-180: "You may discard Folco Boffin at a Haven to play any Hobbit
 * from your hand with his company").
 *
 * The incoming character enters the bearer's company untapped at the same
 * position; every card attached to the bearer (items, allies, hazards,
 * trophies) and every control relationship transfers to the new instance. The
 * discarded bearer's card goes to its owner's discard pile. Per CRF 22 (Folco
 * Boffin), the replacement may be performed at any time a normal resource
 * could be played.
 */
export interface DiscardToRecruitAction {
  readonly type: 'discard-to-recruit';
  /** The player performing the replacement. */
  readonly player: PlayerId;
  /** The in-play character carrying the `discard-to-recruit` effect (discarded). */
  readonly characterId: CardInstanceId;
  /** The hand card (matching character) brought into play in its place. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Tap a sage to test a gold-ring item at a site whose `sage-tap-ring-test`
 * site-rule grants the ability (e.g. Mount Doom, le-393). The named sage
 * taps; the gold-ring item's owner then rolls a ring test with the site's
 * roll modifier applied. The ring is discarded and a matching special ring
 * may be played, exactly as for any other ring test.
 */
export interface TestRingAtSiteAction {
  readonly type: 'test-ring-at-site';
  /** The player performing the test. */
  readonly player: PlayerId;
  /** The untapped sage tapping to perform the test (cost). */
  readonly characterId: CardInstanceId;
  /** The gold-ring item — borne by a character in the sage's company — being tested. */
  readonly targetCardId: CardInstanceId;
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

// ---- Post-attack bearer selection (trigger-attack-on-play) ----

/**
 * Resource player selects an untapped character to tap and become the bearer
 * of a permanent event with `trigger-attack-on-play` (e.g. Rescue Prisoners,
 * The Windlord Found Me).
 *
 * Offered by a `select-card-bearer` pending resolution after the triggered
 * attack resolves or is cancelled, when at least one character remains untapped.
 *
 * The chosen character is tapped and gains a `bearer-cannot-untap` constraint
 * tied to the card instance.
 */
export interface SelectCardBearerAction {
  readonly type: 'select-card-bearer';
  readonly player: PlayerId;
  /** The permanent-event card instance being assigned. */
  readonly cardInstanceId: CardInstanceId;
  /** The untapped character chosen to bear the card. */
  readonly characterId: CardInstanceId;
}

/**
 * Discards one of the player's own characters while organizing (CoE rule
 * 3.22). Only a non-avatar character whose company is at a haven or at the
 * character's home site may be discarded. The character's items and allies
 * are discarded with it; its followers revert to general influence.
 */
export interface DiscardCharacterOrgAction {
  readonly type: 'discard-character';
  readonly player: PlayerId;
  /** The in-play character instance to discard. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * A Fallen-wizard discards one of their in-play stage resource permanent-events
 * during the organization phase (MEWH "The Player Turn"). Only offered when the
 * resulting stage-point total stays at 3 or more.
 */
export interface DiscardStageResourceAction {
  readonly type: 'discard-stage-resource';
  readonly player: PlayerId;
  /** The in-play stage permanent-event card instance to discard. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * The controller voluntarily discards one of their in-play permanent-events
 * carrying a `voluntary-discard` effect during their organization phase
 * ("Discard during your organization phase if you choose" — Going Ever Under
 * Dark ba-37).
 */
export interface VoluntaryDiscardInPlayAction {
  readonly type: 'voluntary-discard-in-play';
  readonly player: PlayerId;
  /** The in-play permanent-event card instance to discard. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Returns an attached resource (an ally carrying a `return-to-hand` effect whose
 * triggers include `organization`) from play to its owner's hand during that
 * player's organization phase. Used by Radagast's Black Bird (wh-114): "You may
 * return … to your hand: during your organization phase …".
 */
export interface ReturnAttachedToHandAction {
  readonly type: 'return-attached-to-hand';
  readonly player: PlayerId;
  /** The attached ally instance to return to hand. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Activates the optional once-per-organization-phase fetch granted by an in-play
 * permanent-event carrying an `org-phase-fetch` effect (A Strident Spawn wh-61:
 * "During your organization phase, you may take one Half-orc character from your
 * discard pile to your hand"). Activating enqueues the shared `fetch-to-deck`
 * pending effect (`to: 'hand'`), which drives the existing pick-one-or-pass
 * sub-flow, and marks the source card's activation as spent for this turn.
 */
export interface ActivateOrgFetchAction {
  readonly type: 'activate-org-fetch';
  readonly player: PlayerId;
  /** The in-play permanent-event card instance granting the fetch. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Discards an in-play permanent-event carrying an `evil-hour-grant-movement`
 * effect during the organization phase (while the card is tapped) to grant the
 * targeted company a persistent conditional region-movement bonus (A More Evil
 * Hour, ba-48). See {@link Company.evilHourMovementBonus}.
 */
export interface DiscardForEvilHourMovementAction {
  readonly type: 'discard-for-evil-hour-movement';
  readonly player: PlayerId;
  /** The tapped in-play permanent-event card instance to discard. */
  readonly cardInstanceId: CardInstanceId;
  /** The controller's company that gains the movement bonus. */
  readonly companyId: CompanyId;
}

/**
 * Tap one untapped character in a company toward its Enchanted Stream (as-27)
 * movement tax during the organization phase. The company is bound by a
 * `company-movement-tax` permanent event and may not voluntarily declare
 * movement or split until the tax is paid; each `pay-movement-tax` taps one
 * character and increments {@link OrganizationPhaseState.movementTaxPaid} for
 * that company. ("Tap all of its untapped characters to a maximum of two.")
 */
export interface PayMovementTaxAction {
  /** Action discriminant. */
  readonly type: 'pay-movement-tax';
  /** The active player paying the tax. */
  readonly player: PlayerId;
  /** The company whose movement tax is being paid. */
  readonly companyId: CompanyId;
  /** The untapped character in that company to tap. */
  readonly characterId: CardInstanceId;
}

/**
 * Declare that a character begins using a borne item it is not currently
 * using (CoE 9.16).
 *
 * A character may bear any number of items but only one weapon, armor, shield
 * and helmet may be in use at a time. Absent any declaration the engine picks
 * per slot by carrying order; this action lets the resource player override
 * that choice. The item takes its slot immediately, and the effects of the
 * item it displaces cease at the same moment — nothing moves between
 * characters and no corruption check is involved, which is what separates
 * this from {@link TransferItemAction}.
 *
 * Only offered for a slotted item (weapon/armor/shield/helmet) that the
 * character bears but is not already using: switching to an item already in
 * use would change nothing.
 *
 * The declaration window is the organization phase, alongside the other
 * item-handling actions (transfer, store). Rule 9.16 itself names no phase —
 * it is an ordinary resource action — so the window may widen later; the
 * declaration state it writes ({@link CharacterInPlay.itemsInUse}) is
 * phase-independent and persists until the player declares otherwise.
 */
export interface UseItemAction {
  /** Action discriminant. */
  readonly type: 'use-item';
  /** The resource player declaring the switch. */
  readonly player: PlayerId;
  /** The character that will begin using the item. */
  readonly characterInstanceId: CardInstanceId;
  /** The borne item that comes into use. */
  readonly itemInstanceId: CardInstanceId;
  /** When true, this action undoes a previous switch this phase (regressive). */
  readonly regress?: true;
}

/**
 * Resolve one step of an `influence-overflow-discard` pending resolution
 * (CoE 3.47): the active player left their organization phase over their
 * general influence and removes one non-avatar character from play. The
 * resolution offers only the highest-priority tier that still has a member,
 * so the chosen character is whichever the rule mandates next; a character
 * brought into play this organization phase returns to its owner's hand,
 * every other one is discarded.
 */
export interface InfluenceOverflowDiscardAction {
  /** Action discriminant. */
  readonly type: 'influence-overflow-discard';
  /** The player who exceeded their general influence. */
  readonly player: PlayerId;
  /** The character to remove from play. */
  readonly characterInstanceId: CardInstanceId;
}
