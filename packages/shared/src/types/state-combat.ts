/**
 * @module state-combat
 *
 * Combat, chain of effects, and pending effect state types for the MECCG engine.
 * These sub-state machines layer on top of the current game phase and take
 * priority when active.
 */

import {
  PlayerId,
  CardInstanceId,
  CardDefinitionId,
  CompanyId,
  RegionType,
  SiteType,
} from './common.js';
import type { CardInstance, ItemInPlay } from './state-cards.js';
import type { CardEffect, TriggerAttackEntry } from './effects.js';

// ---- Combat sub-state ----

/**
 * Identifies what initiated a combat encounter.
 *
 * Combat can be triggered by:
 * - A creature hazard card played by the opponent during Movement/Hazard phase.
 * - An automatic attack built into a site card during the Site phase.
 * - An agent hazard attacking at its site during the Site phase.
 * - A company-vs-company attack (CvCC).
 * - An ahunt long-event creating a dragon attack during order-effects.
 */
export type AttackSource =
  | {
      readonly type: 'creature';
      readonly instanceId: CardInstanceId;
      /**
       * When set, this creature was played from a Summons from Long Sleep (as-39)
       * reservation slot. After combat resolves, the AS-39 permanent-event with
       * this instance ID is discarded regardless of the attack outcome.
       */
      readonly reservingCardInstanceId?: CardInstanceId;
    }
  | {
      /**
       * Triggered by Stay Her Appetite (le-140): an ally attacks its own
       * controlling character with a detainment attack (1 strike, prowess
       * = ally.prowess + dice roll). If the attack is NOT fully defeated,
       * the ally is discarded.
       */
      readonly type: 'stay-her-appetite-attack';
      readonly eventDefinitionId: CardDefinitionId;
      /** The ally being forced to attack its bearer. */
      readonly allyInstanceId: CardInstanceId;
      /** Player index of the ally's owner (resource player). */
      readonly allyOwnerPlayerIndex: number;
      /** The character the ally is attached to and will attack. */
      readonly hostCharacterInstanceId: CardInstanceId;
    }
  | { readonly type: 'automatic-attack'; readonly siteInstanceId: CardInstanceId; readonly attackIndex: number }
  | { readonly type: 'on-guard-creature'; readonly cardInstanceId: CardInstanceId }
  | { readonly type: 'played-auto-attack'; readonly instanceId: CardInstanceId; readonly siteInstanceId: CardInstanceId }
  | { readonly type: 'agent'; readonly instanceId: CardInstanceId }
  | { readonly type: 'company-attack'; readonly attackingCompanyId: CompanyId }
  | { readonly type: 'ahunt'; readonly longEventInstanceId: CardInstanceId }
  /**
   * Triggered by a resource permanent event carrying a
   * `trigger-attack-on-play` effect (e.g. Rescue Prisoners). The
   * attack resolves immediately after the card enters play.
   *
   * After combat, if no characters are untapped the card is discarded;
   * otherwise a `select-card-bearer` pending resolution is queued so the
   * resource player can choose which untapped character taps to take the card.
   *
   * `bearerCharacterId` is absent because the bearer is unknown until after
   * the attack resolves.
   */
  | {
      readonly type: 'card-triggered-attack';
      readonly cardInstanceId: CardInstanceId;
      /**
       * Attacks still to be triggered after the current one resolves
       * (multi-attack form of `trigger-attack-on-play`). Empty / absent
       * means this is the last (or only) attack in the sequence.
       */
      readonly remainingAttacks?: readonly TriggerAttackEntry[];
    }
  /**
   * Triggered by Lucky Search (tw-269) via the `deck-search-attack` DSL effect.
   * After the scout taps, cards are auto-revealed from the deck; the prowess
   * equals `baseProwess` + number of cards revealed. After combat:
   * - Scout not wounded + item found → item attached to scout.
   * - Scout wounded + item found → item discarded.
   * - Revealed non-item cards → shuffled back into the deck.
   */
  | {
      readonly type: 'lucky-search-attack';
      /** The scout character that tapped to play the event. */
      readonly scoutInstanceId: CardInstanceId;
      /** Instance ID of the non-special item found in the deck, or null. */
      readonly foundItemInstanceId: CardInstanceId | null;
      /** Instance IDs of ALL cards revealed (including found item). */
      readonly revealedCardInstanceIds: readonly CardInstanceId[];
    }
  /**
   * Triggered by Tidings of Bold Spies (le-143): a hazard short-event that
   * duplicates all automatic-attacks of the destination site as immediate
   * M/H-phase combat. `attackIndex` identifies which auto-attack is being
   * mirrored (0-based). These attacks are NOT automatic-attacks — auto-attack
   * modifiers do not apply.
   */
  | { readonly type: 'tidings-attack'; readonly eventInstanceId: CardInstanceId; readonly attackIndex: number }
  /**
   * Triggered by Cruel Caradhras (td-9) via the `company-strike` DSL effect: a
   * hazard short-event that makes each character in the active company face one
   * strike (not a creature attack — no race, uncancelable). `eventInstanceId`
   * is the played short-event card.
   */
  | { readonly type: 'company-strike-event'; readonly eventInstanceId: CardInstanceId }
  /**
   * Triggered by The Great Hunt (wh-91) via the `reveal-and-attack` effect. A
   * revealed / discarded hazard-creature attacks the controller's Alatar
   * company. The creature card is never moved out of its pile (deck or discard)
   * — it is attacked "in place", exactly like a Lucky Search revealed card — so
   * finalization does not discard or award it as a trophy.
   *
   * `continuation` distinguishes the two firing modes:
   *  - `'reveal'` — part of the on-play reveal sequence. On finalization the
   *    engine advances the `great-hunt-reveal` constraint queue: it either
   *    initiates the next queued creature's attack or, when the queue is empty,
   *    completes the process (reshuffling the opponent play deck if it was the
   *    revealed pile) and removes the constraint.
   *  - `'none'` — a one-off attack from the ongoing discard trigger; no queue.
   */
  | {
      readonly type: 'great-hunt-attack';
      readonly greatHuntInstanceId: CardInstanceId;
      readonly creatureInstanceId: CardInstanceId;
      readonly continuation: 'reveal' | 'none';
    };

/**
 * Tracks the assignment and resolution of a single strike against a character.
 *
 * During the 'assign-strikes' sub-phase, each strike is paired with a defending
 * character. During 'resolve-strike', the 2d6 + prowess roll determines the outcome.
 */
export interface StrikeAssignment {
  /** The character instance ID assigned to receive this strike. */
  readonly characterId: CardInstanceId;
  /** Number of excess strikes allocated to this character as -1 prowess each. */
  readonly excessStrikes: number;
  /** Whether this strike has been resolved via dice roll. */
  readonly resolved: boolean;
  /**
   * The outcome of the strike resolution:
   * - `'success'` -- The character defeated the strike (the strike is defeated:
   *   the character won the roll and the creature's body check failed, or the
   *   strike had no body and was auto-defeated per CoE 3.iv.7).
   * - `'survived'` -- The character won the roll but the creature passed its
   *   body check, so the strike was NOT defeated (the creature survives). The
   *   character is unharmed. Distinct from `'success'` so the creature is not
   *   counted as defeated when deciding kill-MP vs discard (CoE 3.v).
   * - `'wounded'` -- The character survived but is wounded (reduced capability).
   * - `'eliminated'` -- The character was killed and removed from play.
   * - `'canceled'` -- The strike was canceled before resolution (e.g. Fatty Bolger).
   */
  readonly result?: 'success' | 'survived' | 'wounded' | 'eliminated' | 'canceled' | 'absorbed';
  /**
   * Whether the character was already wounded before this strike was resolved.
   * Used for body check calculation: +1 if already wounded (CoE rule 3.I).
   */
  readonly wasAlreadyWounded?: boolean;
  /**
   * Whether a dodge-strike card was played for this strike. When true,
   * the character fights at full prowess but does not tap on success/tie.
   * If wounded, the character still gets wounded.
   */
  readonly dodged?: boolean;
  /**
   * Body penalty applied during the body check if the character was
   * wounded while dodging (e.g. -1 for Dodge).
   */
  readonly dodgeBodyPenalty?: number;
  /**
   * Number of untapped characters/allies in the same company who have
   * tapped to support this strike (CoE rule 3.iv.4). Each adds +1 to the
   * facing character's prowess for this strike resolution only.
   */
  readonly supportCount?: number;
  /**
   * Accumulated prowess bonus contributed by played `modify-strike`
   * short events (e.g. Risky Blow's +3) targeting this strike. Applied
   * in `resolveStrikeCore` alongside base prowess.
   */
  readonly strikeProwessBonus?: number;
  /**
   * Accumulated body penalty contributed by played `modify-strike`
   * short events (e.g. Risky Blow's -1). Applied during the body check
   * when the character is wounded by this strike.
   */
  readonly strikeBodyPenalty?: number;
  /**
   * Whether a resource that requires a skill (e.g. a warrior-only
   * Risky Blow) has already been played during this strike's Step 5.
   * CoE rule 3.iv.5: only one such resource may be played per strike.
   */
  readonly requiredSkillEventPlayed?: boolean;
  /**
   * CvCC only: the attacking character whose strike is paired with this
   * defending character. Set during the attacker-phase assignment.
   * Absent for creature combat (no paired attacker per strike).
   */
  readonly attackingCharacterId?: CardInstanceId;
  /**
   * CvCC only: the outcome for the attacking character after this strike
   * was resolved (dual-roll). The defending character result is stored
   * in the regular `result` field.
   */
  readonly attackerResult?: 'success' | 'wounded' | 'eliminated';
  /**
   * CvCC only: whether the attacking character chose to stay untapped (-3
   * prowess penalty). When `undefined`, the attacker has not yet made their
   * choice for this strike's sub-step 1. Used to gate the two-step
   * resolve-strike sub-phase: attacker declares first, then defender resolves.
   */
  readonly attackerTapToFight?: boolean;
  /**
   * When set, this strike was assigned to its facing character via a
   * `face-strike-on-tap` item (e.g. Bow of Alatar wh-90). If the character
   * defeats (parries) the strike — the strike fails to wound him — the attack's
   * body ({@link CombatState.creatureBody}) is reduced by this amount for the
   * rest of the combat. Absent for ordinary strike assignments.
   */
  readonly reduceAttackBodyOnParry?: number;
}

/**
 * The combat sub-state machine, stored as a top-level field on GameState.
 *
 * Combat is a self-contained sub-system that can be triggered from multiple
 * game phases (creature hazards during Movement/Hazard, automatic attacks
 * during Site phase, on-guard creatures, agent attacks, etc.). When combat
 * is active, it takes priority over the enclosing phase — combat actions
 * (assign-strike, resolve-strike, support-strike) must be resolved before
 * the phase can continue.
 *
 * Combat proceeds through three sub-phases:
 * 1. `'assign-strikes'` -- The defending player assigns each strike to a character.
 * 2. `'resolve-strike'` -- Each strike is resolved one at a time (2d6 + prowess vs creature prowess).
 * 3. `'body-check'` -- For successful strikes, a body check determines if the character is wounded or eliminated.
 */
export interface CombatState {
  /** What initiated this combat (creature card or automatic site attack). */
  readonly attackSource: AttackSource;
  /** The company being attacked. */
  readonly companyId: CompanyId;
  /** The player who owns the defending company (resource player). */
  readonly defendingPlayerId: PlayerId;
  /** The player who initiated the attack (hazard player). */
  readonly attackingPlayerId: PlayerId;
  /** Total number of strikes the creature/attack delivers. */
  readonly strikesTotal: number;
  /** The prowess value of each strike (from the creature's stats or automatic attack). */
  readonly strikeProwess: number;
  /** The creature's body value for body checks. Null if no body check applies. */
  readonly creatureBody: number | null;
  /** The lowercase singular race of the attacking creature (e.g. "orc", "wolf"). Used to evaluate combat-conditional weapon effects like Glamdring's "max 9 against Orcs". */
  readonly creatureRace?: string;
  /**
   * The region types this attack is keyed to, flattened from the creature's
   * `keyedTo` restrictions. Used to evaluate cancel-attack conditions like
   * Stinker's "keyed to Wilderness or Shadow-land". Only populated for
   * creature hazards; automatic attacks leave this empty.
   */
  readonly attackKeying?: readonly RegionType[];
  /**
   * The site types this attack is keyed to, flattened from the creature's
   * `keyedTo` entries. Used by the `no-attack-site-keyed` play-flag to
   * determine whether an ally is immune to a given creature attack.
   * Only populated for creature hazards; automatic attacks leave this absent
   * (since automatic attacks are always "at the site" and the immunity applies
   * unconditionally for that case).
   */
  readonly attackSiteKeyingTypes?: readonly SiteType[];
  /**
   * The specific *region names* this attack is keyed to, flattened from the
   * creature's `keyedTo` entries (e.g. a creature keyed by name to "Fangorn").
   * Used to evaluate cancel-attack conditions like Beasts of the Wood wh-38's
   * "an attack keyed by name to one of the regions listed above". Only
   * populated for creature hazards; automatic attacks leave this absent.
   */
  readonly attackKeyingRegionNames?: readonly string[];
  /** The assignment of each strike to a defending character, with resolution status. */
  readonly strikeAssignments: readonly StrikeAssignment[];
  /** Index into strikeAssignments for the strike currently being resolved. */
  readonly currentStrikeIndex: number;
  /**
   * Which sub-phase of combat resolution is active.
   * - `'assign-strikes'`: players assign strikes to characters
   * - `'choose-strike-order'`: defender picks which unresolved strike resolves next
   * - `'resolve-strike'`: the chosen strike is resolved (tap/untap, support, dice roll)
   * - `'body-check'`: body check after a strike result
   * - `'discard-item-from-company'`: defender must discard one item (An Article Missing)
   */
  /**
   * The current sub-phase of combat:
   * - `'assign-strikes'`: defenders assign strikes to characters
   * - `'choose-strike-order'`: defender picks which strike resolves next
   * - `'resolve-strike'`: the chosen strike is resolved
   * - `'body-check'`: body check after a strike result
   * - `'item-salvage'`: item transfer from an eliminated character
   * - `'discard-item-from-company'`: defender must discard one item
   * - `'trophy-offer'`: Orc/Troll characters may take the defeated creature as a trophy (MELE §8.37)
   */
  readonly phase: 'assign-strikes' | 'choose-strike-order' | 'resolve-strike' | 'body-check' | 'item-salvage' | 'discard-item-from-company' | 'trophy-offer' | 'shield-discard-roll';
  /**
   * During assign-strikes, tracks who is currently assigning:
   * - `'cancel-window'`: defender's pre-assignment window to cancel the attack
   *   (used when the attacker would otherwise assign first, e.g. attacker-chooses-defenders)
   * - `'defender'`: defending player assigns strikes to untapped characters
   * - `'attacker'`: attacking player assigns remaining strikes
   * - `'done'`: all strikes assigned, ready to resolve
   */
  /**
   * During assign-strikes, tracks who is currently assigning:
   * - `'cancel-window'`: defender's pre-assignment window to cancel the attack
   *   (used when the attacker would otherwise assign first, e.g. attacker-chooses-defenders)
   * - `'defender'`: defending player assigns strikes to untapped characters
   * - `'attacker'`: attacking player assigns remaining strikes (creature combat) or
   *   assigns their untapped characters to target defenders (CvCC)
   * - `'defender-any'`: CvCC only — defender assigns remaining unpaired attackers
   *   to any of their characters (including tapped/wounded)
   * - `'done'`: all strikes assigned, ready to resolve
   */
  readonly assignmentPhase: 'cancel-window' | 'defender' | 'attacker' | 'defender-any' | 'cancel-by-tap' | 'done';
  /**
   * During body-check phase, indicates what the body check is against:
   * - `'character'`: check if a wounded character is eliminated
   * - `'creature'`: check if a successful strike defeats the creature
   */
  /**
   * During body-check phase, indicates what the body check is against:
   * - `'character'`: check if a wounded defending character is eliminated
   * - `'creature'`: check if a successful strike defeats the creature
   * - `'attacker-character'`: CvCC only — check if a wounded attacking character is eliminated
   *   (the defending player rolls because they won the strike)
   */
  readonly bodyCheckTarget: 'character' | 'creature' | 'attacker-character' | null;
  /**
   * During 'shield-discard-roll' phase: the instance ID of the item that
   * absorbed the wound (e.g. Sable Shield). The attacking player rolls 2d6;
   * if the result strictly exceeds the item's rollThreshold, the item is
   * discarded. Absent in all other phases.
   */
  readonly shieldAbsorbItemId?: CardInstanceId;
  /**
   * Whether this is a detainment attack. Detainment attacks tap characters
   * instead of wounding/eliminating them. Any attack can be detainment —
   * it is an attribute of the attack, not a separate attack type.
   */
  readonly detainment: boolean;
  /**
   * Set once the attacking player has applied an `attacker-attack-option`
   * (e.g. Ungoliant's Progeny ba-27's "+1 prowess and detainment" for a Spider
   * attack). Prevents the one-shot per-attack option from being applied twice
   * and hides the offer once used. Absent means the option is still available
   * (or the carrying card is not in play).
   */
  readonly attackerAttackOptionApplied?: boolean;
  /**
   * When true, this is a Company vs Company Combat (CvCC) encounter.
   * Absent or false means standard creature combat. When true:
   * - Each strike is backed by a specific attacking character (no excess-strike overflow)
   * - Both attacker and defender roll 2d6 + prowess and compare totals
   * - The loser is wounded; ties tap both sides
   * - Strike assignment follows the 3-phase CvCC order: defender-untapped → attacker-untapped → defender-any
   */
  readonly isCvCC?: boolean;
  /**
   * CvCC only: pool of unallocated excess strikes (attacking characters beyond
   * one per defending character). Per rule 3.V.ii, the attacking player may
   * allocate any of these as temporary -1 modifications to the defending
   * character's prowess during Step 2 of each strike sequence.
   * Set when assignment ends; decremented by `allocate-cvcc-excess` actions.
   */
  readonly cvccExcessPool?: number;
  /**
   * When true, all strikes must be assigned to the same character.
   * Set by the `multi-attack` combat rule (e.g. Assassin).
   */
  readonly forceSingleTarget?: boolean;
  /**
   * Number of separate attacks in a multi-attack creature (e.g. Assassin = 3).
   * When present, `strikesTotal` equals `multiAttackCount × strikesPerAttack`.
   * Used by the UI to display "3 attacks of 1 strike" instead of "3 strikes".
   */
  readonly multiAttackCount?: number;
  /**
   * Number of strikes per individual attack when `multiAttackCount > 1`.
   * Each cancel-by-tap removes this many strike assignments (one full attack).
   * For single-attack creatures this is absent and one assignment is removed.
   * Example: Nameless Thing — 3 attacks × 2 strikes → strikesPerAttack = 2.
   */
  readonly strikesPerAttack?: number;
  /**
   * Number of remaining cancel-by-tap opportunities the defender has.
   * Each tap cancels one attack (= `strikesPerAttack` assignments, defaulting to 1).
   * Set by the `cancel-attack-by-tap` combat rule.
   */
  readonly cancelByTapRemaining?: number;
  /**
   * When true, the target character (the one assigned the strike) may also tap
   * to cancel an attack. Derived from `allowTargetToCancel` on the creature's
   * `combat-cancel-attack-by-tap` effect (e.g. Slayer: "any one character").
   * Defaults to false (Assassin restriction: "not the defending character").
   */
  readonly cancelByTapAllowTarget?: boolean;
  /**
   * When true, the `cancel-by-tap` sub-phase uses the "cancel a strike against
   * a wounded character" variant (Carrion Feeders ba-11, `combat-tap-to-cancel-
   * strike`): the defender taps an untapped company character to remove one
   * pre-assigned strike, choosing which wounded character to protect. The
   * `cancel-by-tap` action carries `strikeCharacterId` (the wounded character
   * whose strike is canceled) instead of popping the last assignment.
   */
  readonly cancelStrikeAgainstWounded?: boolean;
  /**
   * Items available for salvage transfer from an eliminated character.
   * Only set during the 'item-salvage' phase (CoE rule 3.I.2).
   */
  readonly salvageItems?: readonly ItemInPlay[];
  /**
   * Unwounded characters in the same company eligible to receive a salvaged item.
   * Shrinks as items are transferred (one item per recipient).
   */
  readonly salvageRecipients?: readonly CardInstanceId[];
  /**
   * Items available for the defender to choose from during the
   * 'discard-item-from-company' phase (An Article Missing, dm-43).
   * Collected from all characters in the defending company when a
   * successful agent strike with `strikeEffect: 'discard-item'` resolves.
   */
  readonly discardItemOptions?: readonly ItemInPlay[];
  /**
   * Eligible Orc or Troll (non-half-orc) characters that faced a strike during
   * this combat and may take the defeated creature as a trophy (MELE §8.37).
   * Set when transitioning to the `'trophy-offer'` phase. The creature instance
   * is the combat's creatureInstanceId.
   */
  readonly trophyEligibleCharacters?: readonly CardInstanceId[];
  /**
   * CoE rule 3.iv.1 — Strike Sequence, Step 1 (Attacking Player Actions).
   * While the attacker has any playable combat hazards (e.g. Dragon's Curse)
   * this flag is false, giving the attacker an exclusive priority window to
   * declare them before the defender may resolve the strike. Flipped to true
   * when the attacker passes. Reset to false on entry to each new strike
   * sequence (nextStrikePhase / choose-strike-order → resolve-strike).
   */
  readonly attackerStep1Done?: boolean;
  /**
   * Rule 3.iv.6.1 — Agent Strike Roll.
   * For agent hazard attacks, the attacking player rolls 2d6 and adds the
   * agent's modified prowess before the defender rolls. This field holds
   * the agent's total (2d6 + modified prowess) for the current strike
   * sequence, which becomes the effective prowess the defender must beat.
   * Absent until the attacker takes the `agent-strike-roll` action.
   * Reset to undefined on each new strike sequence.
   */
  readonly agentRollTotal?: number;
  /**
   * Pending haven-join offers raised when the attack began (fired by
   * `on-event: creature-attack-begins` + `apply: offer-char-join-attack`,
   * e.g. Alatar). Each offer lets a specific character in a haven company
   * opt into the attacked company during the cancel-window. Consumed when
   * the player accepts (producing a {@link HavenJumpOrigin} + post-attack
   * effects) or when the attack transitions out of cancel-window.
   */
  readonly havenJumpOffers?: readonly HavenJumpOffer[];
  /**
   * Character instance IDs that MUST each receive a strike before any
   * other defender/attacker assignment is legal. Populated when a
   * haven-join-attack is accepted with `forceStrike: true`. The
   * strike-assignment filter restricts defender assignment to these
   * targets while the list is non-empty.
   */
  readonly forcedStrikeTargets?: readonly CardInstanceId[];
  /**
   * Side-effects to apply to a specific character when combat finalizes,
   * regardless of outcome. Enqueued by accepted haven-join offers
   * (e.g. Alatar's "must tap + corruption check following the attack").
   */
  readonly postAttackEffects?: readonly PostAttackEffect[];
  /**
   * Records where a haven-jumped character came from so they can be
   * returned to their original company after combat finalizes. A
   * character may only appear once.
   */
  readonly havenJumpOrigins?: readonly HavenJumpOrigin[];
  /**
   * True when the creature carries `combat-attacker-chooses-defenders`
   * (e.g. Cave-drake). Determines the post-cancel-window transition:
   * attacker-chooses → `'attacker'` assignment; otherwise → `'defender'`
   * (used when cancel-window was opened solely for a haven-jump offer).
   */
  readonly attackerChoosesDefenders?: boolean;
  /**
   * When true, this attack cannot be canceled by any card effect
   * (`cancel-attack` actions are suppressed for the defending player).
   * Set for attacks isolated by *Forewarned Is Forearmed*.
   */
  readonly uncancelable?: boolean;
  /**
   * Amount added to every character body-check roll this attack produces
   * (positive = more likely to wound/eliminate). Set by the `company-strike`
   * DSL effect (Cruel Caradhras td-9: "Any resulting body check is modified by
   * +1"). Applied on top of the wounded +1 in `handleBodyCheckRoll`.
   */
  readonly bodyCheckModifier?: number;
  /**
   * When true, any character (or ally) this attack wounds is immediately
   * eliminated instead of merely wounded — no body check is rolled.
   * Set by the `wound-eliminates` auto-attack combat rule (e.g. the Spider
   * at *Shelob's Lair* le-402: "any character wounded is immediately
   * eliminated"). Detainment strikes tap rather than wound, so they never
   * trigger this.
   */
  readonly woundEliminates?: boolean;
  /**
   * When true, weapons do not modify the target's prowess against this attack's
   * strikes (the printed "weapons do not modify prowess against these strikes"
   * clause, e.g. Trap, Lava Flows dm-152, Rock Fall dm-156). Set by the
   * `weapons-ineffective` automatic-attack combat rule and exposed as
   * `attack.weaponsIneffective` in the `modify-attack` `when` context, so an
   * item like Dwarven Light-stone (dm-168) can gate its tap-to-lower-prowess
   * ability on "one attack for which weapons do not modify the target's
   * prowess".
   */
  readonly weaponsIneffective?: boolean;
  /**
   * When true, this attack was reduced from multiple attacks by
   * *Forewarned Is Forearmed*. Exposed as `attack.isolated` in the
   * `attack-defeated` condition context so the card can self-discard
   * only when one of these isolated attacks is defeated.
   */
  readonly isolated?: boolean;
  /**
   * Special strike resolution override set by tap-agent-at-site hazard
   * short-events (e.g. An Article Missing dm-43).
   *
   * `'discard-item'`: a successful strike does not wound the defending
   * character; instead the defending company must discard one item of
   * their choice (defender picks).
   */
  readonly strikeEffect?: 'discard-item';
  /**
   * When true, avatar characters (Wizards and Ringwraiths, mind === null) are
   * excluded from strike assignment. Set by `combat-one-strike-per-character`
   * with `excludeAvatars: true` (e.g. Neeker-breekers).
   */
  readonly excludeAvatarStrikes?: boolean;
  /**
   * When true, each defending character's prowess for this attack is replaced
   * by their mind attribute value (e.g. Neeker-breekers). Status modifiers
   * (tapped, wounded) and support bonuses still apply on top of the mind base.
   */
  readonly defenderProwessFromMind?: boolean;
  /**
   * When true, after each strike resolves every facing character whose mind
   * attribute is ≤ the attack's strike prowess must tap if still untapped
   * (e.g. Wisp of Pale Sheen). Set by `combat-tap-low-mind`. Avatars
   * (mind === null) and wounded (inverted) characters are unaffected.
   */
  readonly tapLowMindAfterStrike?: boolean;
  /**
   * Character instance IDs protected from strike assignment by a
   * `protect-from-strike-assignment` effect (e.g. Ruse mode B).
   * Characters in this set cannot be assigned any strike from the current
   * attack. The protection expires naturally when combat ends.
   */
  readonly protectedFromStrikeAssignment?: readonly CardInstanceId[];
  /**
   * When true, this attack uses the "each character faces one strike" rule
   * (CoE §3.I.1): every character in the defending company is automatically
   * assigned exactly one strike, with no player choice. After the cancel
   * window, the engine pre-assigns one strike per character and advances
   * directly to the resolve-strike phase.
   *
   * Used by sites like Mount Gundabad (le-395) whose auto-attack text reads
   * "each character faces 1 strike with N prowess".
   */
  readonly eachCharacterFacesOneStrike?: boolean;
  /**
   * Set on a Troll-purse (dm-95) re-faced automatic-attack: a successful
   * strike does not wound the character but takes them prisoner at the bound
   * site instead. Carries the Troll-purse host card instance and the site
   * instance the prisoner is held at (the rescue site).
   *
   * Used by Troll-purse (dm-95): "Any successful strike does not harm the
   * character, but rather the character is taken prisoner at the site."
   */
  readonly trollPursePrisoner?: {
    readonly hostInstanceId: CardInstanceId;
    readonly siteInstanceId: CardInstanceId;
  };
  /**
   * Records an active "cancel protection" buff on this attack, set by a
   * from-hand `modify-attack` effect with `firstCancelRemovesEffect: true`
   * (Unabated in Malice ba-26). Holds the modifiers this card applied so
   * the *first* cancellation attempt can reverse them instead of cancelling
   * the attack. Cleared once that first attempt spends the protection; a
   * later cancellation then ends the attack normally. Absent when no such
   * buff is active (the common case). Only one may exist per attack (the
   * card's `duplication-limit` scope `attack` enforces this).
   */
  readonly cancelProtection?: {
    /** Instance of the modify-attack card that granted the protection. */
    readonly sourceInstanceId: CardInstanceId;
    /** Strike-count modifier applied (reversed on redirect). */
    readonly strikesModifier: number;
    /** Strike-prowess modifier applied (reversed on redirect). */
    readonly prowessModifier: number;
    /** Creature-body modifier applied (reversed on redirect). */
    readonly bodyModifier: number;
  };
}

/**
 * One pending "may join the attacked company" offer raised by
 * `on-event: creature-attack-begins` + `apply: offer-char-join-attack`.
 * The bearer's controller may accept via the `haven-join-attack` action
 * during the cancel-window. Composable fields let future cards reuse
 * this primitive without adding a new apply type per card.
 */
export interface HavenJumpOffer {
  /** The character who may jump into the attacked company (the bearer). */
  readonly characterId: CardInstanceId;
  /** The player who controls the bearer (must also own the attacked company). */
  readonly bearerPlayerId: PlayerId;
  /** The bearer's origin company (the haven company). Used to restore them after combat. */
  readonly originCompanyId: CompanyId;
  /** The company under attack — the destination of the jump. */
  readonly targetCompanyId: CompanyId;
  /** When true, allies attached to the bearer are discarded on accept. */
  readonly discardOwnedAllies: boolean;
  /** When true, accepting forces the attacking creature to strike the bearer. */
  readonly forceStrike: boolean;
  /** Effects to apply to the bearer at combat finalization (regardless of outcome). */
  readonly postAttackEffects: readonly PostAttackEffect[];
}

/**
 * An effect scheduled to run at {@link CombatState} finalization,
 * targeting a specific character regardless of the attack's outcome.
 * Enqueued by accepted haven-join offers and similar "following the
 * attack, do X" primitives.
 */
export interface PostAttackEffect {
  /** The character instance the effect targets. */
  readonly targetCharacterId: CardInstanceId;
  /** When true, tap the character if they are still untapped after combat. */
  readonly tapIfUntapped?: boolean;
  /** When present, enqueue a corruption check on the character (optional modifier). */
  readonly corruptionCheck?: { readonly modifier?: number };
  /**
   * Left Behind (td-41): when true, at combat finalization the character is
   * peeled off into a separate `leftBehind` company with the same site path as
   * the company he was in (see `applyPostAttackEffects`). That company then
   * faces its own movement/hazard phase with a hazard limit of one, after which
   * the character may rejoin his original company.
   */
  readonly leftBehindSplit?: boolean;
}

/** Records where a haven-jumped character came from so they can be restored. */
export interface HavenJumpOrigin {
  /** The character who jumped. */
  readonly characterId: CardInstanceId;
  /** The company they were originally in (haven company). */
  readonly originCompanyId: CompanyId;
}

// ---- Chain of Effects sub-state ----

/**
 * Discriminated union of chain entry payloads.
 *
 * Each variant corresponds to a kind of action that can appear on the
 * chain of effects. The `type` field identifies the variant so that the
 * resolver knows how to apply the entry when it resolves.
 */
export type ChainEntryPayload =
  | {
      readonly type: 'short-event';
      readonly targetInstanceId?: CardInstanceId;
      /**
       * For a counter-cancel-roll short-event (Black Vapour ba-14), the chain
       * entry (a cancel-attack) this card is countering. Distinct from
       * {@link targetInstanceId} because that field triggers the Twilight-style
       * environment-cancel path; this one is read only by the
       * counter-cancel-attack-roll resolution branch, which enqueues a roll.
       */
      readonly counterCancelTargetInstanceId?: CardInstanceId;
      readonly targetCharacterId?: CardInstanceId;
      readonly targetFactionInstanceId?: CardInstanceId;
      /** For Stay Her Appetite (le-140): the ally being targeted. */
      readonly targetAllyId?: CardInstanceId;
      /**
       * For site-targeting short-events (e.g. Greed le-113): the site
       * definition ID the event is bound to. On resolution the event
       * installs its turn-scoped `item-play-corruption-check` constraint
       * bound to this site so item plays there trigger the checks.
       */
      readonly targetSiteDefinitionId?: import('./common.js').CardDefinitionId;
      /**
       * For hazard short-events with `play-option` effects (e.g. Weariness of
       * the Heart le-149), the id of the option the hazard player chose at
       * play time. The chain resolver dispatches that option's `apply`.
       */
      readonly optionId?: string;
      /**
       * For a `force-opponent-discard` effect with a dynamic `count` (Khamûl the
       * Easterling tw-47), the number of cards the opponent must discard,
       * computed at declaration time (when the permanent-event mode was tapped,
       * while the source card was still in play — so "including this one" is
       * already accounted for). Read by the chain resolver; absent = 1.
       */
      readonly forcedDiscardCount?: number;
    }
  | {
      readonly type: 'creature';
      /**
       * For Summons from Long Sleep (as-39): prowess bonus (+2) applied on
       * top of the creature's resolved prowess when initiating combat.
       */
      readonly prowessBonus?: number;
      /**
       * For Summons from Long Sleep (as-39): the permanent-event instance to
       * discard after this creature's combat resolves.
       */
      readonly reservingCardInstanceId?: CardInstanceId;
    }
  | {
      readonly type: 'permanent-event';
      readonly targetCharacterId?: CardInstanceId;
      /**
       * For site-targeting permanent events (e.g. *River*), the site
       * definition ID this card is bound to. The chain resolver places
       * the card into `cardsInPlay` with `attachedToSite` set to this
       * value, so the engine can match arrival events against the
       * specific site location.
       */
      readonly targetSiteDefinitionId?: import('./common.js').CardDefinitionId;
      /**
       * For company-targeting permanent events (e.g. Fellowship), the company
       * ID this card is bound to. The chain resolver sets `companyId` on the
       * resulting `CardInPlay` entry so `company-modifier` effects are scoped
       * to that company only.
       */
      readonly targetCompanyId?: import('./common.js').CompanyId;
      /**
       * For hazards played on an opponent's stored item (e.g. Neither so
       * Ancient Nor so Potent dm-73), the stored item instance being
       * displaced. On resolution the chain reducer returns the item to its
       * owner's hand and places the resolving card into that owner's
       * marshalling-point pile.
       */
      readonly targetStoredItemInstanceId?: CardInstanceId;
      /**
       * For a hazard permanent-event played on one of the hazard player's own
       * face-down agents (Inner Cunning dm-68, mode 1), the agent's
       * virtual-company id. On resolution the chain reducer places the card
       * into the hazard player's `cardsInPlay` with `attachedToAgentId` set.
       */
      readonly targetAgentId?: import('./common.js').CompanyId;
      /**
       * For a resource permanent-event played on one of the active player's own
       * items (Barrow-blade dm-119, "play this with the Dagger"), the target
       * item instance. On resolution the chain reducer places the card into the
       * controller's `cardsInPlay` with `attachedToItem` set to this value.
       */
      readonly targetItemInstanceId?: CardInstanceId;
    }
  | { readonly type: 'long-event' }
  | { readonly type: 'corruption-card' }
  | { readonly type: 'passive-condition'; readonly trigger: string }
  | { readonly type: 'activated-ability' }
  | { readonly type: 'on-guard-reveal' }
  | { readonly type: 'body-check' }
  | {
      readonly type: 'influence-attempt';
      readonly influencingCharacterId: CardInstanceId;
      /**
       * When true, the influencing Orc/Troll leader takes the faction under
       * its control on success (LE "Orcs of Udûn"-style factions), leaving the
       * influence site untapped. Threaded from the declared action's
       * `placeUnderLeaderControl` flag. See {@link LeaderControlEffect}.
       */
      readonly placeUnderLeaderControl?: boolean;
    };

/**
 * A single entry on the chain of effects stack.
 *
 * Entries are pushed in declaration order and resolved in LIFO order
 * (last declared resolves first). Each entry tracks its declaring player,
 * the card involved, and a payload describing the kind of action.
 */
export interface ChainEntry {
  /** Sequential position on the chain (0 = first declared). */
  readonly index: number;
  /** The player who declared this entry. */
  readonly declaredBy: PlayerId;
  /** The card being played, physically held by the chain until resolution. Null for non-card actions (e.g. passive conditions). */
  readonly card: CardInstance | null;
  /** What kind of action this entry represents, with variant-specific data. */
  readonly payload: ChainEntryPayload;
  /** Whether this entry has been resolved. */
  readonly resolved: boolean;
  /** Whether this entry was negated before it could resolve (e.g. target became invalid). */
  readonly negated: boolean;
}

/**
 * A passive condition triggered during chain resolution, queued for a follow-up chain.
 *
 * When a card's passive condition fires during resolution of the current chain,
 * it cannot be added to the active chain. Instead it is deferred and declared
 * in a new chain after the current one completes.
 */
export interface DeferredPassive {
  /** The card whose passive condition was triggered. */
  readonly sourceCardId: CardInstanceId;
  /** Human-readable description of the trigger condition. */
  readonly trigger: string;
  /** The payload to declare in the follow-up chain. */
  readonly payload: ChainEntryPayload;
}

/**
 * Restriction on what can be declared in a chain.
 *
 * Most chains are unrestricted (`'normal'`), but certain game situations
 * create chains where only specific kinds of actions are allowed:
 * - `'body-check'` — only actions that affect the body check
 * - `'end-of-phase'` — only "at the end of" triggered abilities
 * - `'beginning-of-phase'` — only "at the beginning of" triggered abilities
 */
export type ChainRestriction = 'normal' | 'body-check' | 'end-of-phase' | 'beginning-of-phase';

/**
 * The chain of effects sub-state machine, stored as a top-level field on GameState.
 *
 * The chain layers on top of the current phase — when `state.chain` is non-null,
 * legal action computation delegates to chain logic instead of the phase handler.
 * The underlying phase (M/H, Site, etc.) stays intact.
 *
 * The chain has two modes:
 * - `'declaring'` — players alternate declaring actions (pushing entries onto the stack)
 * - `'resolving'` — entries are resolved in LIFO order (last declared resolves first)
 *
 * Priority alternates between players during declaration. When both players pass
 * consecutively, the chain transitions from declaring to resolving.
 */
export interface ChainState {
  /** Whether players are still declaring actions or the chain is resolving. */
  readonly mode: 'declaring' | 'resolving';
  /** LIFO stack of declared entries. Index 0 = first declared, last = top of stack. */
  readonly entries: readonly ChainEntry[];
  /** The player who currently has priority to declare or pass. */
  readonly priority: PlayerId;
  /** Whether the priority player has passed (waiting for opponent's response). */
  readonly priorityPlayerPassed: boolean;
  /** Whether the non-priority player has passed. */
  readonly nonPriorityPlayerPassed: boolean;
  /** Passive conditions triggered during resolution, queued for a follow-up chain. */
  readonly deferredPassives: readonly DeferredPassive[];
  /** Saved parent chain state for nested chains (on-guard interrupts, body checks). */
  readonly parentChain: ChainState | null;
  /** What kinds of actions are allowed in this chain. */
  readonly restriction: ChainRestriction;
}

// ---- Pending effects ----

/**
 * A queued game effect waiting to be resolved.
 *
 * Some actions trigger effects that require additional input or sequencing
 * (e.g. a resource short event with a fetch-to-deck effect). Pending effects
 * are processed in order before the game continues; when the queue is non-empty,
 * only effect-resolution actions are legal.
 */
export type PendingEffect = CardEffectPendingEffect;

/**
 * A DSL card effect awaiting player interaction (e.g. fetch-to-deck).
 * The source card is in the player's cardsInPlay while this resolves.
 */
export interface CardEffectPendingEffect {
  readonly type: 'card-effect';
  /** Instance ID of the card in cardsInPlay that triggered this effect. */
  readonly cardInstanceId: CardInstanceId;
  /** The DSL effect being resolved (carries all parameters). */
  readonly effect: CardEffect;
  /**
   * The player who must resolve this effect. When absent, defaults to
   * {@link GameState.activePlayer} (backward-compatible with resource events).
   * Required for hazard events where the resolving player is the non-active player.
   */
  readonly actor?: PlayerId;
  /**
   * For effects triggered by a play-target with tap cost (e.g. Marvels Told),
   * the character instance that was tapped to play the card. Used to enqueue
   * post-effect corruption checks on the correct character.
   */
  readonly targetCharacterId?: CardInstanceId;
  /**
   * When true, the source card is NOT discarded after the effect resolves.
   * Used by grant-action fetch effects where the source is an item that
   * stays in play (tapped) rather than an event that gets discarded.
   */
  readonly skipDiscard?: boolean;
  /**
   * When set, a corruption check is enqueued on this character after
   * the effect completes. Used by Palantír grant-actions.
   */
  readonly postCorruptionCheck?: {
    readonly characterId: CardInstanceId;
    readonly modifier: number;
  };
}
