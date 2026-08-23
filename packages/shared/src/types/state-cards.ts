/**
 * @module state-cards
 *
 * Runtime card instance types and in-play structures for the MECCG engine.
 * Defines how cards exist at runtime: card instances, characters in play,
 * items, allies, companies, events, and marshalling point tracking.
 */

import {
  CardInstanceId,
  CompanyId,
  CardDefinitionId,
  CardStatus,
  Race,
} from './common.js';
import type { ViewCard } from './common.js';

// ---- Card Instances (runtime, in-game) ----

/**
 * A runtime card instance, linking a unique in-game instance to its
 * static definition. Every card in every zone (hand, deck, discard, in-play)
 * is tracked as a CardInstance so the engine can distinguish between
 * multiple copies of the same card definition.
 */
export interface CardInstance {
  /** Globally unique identifier for this specific card in this game session. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static card definition in `GameState.cardPool`. */
  readonly definitionId: CardDefinitionId;
  /**
   * For a card stored in the marshalling-point pile (`killPile`): the site
   * definition it was stored at. Stamped by the store flows (`store-item`,
   * `storage-site-transfer`) at storage time; meaningless (absent) in every
   * other zone, and naturally dropped when the card changes zones via
   * `toCardInstance`. Consumed by "stored there" references such as Wizard's
   * Trove (wh-85): "You may play The White Tree at one of your Wizardhavens
   * [{H}] if Sapling of the White Tree is stored there."
   */
  readonly storedAtSite?: CardDefinitionId;
  /**
   * Stamped by {@link applyDraftResults} on a Stage resource it sets aside to
   * hand at draft finalize instead of putting into play (no gated character
   * to pair with, no site pairing, a site-pairing collision, or the
   * "in lieu of a minor item" item-draft placement wait) — MEWH §1 / CoE
   * 1.7.F1: the card's stage points were already counted toward the running
   * total mid-draft, and nothing requires that count to regress just because
   * the card has not yet found its way into play. Read by
   * `playerStagePoints` to sum only these hand cards, never an ordinary Stage
   * resource drawn and held in hand mid-game (which contributes nothing
   * until played).
   */
  readonly pendingDraftStagePoints?: true;
  /**
   * Stamped when a card is sunk into `outOfPlayPile` because it was "removed
   * from the game" rather than eliminated/removed-from-play — e.g. undrafted
   * character-deck-draft pool characters (CoE rule 1.9). Per the glossary's
   * "unique" and "remove from the game" entries, cards removed from the game
   * entirely are "no longer considered for purposes of uniqueness" and a
   * unique copy may be played again by either player, unlike a genuinely
   * eliminated character (which continues to occupy the unique's
   * in-play-or-removed-from-play slot). Read by `isUniqueCharacterInPlay` to
   * skip these entries when scanning `outOfPlayPile`.
   */
  readonly removedFromGame?: true;
}

// ---- Characters in play ----

/**
 * The full in-play state of a single character card.
 *
 * Characters exist within companies and can carry items, command allies,
 * have corruption cards attached, and control follower characters via
 * direct influence. The `controlledBy` field tracks the influence chain:
 * either under general influence or under a specific character's direct influence.
 */
/**
 * Computed effective stats for a character, including modifiers from
 * equipped items and attached corruption cards. Recomputed after every
 * action by {@link recomputeDerived}. Combat-time modifiers (tapped
 * penalty, support bonus) are NOT included — those are applied locally
 * during combat resolution.
 */
export interface EffectiveStats {
  /** Base prowess + sum of item prowess modifiers. */
  readonly prowess: number;
  /** Base body + sum of item body modifiers. */
  readonly body: number;
  /** Base direct influence (item DI modifiers not yet implemented). */
  readonly directInfluence: number;
  /** Sum of corruption points from all items and corruption cards. */
  readonly corruptionPoints: number;
  /**
   * Effective mind after applying stat-modifier effects (e.g. troll triplet
   * mind reduction when companions are in the company). Undefined means no
   * modifier applies and the base `mind` from the card definition should be
   * used. Only set when a `stat-modifier` with `stat: "mind"` fires.
   */
  readonly mind?: number;
}

/**
 * An item card currently in play, attached to a character.
 * Items provide stat modifiers and corruption points.
 */
export interface ItemInPlay {
  /** The card instance ID of this item. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static item card definition. */
  readonly definitionId: CardDefinitionId;
  /** Current state of this item — untapped, tapped, or inverted. */
  readonly status: CardStatus;
  /**
   * The site definition ID where this item entered play, for permanent
   * events with a site-scoped `duplication-limit` that then attach to a
   * bearer via `select-card-bearer` (e.g. Rescue Prisoners tw-315). Once
   * attached, the item travels with its bearer, so the site it was played
   * at must be recorded separately from the bearer's current location —
   * `countPermanentEventCopiesAtSite` checks this field rather than the
   * bearer's company's `currentSite`.
   */
  readonly playedAtSiteDefId?: CardDefinitionId;
}

/**
 * Per-instance stat overrides for an ally whose effective mind/prowess/body
 * are dictated by the effect that created it rather than by its card
 * definition. Used when a hazard creature is converted into an ally by
 * *Ready to His Will* (le-220): the creature card has no ally stats, so the
 * conversion effect supplies them (mind 1, prowess = creature prowess − 7,
 * body 8). Ally-stat readers consult these overrides before falling back to
 * the card definition (see `engine/ally-stats.ts`).
 */
export interface AllyStatOverride {
  /** Effective mind of the ally (used for influence checks, Stay Her Appetite, etc.). */
  readonly mind: number;
  /** Effective combat prowess of the ally. */
  readonly prowess: number;
  /** Effective body of the ally for body checks. */
  readonly body: number;
}

/**
 * An ally card currently in play, traveling with a character.
 * Allies contribute prowess in combat and marshalling points.
 */
export interface AllyInPlay {
  /** The card instance ID of this ally. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static ally card definition. */
  readonly definitionId: CardDefinitionId;
  /** Current state of this ally — untapped, tapped, or inverted. */
  readonly status: CardStatus;
  /**
   * Stat overrides for an ally that does not derive its mind/prowess/body
   * from its card definition (e.g. a hazard creature converted into an ally
   * by *Ready to His Will*). When present, these values take precedence over
   * the definition's stats everywhere ally stats are read.
   */
  readonly statOverride?: AllyStatOverride;
}

/**
 * A card currently in play on the table, not attached to any character or company.
 * Examples include permanent resource events, factions, and other general cards
 * that persist between turns.
 */
export interface CardInPlay {
  /** The card instance ID of this card. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static card definition. */
  readonly definitionId: CardDefinitionId;
  /** Current state of this card — untapped, tapped, or inverted. */
  readonly status: CardStatus;
  /** If this event is attached to a specific card (e.g. a corruption card on a character). */
  readonly attachedTo?: CardInstanceId;
  /**
   * If this card is bound to a *site location* rather than a specific
   * card instance — used by site-targeting hazards like *River* whose
   * effects fire when any company arrives at the named site.
   *
   * Stored as a {@link CardDefinitionId} (not an instance ID) because
   * multiple players' site decks may contain the same site location;
   * the binding is to the location itself, not to one player's copy.
   */
  readonly attachedToSite?: CardDefinitionId;
  /**
   * If this permanent event is attached to one of its controller's *agents*
   * (`play-target: "agent"`), the agent's virtual-company id
   * ({@link AgentInPlay.id}). The event lives in the controller's `cardsInPlay`
   * while so attached, and is discarded once the bound agent leaves play
   * entirely — via the orphaned-agent-attached event sweep
   * (`discardOrphanedAgentAttachedEvents`). A card additionally carrying
   * `agent-reveal-site-override` (Inner Cunning dm-68) discards early, the
   * moment the agent is revealed ("Discard when the agent is revealed"); one
   * without that marker (Never Seen Him dm-74) persists through reveal.
   */
  readonly attachedToAgentId?: import('./common.js').CompanyId;
  /**
   * If this permanent event is attached to a specific *item* in play rather
   * than to its bearer directly — the item's {@link CardInstanceId}. The card
   * lives in its controller's `cardsInPlay` while so attached; its
   * `stat-modifier` effects flow to the character bearing the item (collected
   * in `collectCharacterEffects`), and it is discarded when the host item
   * leaves play (the orphaned-item-attached-event sweep). Used by Barrow-blade
   * (dm-119): "play this with the Dagger [of Westernesse]".
   */
  readonly attachedToItem?: CardInstanceId;
  /**
   * If this permanent event is attached to one of its controller's own
   * in-play *resource long-events* rather than to a character, item, or
   * faction — the target long-event's {@link CardInstanceId}. The card lives
   * in its controller's `cardsInPlay` while so attached, and while it does,
   * the target long-event is exempt from the beginning-of-long-event-phase
   * discard sweep ([2.III.1]) that would otherwise remove it. Whichever of
   * the pair leaves play first takes the other with it. Used by Echo of All
   * Joy (td-110): "Play on a resource long-event... The long-event is not
   * discarded as normal during a long-event phase. Discard Echo of All Joy
   * and target long-event when any play deck is exhausted or when Doors of
   * Night comes into play."
   */
  readonly attachedToLongEvent?: CardInstanceId;
  /**
   * Instance ID of the card this is linked to via Crown of Flowers pairing
   * (mutual discard). When either linked card is discarded from cardsInPlay,
   * the other is discarded as well.
   */
  readonly linkedInstanceId?: CardInstanceId;
  /**
   * Card names to assume are in play when evaluating this card's effects.
   * Crown of Flowers injects "Gates of Morning" for the paired resource,
   * so that GoM-conditional effects on that resource are treated as active.
   */
  readonly assumeInPlay?: readonly string[];
  /**
   * Card names to assume are NOT in play when evaluating this card's effects.
   * Crown of Flowers removes "Doors of Night" for the paired resource,
   * so DoN-blocking effects do not suppress the paired resource's abilities.
   */
  readonly assumeNotInPlay?: readonly string[];
  /**
   * For company-targeting permanent events (e.g. Fellowship), the ID of the
   * company this card is bound to. Effects on this card that use
   * `company-modifier` are scoped to characters in this company only.
   * The card is discarded when the company's membership changes.
   */
  readonly companyId?: import('./common.js').CompanyId;
  /**
   * Instance IDs of cards placed "off to the side" with this host
   * permanent-event (MEAS §1, e.g. *Sack Over the Head*, *Summons from Long
   * Sleep*). These cards remain reachable in state via the host's player's
   * `cardsInPlay`; they are in play for uniqueness, untargetable except by
   * cards that name "off to the side", and discarded to their owner when the
   * host leaves the playing surface (unless the host card says otherwise).
   */
  readonly setAside?: readonly CardInstanceId[];
  /**
   * Set on a card that has itself been placed "off to the side": the instance
   * ID of the host permanent-event it is kept with (MEAS §1). A set-aside card
   * is excluded from ordinary targeting and from its host player's marshalling
   * points (its MPs are credited to {@link ownerOf} instead).
   */
  readonly setAsideHost?: CardInstanceId;
  /**
   * When true, this set-aside card is *not* discarded when its host leaves the
   * playing surface — the host card overrides the default discard (e.g.
   * *Sacrifice of Form* keeps the converted item in play). Captured at
   * set-aside time so the host-removal sweep can honour the override without
   * re-reading the (already gone) host definition.
   */
  readonly setAsideKeepOnRemoval?: boolean;
  /**
   * When true, this set-aside card scores **no** marshalling points at all —
   * overriding the MEAS §1 default of crediting them to {@link ownerOf}. Great
   * Secrets Buried There (dm-63): "item does not give marshalling points and
   * is considered out of play." Captured at set-aside time.
   */
  readonly setAsideNoMp?: boolean;
  /**
   * Sacrifice of Form (tw-321): the instance ID of the Wizard this card
   * sacrificed, recorded for the lifetime of the game once set. While the
   * Wizard is discarded this card holds his items in its `setAside` list with
   * no `attachedTo`; once he is put back into play (by any means) the reactive
   * sweep (`sacrifice-of-form.ts` `sweepSacrificeOfFormReturn`) sets
   * `attachedTo` to him, returns the items, and synthesises this card's +1
   * prowess/body/direct-influence `stat-modifier` effects into
   * `character-stat-modifier` active constraints on him. Also used to enforce
   * "cannot be duplicated on a given Wizard" — a second copy is blocked while
   * any in-play card already names that Wizard's instance ID here.
   */
  readonly sacrificeOfFormCharacterInstanceId?: CardInstanceId;
  /**
   * For a faction placed *under the control of a specific leader* (the LE
   * "Orcs of Udûn"-style factions, e.g. le-262, le-275, le-279, le-281,
   * le-282, le-291): the instance ID of the controlling character. Set when
   * an Orc or Troll leader successfully influences the faction and the player
   * elects to take control (which also leaves the site untapped). The faction
   * is discarded if that leader moves or leaves play, and a leader controlling
   * three or more such factions earns bonus marshalling points. See the
   * `leader-control` effect.
   */
  readonly controlledBy?: CardInstanceId;
  /**
   * Marshalling-point pin: this card is worth exactly this many marshalling
   * points, overriding its printed value, the MEWH §4 clamp, and every MP
   * modifier ("regardless of other cards in play"). Recorded per instance
   * because it depends on *when* the card was played, not on its definition.
   * Set on a faction influenced into play while Await the Onset (wh-96) is in
   * play — the card's "place these factions under Await the Onset" clause, which
   * pins each such faction to 1 MP.
   */
  readonly mpPinned?: number;
  /**
   * For a permanent event placed "with" a card stored in its controller's
   * marshalling-point pile (Wizard's Trove wh-85 `storage-site-transfer`
   * mode): the stored card's instance ID. While this link is live and the
   * event's effect declares `fullMarshallingPoints`, the stored card scores
   * its full storage MP — exempt from the MEWH §4 Fallen-wizard clamp and
   * cross-alignment halving.
   */
  readonly attachedToStored?: CardInstanceId;
  /**
   * Set on a card brought into play with its printed text ignored (Wizard's
   * Trove wh-85: "Ignore the text of The White Tree (including the Unique
   * keyword)."). The card's effects were never applied on entry, and its name
   * is excluded from the in-play names list so uniqueness does not bind —
   * neither blocking other copies nor being blocked by them.
   */
  readonly textIgnored?: boolean;
  /**
   * Set on a `trigger-attack-on-play` permanent event (e.g. Descent through
   * Fire ba-56) while its self-inflicted attacks are still resolving. Such a
   * card enters `cardsInPlay` *before* the attacks it triggers, but its own
   * ongoing effects (e.g. "+1 prowess to all your characters") must not apply
   * until the card is actually kept in the marshalling-point pile after the
   * attacks. While this flag is set, {@link collectGlobalEffects} ignores the
   * card's effects; it is cleared when the bearer is selected
   * (`move-to-mp-pile` keep) and the card is gone if instead discarded.
   */
  readonly pendingTriggerAttack?: boolean;
}

/**
 * An on-guard card placed face-down at a company's site by the hazard player.
 * Tracks whether the card has been revealed (flipped face-up) during the site phase.
 * Revealed cards remain in the onGuardCards array with `revealed: true` until
 * they are consumed (e.g. creature attacks resolve) or returned to hand at cleanup.
 */
export interface OnGuardCard {
  /** The card instance ID of this on-guard card. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static card definition. */
  readonly definitionId: CardDefinitionId;
  /** Whether this card has been revealed (flipped face-up). */
  readonly revealed: boolean;
}

/**
 * A site card currently in play, associated with a company.
 * Sites track their tapped/untapped state — a tapped site cannot
 * be used to play another resource that requires tapping.
 */
export interface SiteInPlay {
  /** The card instance ID of this site. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static site card definition. */
  readonly definitionId: CardDefinitionId;
  /** Current state of this site — untapped or tapped. */
  readonly status: CardStatus;
}

export interface CharacterInPlay {
  /** The card instance ID of this character. */
  readonly instanceId: CardInstanceId;
  /** Reference to the static character card definition. */
  readonly definitionId: CardDefinitionId;
  /** Current tap state -- affects combat prowess and available actions. */
  readonly status: CardStatus;
  /** Items attached to this character (e.g. weapons, armor, rings). */
  readonly items: readonly ItemInPlay[];
  /** Allies traveling with this character. */
  readonly allies: readonly AllyInPlay[];
  /** Hazard cards attached to this character (corruption cards, Foolish Words, etc.). */
  readonly hazards: readonly CardInPlay[];
  /** Character instance IDs controlled by this character via direct influence. */
  readonly followers: readonly CardInstanceId[];
  /**
   * How this character is controlled:
   * - `'general'` -- Under the player's 20-point general influence pool.
   * - A `CardInstanceId` -- Under the direct influence of another character.
   */
  readonly controlledBy: 'general' | CardInstanceId;
  /**
   * Set when this character was removed from direct-influence control *outside*
   * its player's organization phase (e.g. its controlling character was
   * eliminated, or an in-play effect dropped the controller's direct influence
   * below the character's mind cost). Per CoE 2.II.2.2.3, the mind of such a
   * character is **not** immediately subtracted from its player's general
   * influence; the subtraction is deferred until the player's next organization
   * phase, at which point the flag is cleared. While set, the character is
   * recorded as `controlledBy: 'general'` but is excluded from the
   * general-influence tally in {@link recomputeDerived}.
   *
   * A `no-direct-influence` restriction attached mid-turn (e.g. Rebel-talk
   * le-132) does *not* use this flag: per CRF-22, such a follower "does not
   * need to be controlled by general influence until [its] next organization
   * phase", so `controlledBy` is left untouched until that phase begins, at
   * which point the character is moved straight to `'general'` with its mind
   * counted immediately (see the no-direct-influence sweep in
   * `reducer-untap.ts`).
   */
  readonly influenceUnsubtracted?: boolean;
  /**
   * Grace-period marker for a Ringwraith follower whose controlling Ringwraith
   * avatar left play without being eliminated (CoE rule 3.08). A Ringwraith
   * follower can only be controlled by a Ringwraith avatar — it cannot revert
   * to general influence like an ordinary follower — so its player has until
   * the end of their next organization phase to bring a Ringwraith avatar back
   * into play to re-control it. Set to `'grace'` the moment the controlling
   * avatar leaves play, promoted to `'due'` when the player's next organization
   * phase begins, and settled when that phase ends: the flag clears if the
   * character is once again controlled by a Ringwraith avatar, otherwise the
   * character is immediately discarded.
   */
  readonly ringwraithReclaim?: 'grace' | 'due';
  /**
   * Items this character's controller has explicitly declared *in use*
   * (CoE 9.16). A character may bear any number of items but only use one
   * weapon, armor, shield and helmet at a time; absent a declaration the
   * engine picks per slot by carrying order (first-carried-wins). Declaring
   * an item promotes it ahead of its slot-mates, so it takes the slot and the
   * previously-used item's effects cease immediately.
   *
   * Only ever holds ids the player has actually declared — one per slot,
   * replaced when they declare another item of the same slot. Entries whose
   * item has since left the character are inert: slot selection is driven by
   * the real {@link items} array, which such an id no longer appears in.
   * Optional — absent while the character has never switched.
   */
  readonly itemsInUse?: readonly CardInstanceId[];
  /** Computed stats including item modifiers. Recomputed after every action. */
  readonly effectiveStats: EffectiveStats;
  /**
   * Creature cards taken as trophies by this Orc or Troll character (MELE §8.37).
   * A trophy is treated as a minor item worth 0 CP. Total printed MPs on all
   * trophy cards determine stat bonuses:
   * - 1 MP total → +1 Direct Influence
   * - 2 MP total → +1 DI, +1 Prowess (max 9)
   * - 3 MP total → +2 DI, +1 Prowess (max 9)
   * - 4+ MP total → +2 DI, +2 Prowess (max 9)
   *
   * Half-orcs may not take trophies.
   */
  readonly trophies?: readonly CardInstance[];
  /**
   * Races of attacks that wounded this character so far this turn, so a
   * hazard-event playable "on a character wounded by a [race] attack this
   * turn" (Pale Dream-maker dm-78, Endless Whispers dm-54) can query it via a
   * `play-target` filter on `target.woundedByRaceThisTurn`. Recorded in
   * `combat-finalize.ts` whenever a strike wounds the character; cleared for
   * every character at the start of each new turn (`enterUntapPhase`).
   */
  readonly woundedByRaceThisTurn?: readonly Race[];
}

// ---- Company ----

/**
 * A company is a group of characters traveling together between sites.
 *
 * Companies are the fundamental unit of movement and action in MECCG.
 * During the Organization phase, players can split, merge, and reorganize
 * companies and plan their movement to new sites. During Movement/Hazard,
 * each company faces hazards individually based on their travel path.
 */
export interface Company {
  /** Unique identifier for this company. */
  readonly id: CompanyId;
  /** Character instance IDs belonging to this company (order matters for strike assignment). */
  readonly characters: readonly CardInstanceId[];
  /** The site card in play where this company is currently located. Null during setup before site selection. */
  readonly currentSite: SiteInPlay | null;
  /**
   * Whether this company holds the physical site card.
   * False when the company was created by a split — the original company keeps the card.
   * Companies without the physical card still display the site but with a visual indicator.
   */
  readonly siteCardOwned: boolean;
  /**
   * The planned destination site, set during Organization phase.
   * Null if the company is staying put this turn.
   */
  /**
   * The planned destination site, set during Organization phase.
   * Stored as a full {@link SiteInPlay} so the definition ID is always
   * available even after the card is removed from the site deck.
   * Null if the company is staying put this turn.
   */
  readonly destinationSite: SiteInPlay | null;
  /** Region card instances defining the travel path from current site to destination. */
  readonly movementPath: readonly CardInstanceId[];
  /** Whether this company has already completed movement this turn. */
  readonly moved: boolean;
  /**
   * The site of origin for this company during the current M/H phase.
   * Set when the company begins its M/H sub-phase (step 2).
   * Used for site disposal at step 8 and for determining which site's
   * draw boxes to use when moving to a haven. Null before M/H phase.
   */
  readonly siteOfOrigin: CardInstanceId | null;
  /**
   * On-guard cards placed face-down at this company's site by the hazard
   * player during M/H phases. Each company's own M/H phase allows at most
   * one on-guard placement, but if multiple companies move to the same site
   * and are later joined, on-guard cards accumulate. Persists into the Site
   * phase where cards may be revealed under specific conditions. The cards'
   * identities are hidden from the resource player.
   */
  readonly onGuardCards: readonly OnGuardCard[];
  /** Hazard cards targeting this company as a whole (not a specific character). */
  readonly hazards: readonly CardInPlay[];
  /**
   * Special movement granted by a card effect (e.g. Gwaihir, Paths of the Dead).
   * When set, the company uses special movement rules during planning and M/H phase:
   * - `'gwaihir'`: Can move to any non-Shadow-land/Dark-domain/Under-deeps site.
   *   Only site-keyed hazard creatures may be played. No region path is traversed.
   * - `'paths-of-the-dead'`: Can move directly to the Vale of Erech site (CoE IE
   *   2018 erratum, tw-302). No region path is traversed.
   * - `'belegaer'`: Can move directly between sites in the Belegaer coastal
   *   regions (Lindon, Elven Shores, etc. — td-100), bypassing region
   *   adjacency. The path is treated as three coastal-sea regions for hazard
   *   keying purposes, and the hazard limit is reduced by 2 (floor 2).
   */
  readonly specialMovement?: 'gwaihir' | 'paths-of-the-dead' | 'belegaer' | undefined;
  /**
   * Extra region distance granted by a card effect (e.g. Cram).
   * Added to {@link BASE_MAX_REGION_DISTANCE} when computing maximum region
   * movement distance for this company. Defaults to 0 when undefined.
   */
  readonly extraRegionDistance?: number | undefined;
  /**
   * Set when A More Evil Hour (ba-48) was discarded during the organization
   * phase to target this company. While set, the company may move up to two
   * additional regions (region movement) whenever it moves **to** — or away
   * **from** — a site where an opponent's company is present. Unlike
   * {@link extraRegionDistance}, this is a persistent grant that is *not* reset
   * at turn boundaries (the effect is an ongoing ability of the company, per the
   * card's "thereafter, when leaving this site"). Defaults to false when absent.
   */
  readonly evilHourMovementBonus?: boolean | undefined;
  /**
   * Set on a company created by Left Behind (td-41): a character was peeled off
   * "following the attack" into this separate company that has the same site
   * path as the company he was in. While set, this company's hazard-limit
   * snapshot is forced to 1 for its own (separate) movement/hazard phase, and
   * after all movement/hazard phases the character may rejoin his original
   * company (identified by {@link leftBehindOriginCompanyId}). Cleared once the
   * rejoin is resolved (or declined).
   */
  readonly leftBehind?: boolean | undefined;
  /**
   * For a {@link leftBehind} company, the id of the company the character was
   * peeled off from — the "original company" he may rejoin after all M/H phases.
   */
  readonly leftBehindOriginCompanyId?: CompanyId | undefined;
  /**
   * Set when Left Behind (td-41) targeted a character who was **alone** in his
   * company: there is no other company to peel him into, so his own company is
   * flagged to run one more (separate) movement/hazard phase this turn with a
   * hazard limit of one. Consumed by `advanceAfterCompanyMH`, which re-runs the
   * company's M/H sub-phase once and clears the flag.
   */
  readonly leftBehindExtraPhasePending?: boolean | undefined;
  /**
   * Set on a company created by Turning Hope to Despair (as-41): a character
   * failed his post-attack mind roll and split off "into his own company"
   * sharing the same site path as the company he was in. While set, this
   * company's hazard-limit snapshot is forced to 1 for its own (separate)
   * movement/hazard phase this turn. Unlike {@link leftBehind}, there is no
   * explicit "may rejoin" clause on the card — the flag is cleared the moment
   * it is consumed by `enterSetHazardLimitAndAutoAdvance`, after which the
   * company merges back into another of its owner's companies through the
   * normal rule 2.IV.6 same-site auto-merge, with no special-casing.
   */
  readonly forcedSoloHazardLimit?: boolean | undefined;
  /**
   * Set when Turning Hope to Despair (as-41) targeted a character who was
   * **alone** in his company at the time of the split: there is no other
   * company to peel him into, so his own company is flagged to run one more
   * (separate) movement/hazard phase this turn with a hazard limit of one.
   * Consumed by `advanceAfterCompanyMH`, mirroring {@link leftBehindExtraPhasePending}.
   */
  readonly forcedSoloExtraPhasePending?: boolean | undefined;
  /**
   * Set when a `grant-extra-mh-phase` resource event (e.g. Forced March le-185,
   * Bridge tw-202, Leg It Double Quick le-202) resolves on this company during
   * its movement/hazard phase. After the company completes its current M/H phase
   * (its move to the qualifying site is committed), `advanceAfterCompanyMH`
   * consumes the flag and offers the company another movement to an additional
   * site — a fresh movement/hazard phase — via the `extra-mh-move-offer` step.
   *
   * The value `'under-deeps'` marks the Under-deeps variant (World Gnawed by
   * the Nameless as-110, `grant-extra-mh-phase` with `movement:
   * "under-deeps"`): the offer enumerates Under-deeps destinations the company
   * has not attempted to move to yet this turn instead of normally-reachable
   * sites.
   */
  readonly extraMHPhasePending?: boolean | 'under-deeps' | undefined;
  /**
   * Set on a company created by Urlurtsu Nurn's (le-409)
   * `ringwraith-reanimate-from-discard` ability: an Orc/Troll character was
   * brought from the discard pile into play "as another company" at the site
   * where the given Ringwraith stands. Holds that Ringwraith's instance id.
   * At the end of the movement/hazard phase, if this company still shares a
   * site with that Ringwraith's company, its character(s) are discarded — "The
   * character must move to a different site from that of your Ringwraith this
   * turn or be discarded at the end of the movement/hazard phase." Cleared once
   * the company has moved to a different site than the Ringwraith.
   */
  readonly reanimatedRingwraithId?: CardInstanceId | undefined;
}


// ---- Marshalling Points ----

/**
 * Breakdown of a player's marshalling points (victory points) by category.
 *
 * In MECCG, points are scored from characters in play, items, factions,
 * allies, and creature kills. At the Free Council, the doubling rule applies:
 * each category is capped so it cannot exceed the total of all other categories.
 */
export interface MarshallingPointTotals {
  /** Points from hero characters in play. */
  readonly character: number;
  /** Points from items controlled by characters. */
  readonly item: number;
  /** Points from successfully influenced factions. */
  readonly faction: number;
  /** Points from allies attached to characters. */
  readonly ally: number;
  /** Points from defeating enemy creatures and automatic attacks. */
  readonly kill: number;
  /** Points from miscellaneous sources (events, special abilities). */
  readonly misc: number;
}

/** Zero effective stats, used for initialization before recomputeDerived runs. */
export const ZERO_EFFECTIVE_STATS: EffectiveStats = {
  prowess: 0,
  body: 0,
  directInfluence: 0,
  corruptionPoints: 0,
};

/** An empty marshalling point totals object, used for initialization. */
export const ZERO_MARSHALLING_POINTS: MarshallingPointTotals = {
  character: 0,
  item: 0,
  faction: 0,
  ally: 0,
  kill: 0,
  misc: 0,
};

// ---- Setup-specific per-player state ----

/**
 * Per-player state during the character draft step.
 *
 * Before the game begins, both players simultaneously draft characters from
 * their pool. Each round, players make a face-down pick. If both picks are
 * different, both succeed. If they collide (same character), the duplicate
 * is set aside and neither player gets it. Players may stop drafting early.
 */
export interface DraftPlayerState {
  /** Cards available to draft from (up to 10). */
  readonly pool: readonly CardInstance[];
  /** Cards successfully drafted so far. */
  readonly drafted: readonly CardInstance[];
  /**
   * Fallen-wizard "Stage" resources (e.g. Thrall of the Voice wh-82, Hidden
   * Haven wh-75) drafted from the pool during the character draft. These are
   * tracked separately from {@link drafted} because they are not characters:
   * they do not consume the starting-company size budget, and drafting one
   * (Thrall) lifts the FW restriction on drafting mind > 5 / agent characters
   * (rules 1.42, 1.44). Resolved at draft finalize (see `applyDraftResults`).
   */
  readonly draftedStageResources: readonly CardInstance[];
  /** The face-down pick for the current draft round, or null if not yet picked. */
  readonly currentPick: CardInstance | null;
  /**
   * Whether this player's action for the current round was drafting a Stage
   * resource (rather than a face-down character pick). A Fallen-wizard who
   * drafts a Stage resource completes their round with it — the round resolves
   * without forcing a character pick, and the player simply adds no character
   * that round (CoE 1.9.F4; they finish drafting any remaining characters in
   * later rounds, solo after the opponent stops). Set when the Stage resource
   * is drafted, cleared when the round resolves. A Stage resource still awaiting
   * its site pairing (Hidden Haven, wh-75) does not complete the round until the
   * site is brought out (CRF 22) — see `completedRoundAction`.
   */
  readonly stageResourcePickedThisRound?: boolean;
  /** Whether this player has voluntarily stopped drafting (they keep what they have). */
  readonly stopped: boolean;
  /** Pairings of a drafted site-targeting Stage resource (Hidden Haven, wh-75) to the Ruins & Lairs site chosen from the player's site deck. Resolved at draft finalize: non-colliding pairs convert the site to a starting Wizardhaven; colliding pairs (both players chose the same site definition) are set aside per CRF 22. */
  readonly stageResourceSites?: readonly StageResourceSitePairing[];
  /**
   * Definition IDs the deck author marked as favourites — the characters this
   * deck wants in its starting company (see `PlayerConfig.favourites`).
   *
   * Carried here rather than derived because nothing on a card says which
   * characters a deck is built around; it is the author's declaration. It binds
   * no rule — every pool card remains legal to draft — and it is *hidden
   * information*: the projection strips it from the opponent's copy, since
   * knowing which characters they intend to start with is knowing their plan.
   */
  readonly favourites?: readonly CardDefinitionId[];
}

/**
 * A pairing of a drafted site-targeting Stage resource (Hidden Haven, wh-75)
 * with a Ruins & Lairs site chosen from the player's own site deck. Collected
 * during the character draft and resolved at draft finalize.
 */
export interface StageResourceSitePairing {
  /** The drafted Stage resource instance (e.g. Hidden Haven). */
  readonly stageResourceInstanceId: CardInstanceId;
  /** The site instance from the player's site deck paired with it. */
  readonly siteInstanceId: CardInstanceId;
}

/**
 * Per-player state during the item draft step.
 */
export interface ItemDraftPlayerState {
  /** Minor items not yet assigned to a character. */
  readonly unassignedItems: readonly CardInstance[];
  /** Whether this player has finished assigning items (or had none). */
  readonly done: boolean;
  /** Number of starting company events placed (counts against MAX_STARTING_ITEMS). */
  readonly startingEventsPlaced?: number;
}

/**
 * Per-player state during the character deck draft step.
 */
export interface CharacterDeckDraftPlayerState {
  /** Remaining pool characters available to add to the play deck. */
  readonly remainingPool: readonly CardInstance[];
  /** Whether this player has finished adding characters. */
  readonly done: boolean;
}

/**
 * Per-player state during the starting site selection step.
 */
export interface SiteSelectionPlayerState {
  /** Sites selected so far, each carrying instance ID and definition ID. */
  readonly selectedSites: readonly ViewCard[];
  /** Whether this player has finished selecting sites. */
  readonly done: boolean;
}
