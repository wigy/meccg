/**
 * @module pending
 *
 * Pending resolutions and active constraints — the unified replacement
 * for the per-phase ad-hoc `pending*` fields scattered across the engine.
 *
 * Two distinct shapes share this module:
 *
 *  - **Shape A — {@link PendingResolution}.** Discrete pieces of work the
 *    engine has queued for a specific actor. While any resolution is
 *    pending for the active actor, legal actions collapse to "resolve the
 *    top item." Examples: corruption checks (transfer / wound / Lure),
 *    order-effects step in M/H, on-guard reveal window, opponent-influence
 *    defensive roll.
 *
 *  - **Shape B — {@link ActiveConstraint}.** Scoped restrictions on the
 *    legal-action menu of some target (company / character / player).
 *    They never block resolution; they filter the available actions
 *    while they live and auto-clear at a boundary. Examples: River and
 *    Lost in Free-domains (company may do nothing during its site phase),
 *    Stealth (no creature hazards on this company this turn).
 *
 * Both lists live at the **top** of `GameState` and are owned by the
 * helper module `engine/pending.ts`. Phase state must not contain any
 * `pending*` field; everything cross-cutting routes through this module.
 */

import type { CardInstanceId, CompanyId, PlayerId, CardDefinitionId } from './common.js';
import type { GameAction } from './actions.js';
import type { Phase } from './state-phases.js';
import type { ActionCost, Condition, TriggeredAction } from './effects.js';

// ---- Branded IDs ----

/** Unique ID minted for every pending resolution. */
export type ResolutionId = string & { readonly __brand: 'ResolutionId' };

/** Unique ID minted for every active constraint. */
export type ConstraintId = string & { readonly __brand: 'ConstraintId' };

/**
 * A modifier term summed into a {@link PendingResolution} `dice-check`'s 2d6
 * total at roll time (dynamic terms must be re-read at resolve, not snapshotted
 * at enqueue). `constant` covers pre-resolved values (printed mind, card roll
 * bonuses); `unused-gi` is a player's unused general influence.
 */
export type DiceCheckModifier =
  | { readonly kind: 'constant'; readonly value: number }
  | { readonly kind: 'unused-gi'; readonly player: PlayerId };

/**
 * What a `dice-check` resolver does AFTER running onPass/onFail and dequeuing.
 * The chain re-entry is generic scaffold owned by the resolver, never a
 * per-result TriggeredAction verb. `dequeue-only` just removes the resolution;
 * `chain-entry` marks the matching chain entry resolved and continues
 * auto-resolution (`drainSameSource` waits until all same-source dice-checks
 * have resolved before continuing — the body-check "all company members" case).
 */
export type DiceCheckContinuation =
  | { readonly kind: 'dequeue-only' }
  | {
      readonly kind: 'chain-entry';
      readonly match: 'target-faction' | 'target-character' | 'source';
      readonly drainSameSource?: boolean;
    };

/**
 * Closed set of attribute paths supported by the
 * `attribute-modifier` active constraint (see {@link ActiveConstraint}).
 * Each path maps to a single read site in the engine that consults
 * active modifiers to compute an effective value:
 *
 *  - `auto-attack.prowess` — one-shot prowess bonus on the next matching
 *    automatic-attack (consumed on use).
 *  - `site.type` — override the effective {@link SiteType} for a specific
 *    site (filter: `site.definitionId`). Consulted by creature keying and
 *    Haven-tests.
 *  - `region.type` — override the effective {@link RegionType} for a named
 *    region (filter: `region.name`). Consulted by creature keying.
 *  - `auto-attack.detainment` — when overridden truthy for a specific site
 *    (filter: `site.definitionId`), every automatic-attack at that site is
 *    resolved as detainment regardless of the defending alignment. Consulted
 *    via {@link siteAutoAttacksForcedDetainment}. Used by Hold Rebuilt and
 *    Repaired (as-88).
 */
export type AttributePath =
  | 'auto-attack.prowess'
  | 'site.type'
  | 'region.type'
  | 'auto-attack.detainment';

// ---- Shape A: Pending resolutions ----

/**
 * Where a {@link PendingResolution} lives. The engine sweeps the queue at
 * boundaries that match each scope, automatically dropping any resolution
 * whose scope has expired.
 */
export type ResolutionScope =
  | { readonly kind: 'phase'; readonly phase: Phase }
  | { readonly kind: 'phase-step'; readonly phase: Phase; readonly step: string }
  | { readonly kind: 'company-mh-subphase'; readonly companyId: CompanyId }
  | { readonly kind: 'company-site-subphase'; readonly companyId: CompanyId };

/**
 * Snapshot of an opponent influence attempt awaiting the defender's roll.
 * Mirrors the old SitePhaseState.pendingOpponentInfluence shape.
 */
export interface OpponentInfluenceAttempt {
  /** The influencing character's instance ID. */
  readonly influencerId: CardInstanceId;
  /** The opponent's targeted card instance ID. */
  readonly targetInstanceId: CardInstanceId;
  /** Whether the target is a character, ally, faction, or item. */
  readonly targetKind: 'character' | 'ally' | 'faction' | 'item';
  /** The target's player ID. */
  readonly targetPlayer: PlayerId;
  /** The attacker's 2d6 roll result. */
  readonly attackerRoll: number;
  /** The influencer's unused direct influence. */
  readonly influencerDI: number;
  /** The opponent's unused general influence. */
  readonly opponentGI: number;
  /** The target's mind value (comparison threshold). */
  readonly targetMind: number;
  /** Unused DI of the character controlling the target (0 if under GI). */
  readonly controllerDI: number;
  /**
   * Cross-alignment penalty applied to the attacker's roll per CoE
   * rules 8.W1, 8.R1, 8.F1, 8.B1 (typically -5 or 0). Subtracted from
   * the attacker's roll during resolution in addition to the other
   * modifiers — i.e. added as a negative term on the attacker side.
   */
  readonly crossAlignmentPenalty: number;
  /**
   * Region-distance penalty subtracted from the attacker's roll, used by
   * Prophet of Doom (wh-106): the inclusive number of regions between the
   * influencer's site and the target's site. 0 (or absent) for a normal
   * same-site attempt.
   */
  readonly regionPenalty?: number;
  /**
   * Sum of one-shot influence `check-modifier` constraint values that matched
   * this opponent-influence attempt (e.g. Mine or No One's ba-68: +10 against
   * an item/ally/Orc-or-Troll faction), added to the attacker's side of the
   * final comparison. 0 (or absent) when no booster was in effect.
   */
  readonly boostModifier?: number;
  /**
   * The card instance revealed from hand for a comparison value of 0.
   * Null if no card was revealed.
   */
  readonly revealedCard: { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId } | null;
}

/**
 * A discrete piece of work the engine has queued for a player.
 *
 * Discriminated by `kind.type`. While any resolution exists for the
 * current actor in the current scope, only resolution actions are legal.
 * Drains FIFO per actor.
 */
export interface PendingResolution {
  /** Globally unique ID. */
  readonly id: ResolutionId;
  /**
   * The card instance whose effect produced this resolution. May be null
   * for engine-generated resolutions (e.g. order-effects step transitions)
   * that are not attributed to a single card.
   */
  readonly source: CardInstanceId | null;
  /** Player who must resolve this entry. */
  readonly actor: PlayerId;
  /** Auto-clear boundary. */
  readonly scope: ResolutionScope;
  /**
   * Scheduling gate: while ANY of these resolution IDs is still queued,
   * this entry is skipped by `topResolutionFor` — the actor cannot see or
   * resolve it yet. Used for cross-player sequencing, e.g. Ren the Unclean
   * (tw-83): "The moving player makes corruption checks first" — the
   * tapping player's checks are blocked by the moving player's check IDs.
   * Entries dropped by scope sweeps also unblock their dependents (the
   * gate tests queue membership, not resolution success).
   */
  readonly blockedBy?: readonly ResolutionId[];
  /** Discriminated payload. */
  readonly kind:
    | {
        readonly type: 'corruption-check';
        readonly characterId: CardInstanceId;
        /** Roll modifier from the producing effect (e.g. Barrow-wight -2). */
        readonly modifier: number;
        /** Human-readable reason shown in UI: "Lure", "Barrow-wight", "Transfer", etc. */
        readonly reason: string;
        /**
         * Possessions to include in the corruption check. The legal-action
         * computer is free to add the character's currently attached items
         * if this list is empty; the field exists for the transfer case
         * where the transferred item must also be counted even though it
         * already moved to the target character.
         */
        readonly possessions: readonly CardInstanceId[];
        /**
         * For transfer corruption checks: the item that was transferred.
         * Its corruption-points must be added to the character's CP for
         * the check, even though the item is already on the target.
         * Null for non-transfer corruption checks.
         */
        readonly transferredItemId: CardInstanceId | null;
        /**
         * Custom failure consequence. When `'discard-ring-only'`, a failed
         * check discards only the bearer's Ring item instead of the character
         * (e.g. The Ring's Betrayal). When `'discard-instead-of-eliminate'`,
         * an outcome that would eliminate the character is downgraded to a
         * discard of the character + his non-follower possessions (e.g. The
         * Roving Eye le-135). Absent for standard checks.
         */
        readonly failureMode?: 'discard-ring-only' | 'discard-instead-of-eliminate';
        /**
         * Follow-up effect run when the check *passes* (CoE 10.39 hook).
         * Used by Cracks of Doom (tw-205): a successful −4 corruption check
         * on the Ring's bearer wins the game. The resolver runs this apply
         * after the pass branch instead of merely dequeuing. Absent for
         * standard checks.
         */
        readonly onSuccess?: TriggeredAction;
        /**
         * When set, and this check *eliminates* a **hero** character, the named
         * player is credited the hero's marshalling points as kill MP (folded
         * into `player.bonusKillMarshallingPoints`). Used by A Malady Without
         * Healing (le-159): "If target character is a hero and is eliminated by
         * these checks, you receive his kill marshalling points."
         */
        readonly awardKillMpTo?: PlayerId;
        /**
         * When true, the actor may resolve this check in any order relative
         * to their OTHER queued corruption checks from the same source card:
         * the legal-action computer offers one roll action per same-source
         * selectable sibling instead of only the head entry. Used by Ren the
         * Unclean (tw-83): "Each player decides the order of the corruption
         * checks for their characters."
         */
        readonly selectableOrder?: boolean;
        /**
         * When true, untapped characters in the checking character's company
         * may tap for +1 each before the roll (`support-corruption-check`),
         * exactly like the Free Council window (CoE 7.1.1) but mid-game.
         * Granted by Ren the Unclean (tw-83): "Your characters may tap in
         * support."
         */
        readonly allowSupport?: boolean;
        /**
         * When true, the actor may NOT play resource cards from hand
         * (reactive short-event plays) to aid this check. Activating a
         * resource already in play is *using*, not *playing*, a resource and
         * stays legal. Ren the Unclean (tw-83): "If you tap Ren the Unclean,
         * then you cannot play resources to aid your character's corruption
         * checks."
         */
        readonly noResourceAid?: boolean;
      }
    | {
        readonly type: 'order-effects';
        readonly effectIds: readonly CardInstanceId[];
      }
    | {
        readonly type: 'on-guard-window';
        /**
         * Stage of the on-guard window flow:
         *  - `'reveal-window'` — actor is the hazard player; they may
         *    reveal one on-guard card or pass. On reveal, the resolution
         *    is replaced by an `awaiting-pass` entry whose actor is the
         *    resource player; on pass, the deferred action runs.
         *  - `'awaiting-pass'` — actor is the resource player; their
         *    only legal action is `pass`, which runs the deferred
         *    action. Used after the hazard player has revealed one
         *    on-guard card and the resulting chain has resolved.
         */
        readonly stage: 'reveal-window' | 'awaiting-pass';
        /** The action that runs when the window closes. */
        readonly deferredAction: GameAction;
      }
    | {
        readonly type: 'opponent-influence-defend';
        readonly attempt: OpponentInfluenceAttempt;
      }
    | {
        /**
         * Faction influence roll: the chain has resolved, all modifiers are
         * known, and the game pauses so the UI can display a situation
         * banner (target number, DI, bonuses/penalties) before the player
         * commits to rolling.
         */
        readonly type: 'faction-influence-roll';
        /** The faction card instance (held by the now-resolved chain entry). */
        readonly factionInstanceId: CardInstanceId;
        readonly factionDefinitionId: CardDefinitionId;
        /** The character making the influence roll. */
        readonly influencingCharacterId: CardInstanceId;
        /**
         * When true, an eligible Orc/Troll leader takes the faction under its
         * control on success (LE "Orcs of Udûn"-style factions), leaving the
         * site untapped. Threaded from the chain entry's payload.
         */
        readonly placeUnderLeaderControl?: boolean;
        /**
         * Positive influence-check modifier from a Dragons "Roused" faction's
         * paid `influence-modification` (Smaug Roused le-285). Threaded from
         * the chain entry's payload; added by the roll resolver.
         */
        readonly bonusModifier?: number;
      }
    | {
        /**
         * Generic dice-check (P08): roll 2d6, sum {@link DiceCheckModifier}s,
         * compare to `threshold` (`gt`/`gte`), then run `onPass`/`onFail`
         * ({@link TriggeredAction}s) via the resolution-context dispatcher.
         * Collapses the former roll-vs-threshold family (muster, glamour,
         * cvcc-ally-discard, call-of-home, body-check). The `continuation`
         * carries the generic chain re-entry; bespoke roll resolutions
         * (gold-ring table, seized-by-terror relocation, stay-her-appetite /
         * flattery / faction-influence interaction windows) stay their own kinds.
         */
        readonly type: 'dice-check';
        /** UI/log banner. */
        readonly label: string;
        /** Who rolls; defaults to the resolution `actor`. */
        readonly roller?: PlayerId;
        /** Terms summed into the 2d6 total at roll time. */
        readonly modifiers: readonly DiceCheckModifier[];
        /** Pre-resolved threshold the modified total is compared against. */
        readonly threshold: number;
        /** Pass condition: `'gt'` (strictly greater) or `'gte'` (≥). */
        readonly comparison: 'gt' | 'gte';
        /** Run when the check passes. */
        readonly onPass?: TriggeredAction;
        /** Run when the check fails. */
        readonly onFail?: TriggeredAction;
        /** Generic post-branch chain scaffold. */
        readonly continuation: DiceCheckContinuation;
        /**
         * When true, skip the roll entirely (no RNG/cheat consumed, no
         * continuation) if the target is absent — the cvcc/call-of-home/
         * body-check pre-roll-skip semantics. Muster omits this (always rolls,
         * no-ops on an already-gone faction).
         */
        readonly requireTargetPresent?: boolean;
        /** Character the onPass/onFail verbs act on (call-of-home, body-check). */
        readonly targetCharacterId?: CardInstanceId;
        /** Instance the onPass/onFail verbs act on (muster faction, glamour hazard, cvcc ally). */
        readonly targetInstanceId?: CardInstanceId;
      }
    | {
        /**
         * Flattery attempt (td-116 Flatter a Foe): a resource short event has
         * resolved against a creature attack. The defending player rolls 2d6;
         * total = roll + unusedDI (+ diplomatBonus if the character is a diplomat).
         * If total > threshold, the attack is cancelled and the hazard limit
         * for the company is decreased by `hazardLimitReduction`.
         */
        readonly type: 'flattery-attempt';
        /** The character making the flattery check. */
        readonly characterInstanceId: CardInstanceId;
        /** Race of the attacking creature. */
        readonly creatureRace: string;
        /** Roll + modifiers must exceed this for success. */
        readonly threshold: number;
        /** Bonus added when the character has the diplomat skill. */
        readonly diplomatBonus: number;
        /** Reduction to the company hazard limit on success. */
        readonly hazardLimitReduction: number;
      }
    | {
        /**
         * Seized by Terror roll: a hazard short event has resolved against a
         * character moving through Shadow-land or Dark-domain. The character's
         * player rolls 2d6 and adds the character's mind. If roll + mind < 12,
         * the character splits off into a new company that returns to the
         * original company's site of origin.
         */
        readonly type: 'seized-by-terror-roll';
        /** The targeted character instance. */
        readonly targetCharacterId: CardInstanceId;
        /** The hazard card that caused this check. */
        readonly hazardDefinitionId: CardDefinitionId;
        /** Roll + mind must meet or exceed this to stay in the moving company. */
        readonly threshold: number;
        /** Instance ID of the site of origin (original company's currentSite). */
        readonly originSiteInstanceId: CardInstanceId;
      }
    | {
        /**
         * Company tap rolls (Heedless Revelry le-114): a hazard short event
         * with a `company-tap-roll` effect has resolved on the active
         * company. The company's controller rolls 2d6 for each qualifying
         * character in turn (`remaining[0]` first); if roll + modifier is
         * strictly greater than the character's effective mind, the
         * character becomes tapped. The resolution stays queued (with the
         * rolled character removed from `remaining`) until every character
         * has rolled, then the source chain entry resolves.
         */
        readonly type: 'company-tap-roll';
        /** The hazard card that caused these rolls. */
        readonly hazardDefinitionId: CardDefinitionId;
        /** Characters still to roll, each with its precomputed roll modifier. */
        readonly remaining: readonly {
          readonly characterId: CardInstanceId;
          readonly modifier: number;
        }[];
      }
    | {
        /**
         * Gold-ring test (Rule 9.21): a gold-ring item must be tested. The
         * ring's owner rolls 2d6 (plus any modifiers). The ring is discarded
         * regardless. After the roll, a `ring-play-offer` resolution is
         * enqueued so the player may immediately play a matching special ring.
         */
        readonly type: 'gold-ring-test';
        /** The gold-ring item instance being tested. */
        readonly goldRingInstanceId: CardInstanceId;
        /** Roll modifier from the producing effect (e.g. Darkhaven -2). */
        readonly rollModifier: number;
        /** Character who bore the gold ring — receives the replacement ring. */
        readonly characterInstanceId: CardInstanceId;
      }
    | {
        /**
         * Ring-play offer (Rule 9.21): enqueued after a gold-ring test roll.
         * The player may play one special ring card from their hand whose
         * category keyword matches an entry in `eligibleCategories`, replacing
         * the (already-discarded) gold ring on the same character.
         *
         * The player may also pass (generic `pass` action) if they do not
         * wish to play any ring.
         */
        readonly type: 'ring-play-offer';
        /** Character who bore the gold ring — receives the replacement ring. */
        readonly characterInstanceId: CardInstanceId;
        /** Ring categories eligible according to the test table and roll total. */
        readonly eligibleCategories: readonly import('../types/effects.js').RingCategory[];
        /** Roll total (for log display). */
        readonly rollTotal: number;
        /** If true, the ring enters play stored rather than attached (Rule 9.22 Darkhaven path). */
        readonly storedPlacement: boolean;
        /**
         * Categories for which the player may search play deck and discard pile
         * (from a `ring-test-search` effect on the tested gold ring, e.g. Gleaming
         * Gold Ring can search for a Lesser Ring regardless of roll).
         */
        readonly searchCategories?: readonly import('../types/effects.js').RingCategory[];
      }
    | {
        /**
         * The Windlord Found Me (dm-164): when stored at a Haven, if the
         * resource player's Wizard is not already in play, they may search
         * their play deck or discard pile for a Wizard and play him at that
         * Haven. This does not count toward the one-character-per-turn limit.
         */
        readonly type: 'wizard-search-on-store';
        /** The haven site instance ID where the wizard will be played. */
        readonly havenSiteInstanceId: CardInstanceId;
        /** The company at that haven (wizard joins this company). */
        readonly companyId: CompanyId;
      }
    | {
        /**
         * Post-attack bearer selection for cards with `trigger-attack-on-play`
         * (e.g. Rescue Prisoners, The Windlord Found Me).
         *
         * After the triggered attack resolves or is cancelled, if at least one
         * character in the company remains untapped, the resource player must
         * choose which untapped character taps to take the card. If they
         * decline (or no untapped characters remain), the card is discarded.
         *
         * Resolved by a `select-card-bearer` action carrying the chosen
         * `characterId`, or a `pass` to decline and discard the card.
         */
        readonly type: 'select-card-bearer';
        /** The permanent-event card instance awaiting bearer assignment. */
        readonly cardInstanceId: CardInstanceId;
        /** The company whose characters are eligible to be the bearer. */
        readonly companyId: CompanyId;
        /**
         * Post-selection mode (from `TriggerAttackOnPlayEffect.afterAttack`).
         * - `"attach-with-constraint"` (default / absent): attach card to
         *   bearer's items and add `bearer-cannot-untap` constraint.
         * - `"move-to-mp-pile"`: tap the chosen character, leave card in
         *   `cardsInPlay` without attaching or adding a constraint.
         */
        readonly mode?: 'attach-with-constraint' | 'move-to-mp-pile';
        /**
         * When true, after bearer selection discard any faction cards in
         * play belonging to the resource player that are playable at the
         * company's current site.
         */
        readonly discardFactionsAtSite?: boolean;
        /**
         * When true, after bearer selection (move-to-mp-pile keep) return
         * every unique faction in play — belonging to either player — that is
         * playable at the company's current site to its owner's hand
         * (Tempest of Fire ba-77).
         */
        readonly returnFactionsAtSite?: boolean;
        /**
         * When true, after bearer selection (move-to-mp-pile keep) discard
         * every unique faction in play — belonging to either player — that is
         * playable at the company's current site (Invade Their Domain ba-64,
         * Lord and Usurper ba-65). Distinct from `discardFactionsAtSite`
         * (active player, all factions) and `returnFactionsAtSite` (returns to
         * hand rather than discarding).
         */
        readonly discardUniqueFactionsAtSite?: boolean;
      }
    | {
        /**
         * Brigands-style wound effect: the defending company must discard
         * one item of the defender's choice. Fires once per Brigands attack
         * in which at least one character was wounded. The defender picks
         * any one item from any character in the company.
         */
        readonly type: 'discard-one-company-item';
        /** The company whose items are candidates for discard. */
        readonly companyId: CompanyId;
      }
    | {
        /**
         * The card-player's opponent must discard one or more cards of their
         * choice. Two flavours:
         *
         * - **Fixed-candidate** (Rolled down to the Sea wh-29): the actor picks
         *   from {@link candidateInstanceIds} — rings gathered from their hand
         *   and/or held by their in-play characters. `remaining` defaults to 1.
         *   The candidates may equally be cards in play: Echoes of the Song
         *   (wh-17) lists every Stage card the actor controls, wherever it sits
         *   (`cardsInPlay`, a bearer's items, or a bearer's allies).
         * - **Any-from-hand** (Khamûl the Easterling tw-47): `anyFromHand` is
         *   set, so every card in the actor's current hand is a candidate, and
         *   `remaining` (≥1) cards must be discarded one at a time. The
         *   candidate set is recomputed from the shrinking hand after each pick;
         *   the resolution clears early if the hand empties first.
         *
         * Resolved by repeated `force-discard-card` actions.
         */
        readonly type: 'force-discard-card';
        /**
         * Card instances the actor may choose to discard (fixed-candidate mode).
         * Ignored when {@link anyFromHand} is set.
         */
        readonly candidateInstanceIds: readonly CardInstanceId[];
        /** Definition ID of the source hazard event (for logging). */
        readonly sourceDefinitionId: CardDefinitionId;
        /**
         * When set, any card in the actor's current hand is a valid discard
         * choice (the candidate list is recomputed each step). Used for
         * count-based discards (Khamûl the Easterling).
         */
        readonly anyFromHand?: boolean;
        /**
         * How many more cards must still be discarded. Absent = 1. Decremented
         * after each pick; the resolution clears when it reaches 0 (or, in
         * any-from-hand mode, when the hand empties).
         */
        readonly remaining?: number;
      }
    | {
        /**
         * Hazard permanent-event maintenance cost: fired at the end of the
         * resource player's long-event phase for each in-play hazard permanent
         * event that carries a `hazard-maintenance` effect.
         *
         * The hazard player must choose one of:
         * - `discard-self` — discard the permanent event from cardsInPlay.
         * - `discard-from-hand` — discard a matching hand card (see
         *   {@link HazardMaintenanceEffect.handCardFilter}).
         *
         * Resolved by a `pay-hazard-event-maintenance` action.
         *
         * Used by *Thrice Outnumbered* (le-142).
         */
        readonly type: 'hazard-event-maintenance';
        /** The permanent event card requiring maintenance payment. */
        readonly sourceInstanceId: CardInstanceId;
        readonly sourceDefinitionId: CardDefinitionId;
      }
    | {
        /**
         * Stench of Mordor: at the start of its site phase, the company must
         * tap one untapped character if available. The resource player selects
         * a character to tap, or passes if none are untapped.
         */
        readonly type: 'tap-one-character';
        /** The company whose characters are eligible to tap. */
        readonly companyId: CompanyId;
        /** Definition ID of the source hazard card (Stench of Mordor). */
        readonly sourceDefinitionId: CardDefinitionId;
      }
    | {
        /**
         * Hall of Fire (dm-134): immediately after a company finishes its
         * movement/hazard phase at a Haven where a Hall of Fire is in play,
         * the controlling player may choose one of that company's characters
         * to untap (tapped → untapped) or heal (wounded → tapped), or pass.
         * The improvement applied to the chosen character is determined by
         * its current status, so the resolution only needs the target.
         */
        readonly type: 'haven-restore-character';
        /** The company whose characters are eligible to restore. */
        readonly companyId: CompanyId;
        /** Definition ID of the source permanent event (Hall of Fire). */
        readonly sourceDefinitionId: CardDefinitionId;
      }
    | {
        /**
         * Left Behind (td-41): following all movement/hazard phases, the
         * character(s) who were peeled off into a separate `leftBehind`
         * company may rejoin their original company. Offered only when the
         * original company still exists and occupies the same site as the
         * left-behind company. The player may merge the two (`left-behind-rejoin`)
         * or decline (`pass`, the left-behind company stays separate). Enqueued
         * at the M/H→Site transition (`finalizeCompanyMH`).
         */
        readonly type: 'left-behind-rejoin';
        /** The separate "left behind" company that may rejoin. */
        readonly companyId: CompanyId;
        /** The original company it was peeled off from. */
        readonly originCompanyId: CompanyId;
      }
    | {
        /**
         * My Precious (dm-29): after My Precious attacks and fails but survives,
         * the defender may tap one character in the target company to play the
         * agent's other manifestation (Gollum) from hand, after which My Precious
         * is discarded — or pass (My Precious stays in play). Resolved by a
         * `play-agent-manifestation` action.
         */
        readonly type: 'agent-play-manifestation-offer';
        /** The company whose characters may be tapped to play the manifestation. */
        readonly companyId: CompanyId;
        /** The attacking agent's id (discarded when the manifestation is played). */
        readonly agentId: CompanyId;
        /** Card name of the manifestation the defender may play from hand (Gollum). */
        readonly manifestationCardName: string;
      }
    | {
        /**
         * Stay Her Appetite (le-140): a hazard short-event has targeted an ally.
         * The hazard player rolls 2d6. If roll + ally.mind > opponent.unusedGI +
         * bearerCharacter.unusedDI + 5, a detainment attack (1 strike, prowess =
         * ally.prowess + 2d6) is initiated against the ally's controlling character.
         * The ally is discarded if the attack is not fully defeated.
         */
        readonly type: 'stay-her-appetite-roll';
        /** The targeted ally instance. */
        readonly allyInstanceId: CardInstanceId;
        /** Player index of the ally's owner (resource player). */
        readonly allyOwnerPlayerIndex: number;
        /** The character the ally is attached to. */
        readonly hostCharacterInstanceId: CardInstanceId;
        /** Pre-computed ally mind value (from definition). */
        readonly allyMind: number;
        /** Pre-computed ally base prowess (from definition). */
        readonly allyProwess: number;
        /** Opponent (hazard player) unused general influence. */
        readonly opponentUnusedGI: number;
        /** Controlling character's unused direct influence. */
        readonly controllerUnusedDI: number;
        /** The company the ally is in. */
        readonly companyId: CompanyId;
        /** Definition ID of le-140 (for logging). */
        readonly sourceDefinitionId: CardDefinitionId;
      }
    | {
        /**
         * Pilfer Anything Unwatched (as-33): a character has just been returned
         * to its owner's hand and its items discarded. The card lets the owner
         * transfer **one** of those items to another character remaining in the
         * same company ("one item may be transferred to another character in the
         * same company"). The owner picks one `(item, mate)` pair via a
         * `transfer-returned-item` action, or declines; on either outcome the
         * remaining items stay in the discard pile.
         */
        readonly type: 'transfer-returned-item';
        /** The returned character's items, now sitting in the owner's discard pile. */
        readonly itemInstanceIds: readonly CardInstanceId[];
        /** The company the returned character was in (source of eligible mates). */
        readonly companyId: CompanyId;
        /** Player index of the returned character's owner (who chooses). */
        readonly ownerPlayerIndex: number;
        /** Definition ID of the source hazard event (for logging). */
        readonly sourceDefinitionId: CardDefinitionId;
      }
    | {
        /**
         * Revealed to all Watchers (dm-85): the playing player has just refilled
         * their hand and placed their set-aside (non-hazard) cards on top of the
         * play deck. They now choose the order of those top cards ("in any order
         * you choose"), picking one at a time from top to bottom. The cards are
         * already physically on top of the deck (in a default order); resolving
         * this resolution only permutes those top `count` cards to match the
         * chosen sequence.
         */
        readonly type: 'arrange-deck-top';
        /**
         * How many cards on top of the play deck are being arranged (the number
         * of set-aside cards). The resolution is complete once `orderedInstanceIds`
         * reaches this length.
         */
        readonly count: number;
        /**
         * The player's chosen order so far, top-first. Each `arrange-deck-top-card`
         * action appends the next-highest card; when the length reaches `count`,
         * the top `count` cards are reordered to match and the resolution clears.
         */
        readonly orderedInstanceIds: readonly CardInstanceId[];
        /** Definition ID of the source card (for logging). */
        readonly sourceDefinitionId: CardDefinitionId;
      }
    | {
        /**
         * Eyes of Mandos (dm-126): the playing player has revealed the top
         * cards of their play deck (a `reveal-choose-shuffle` effect) and must
         * now choose exactly one to put into their hand. The revealed cards are
         * still physically on top of the play deck; a `choose-revealed-card`
         * action moves the chosen one to hand and shuffles the remaining play
         * deck. The choice is mandatory (no pass).
         */
        readonly type: 'reveal-choose-to-hand';
        /**
         * Instance ids of the revealed top-of-deck cards the player may choose
         * from (top-first). Exactly one is taken into hand on resolution.
         */
        readonly revealedInstanceIds: readonly CardInstanceId[];
        /** Definition ID of the source card (for logging). */
        readonly sourceDefinitionId: CardDefinitionId;
      }
    | {
        /**
         * Aware of their Ways (dm-46): the card-player has revealed a random
         * subset of the opponent's discard pile (a `reveal-remove-from-discard`
         * effect) and may now choose at most one **non-unique** revealed card to
         * remove from the game. A `remove-revealed-card` action moves the chosen
         * card from the opponent's discard pile to their out-of-play pile; a
         * `pass` declines. The un-chosen revealed cards stay in the discard pile.
         */
        readonly type: 'reveal-remove-from-discard';
        /**
         * Instance ids of the non-unique revealed cards the card-player may
         * choose to remove from play (at most one). Empty is never enqueued.
         */
        readonly removableInstanceIds: readonly CardInstanceId[];
        /** The opponent whose discard pile the cards belong to. */
        readonly opponentId: PlayerId;
        /** Definition ID of the source card (for logging). */
        readonly sourceDefinitionId: CardDefinitionId;
      }
    | {
        /**
         * Desire All for Thy Belly (ba-16), step 1: the card-player has revealed
         * the top cards of the opponent's play deck and must choose exactly one
         * (`desire-choose-shown-card`) to show to the opponent. The choice is
         * mandatory (no pass). On resolution a `desire-belly-choose-penalty`
         * resolution is enqueued for the opponent.
         */
        readonly type: 'desire-belly-choose-card';
        /**
         * Instance ids of the revealed top-of-deck cards (top-first). They stay
         * on top of the opponent's play deck while the choice is pending.
         */
        readonly revealedInstanceIds: readonly CardInstanceId[];
        /** The player whose play deck was revealed (the opponent). */
        readonly opponentId: PlayerId;
        /** The card-player who played the event. */
        readonly cardPlayerId: PlayerId;
        /** Definition ID of the source card (for logging). */
        readonly sourceDefinitionId: CardDefinitionId;
      }
    | {
        /**
         * Desire All for Thy Belly (ba-16), step 2: the card-player has shown a
         * revealed card; the opponent must choose (`desire-choose-penalty`) to
         * either remove that card from the game or permanently reduce his hand
         * size by one. The choice is mandatory (no pass). On resolution the
         * remaining revealed cards are shuffled back on top of the opponent's
         * deck.
         */
        readonly type: 'desire-belly-choose-penalty';
        /** The revealed card the card-player chose and showed to the opponent. */
        readonly chosenInstanceId: CardInstanceId;
        /** Instance ids of all revealed top-of-deck cards (top-first). */
        readonly revealedInstanceIds: readonly CardInstanceId[];
        /** The player whose play deck / hand size is affected (the opponent). */
        readonly opponentId: PlayerId;
        /** The card-player who played the event. */
        readonly cardPlayerId: PlayerId;
        /** Definition ID of the source card (for logging). */
        readonly sourceDefinitionId: CardDefinitionId;
      }
    | {
        /**
         * The Great Hunt (wh-91): after the card enters play, the controller
         * chooses whether the opponent reveals from their play deck or their
         * discard pile (`choose-great-hunt-source` action). The choice kicks off
         * the reveal-and-attack sequence.
         */
        readonly type: 'great-hunt-source';
        /** The Great Hunt card instance driving the process. */
        readonly greatHuntInstanceId: CardInstanceId;
        /** Max creatures that may attack in the reveal sequence. */
        readonly maxCreatures: number;
        /** The opponent whose pile is revealed. */
        readonly opponentId: PlayerId;
        /** The controller's Alatar company that is attacked. */
        readonly companyId: CompanyId;
      }
    | {
        /**
         * The Great Hunt (wh-91) ongoing trigger: the opponent discarded a
         * hazard-creature during the controller's turn. The controller may pass
         * or choose `great-hunt-attack-with-creature` to have that creature
         * attack their Alatar company (it stays in the discard pile).
         */
        readonly type: 'great-hunt-discard-attack';
        /** The Great Hunt card instance driving the trigger. */
        readonly greatHuntInstanceId: CardInstanceId;
        /** The discarded creature instance (in the opponent's discard pile). */
        readonly creatureInstanceId: CardInstanceId;
        /** The opponent who owns the discarded creature (the attacker). */
        readonly opponentId: PlayerId;
        /** The controller's Alatar company that would be attacked. */
        readonly companyId: CompanyId;
      };
}

// ---- Shape B: Active constraints ----

/**
 * Where an {@link ActiveConstraint} lives. Sweeps at the matching boundary
 * automatically clear it.
 */
export type ConstraintScope =
  | { readonly kind: 'turn' }
  /** Cleared when the current attack finalizes (combat ends). */
  | { readonly kind: 'attack' }
  | { readonly kind: 'phase'; readonly phase: Phase }
  | { readonly kind: 'company-site-phase'; readonly companyId: CompanyId }
  | { readonly kind: 'company-mh-phase'; readonly companyId: CompanyId }
  /**
   * Cleared at the end of {@link playerId}'s **next** organization phase —
   * "through your next organization phase" (Shifter of Hues wh-115).
   *
   * {@link afterTurn} records `state.turnNumber` at the moment the constraint
   * was created. The organization-phase-end sweep only drops the constraint
   * once it sees a strictly greater turn number, so the organization phase the
   * constraint was *created in* does not immediately expire it, while the
   * player's next one (necessarily a later turn) does.
   */
  | { readonly kind: 'next-organization-phase'; readonly playerId: PlayerId; readonly afterTurn: number }
  /** Cleared explicitly by another effect; never auto-swept. */
  | { readonly kind: 'until-cleared' };

/**
 * The behaviour a {@link ActiveConstraint} `site-flag` kind toggles on the
 * site whose definition id it carries (matched across "all versions" of the
 * site). Each value was formerly its own single-purpose constraint kind; they
 * share the identical `{ siteDefinitionId }` shape and resolution, so they are
 * collapsed into one parameterized primitive. Player-gated flags additionally
 * constrain via the constraint's player `target` (read with
 * `hasSiteFlagForPlayer`); site-only flags ignore the target (`hasSiteFlag`).
 */
export type SiteFlag =
  /** Rebuild the Town: the bound site's automatic-attacks are skipped. */
  | 'skip-automatic-attacks'
  /** Hidden Haven (wh-75): the bound Ruins & Lairs counts as the controller's Wizardhaven. */
  | 'wizardhaven-conversion'
  /** Hidden Haven (wh-75): nothing on the bound site is playable as written. */
  | 'site-nothing-playable-as-written'
  /** Hidden Haven (wh-75): all attacks against a company at the bound site are canceled. */
  | 'cancel-attacks-at-site'
  /** Double-dealing (wh-66): cross-alignment resources are playable at the bound site. */
  | 'cross-alignment-resources-unlocked'
  /** Guarded Haven family (wh-74 / wh-68 / wh-69 …): opponents may not play MP cards at the bound site. */
  | 'site-protected'
  /** Saruman's Machinery (wh-120): one Technology item is playable at the bound site. */
  | 'technology-item-unlocked';

/**
 * A scoped restriction on the legal actions available to some target.
 * Filters the legal-action menu; never blocks resolution.
 *
 * Cross-player constraints are supported: a constraint placed by one
 * player's card may filter the *opponent's* action computation if its
 * `kind` so dictates (e.g. Stealth — placed by the resource player but
 * filtering the hazard player's creature plays).
 */
export interface ActiveConstraint {
  /** Globally unique ID. */
  readonly id: ConstraintId;
  /** Card instance that placed this constraint (for logs / UI / cancellation). */
  readonly source: CardInstanceId;
  /** Definition ID of the source card, so the UI can display it even when the card is in a hidden pile. */
  readonly sourceDefinitionId: CardDefinitionId;
  /** Auto-clear boundary. */
  readonly scope: ConstraintScope;
  /** What the constraint applies to. */
  readonly target:
    | { readonly kind: 'company'; readonly companyId: CompanyId }
    | { readonly kind: 'character'; readonly characterId: CardInstanceId }
    | { readonly kind: 'player'; readonly playerId: PlayerId };
  /** Discriminated payload. */
  readonly kind:
    | {
        /**
         * Lost in Free-domains / River: company may do nothing during
         * its site phase. Cards that want to grant a cancel escape
         * hatch (e.g. River's ranger-tap) declare a separate
         * `granted-action` constraint alongside this one — both are
         * sourced from the same card so `remove-constraint` sweeps
         * both at once.
         */
        readonly type: 'site-phase-do-nothing';
      }
    | {
        /**
         * Stealth: opponent may not play creature hazards on this company
         * for the rest of this turn.
         */
        readonly type: 'no-creature-hazards-on-company';
      }
    | {
        /**
         * Secret Passage (tw-325): while active, the opponent may only play
         * hazard creatures that are keyed to the target company's destination
         * site (by site-type or site-name). Creatures keyable only via region
         * terrain in the path are dropped. Suppressed while The Way is Shut
         * (dm-98) is in play (see `cancel-card-effects`).
         */
        readonly type: 'only-creatures-keyed-to-site';
      }
    | {
        /**
         * Down Down to Goblin-town (le-181): like `only-creatures-keyed-to-site`,
         * but the restriction applies **only if** the target company moves to a
         * Ruins & Lairs [{R}] site. While active and the company's destination is
         * a Ruins & Lairs, the opponent may only play hazard creatures keyed to
         * that site (by site-type or site-name); region-keyed creatures ("by type
         * or name") are dropped. When the company moves anywhere else the
         * constraint imposes nothing. Kept distinct from
         * `only-creatures-keyed-to-site` because that (ungated) kind blocks
         * region-keyed creatures at any destination (Secret Passage tw-325).
         */
        readonly type: 'only-creatures-keyed-to-site-at-ruins-lairs';
      }
    | {
        /**
         * Crack in the Wall (le-177): the inverse of
         * `only-creatures-keyed-to-site` — no hazard creatures may be played
         * *at the target company's new site*. Any hazard-creature play whose
         * keying match is site-based (`site-type`, `site-name`,
         * `site-keyword`, `adjacent-to-site-keyword`) is dropped; the same
         * creature keyed to region terrain in the path survives as its own
         * play action. `unlessSiteRegionType` turns the restriction off
         * entirely when the destination site's containing region has that
         * type (le-177: "Unless the site is in a Free-domain [{f}]").
         */
        readonly type: 'no-creatures-keyed-to-site';
        readonly unlessSiteRegionType?: import('./common.js').RegionType;
      }
    | {
        /**
         * Hide in Dark Places (le-192): the company may not declare movement
         * (plan a new destination) for the rest of this turn. The card is
         * "playable on a scout whose company is not moving", and locks that
         * company stationary so its hazard-creature immunity cannot be carried
         * onto a moving company. Enforced directly by the org-phase
         * `plan-movement` emitter (`planMovementActions`) and reducer
         * (`handlePlanMovement`).
         */
        readonly type: 'company-cannot-move';
      }
    | {
        /**
         * Generic one-shot check modifier attached to a character. Parallels
         * the DSL `check-modifier` effect but lives on the constraint side
         * because it is targeted, temporary, and consumed the first time
         * the character makes a check of the matching kind.
         *
         * Used by cards like Halfling Strength (+4 corruption check on a
         * chosen hobbit); any future card that grants a one-shot bonus to
         * a named check type can reuse this kind unchanged.
         */
        readonly type: 'check-modifier';
        /** Which check type this modifier applies to (e.g. `corruption`). */
        readonly check: string;
        /** The bonus (or penalty if negative) applied to the roll. */
        readonly value: number;
        /**
         * When true, the targeted character's next matching check succeeds
         * unconditionally regardless of the roll (instead of being adjusted
         * by {@link value}). Used by Ancient Black Axe (as-122).
         */
        readonly autoPass?: boolean;
        /**
         * When true the modifier is **not** consumed by the check it modifies:
         * it keeps applying to every matching check until its scope sweeps it
         * away. The default (absent/false) is the one-shot behaviour every
         * earlier card wanted — "add +2 to *one* corruption check".
         *
         * Shifter of Hues (wh-115) needs the lasting form: tapping Radagast
         * gives "+2 to the corruption checks of the characters in one company
         * through your next organization phase" — a standing buff over a whole
         * company for a bounded window, not a single roll.
         */
        readonly lasting?: boolean;
        /**
         * Optional condition evaluated against the resolving check's resolver
         * context. When present, the modifier is only applied (and consumed) if
         * the condition matches — this lets a booster target one specific
         * flavour of influence attempt. Mine or No One's (ba-68) uses
         * `{ reason: "opponent-influence-check", ... }` so its +10 fires on an
         * opponent-influence attempt against an item/ally/Orc-or-Troll faction
         * and is *not* swallowed by an ordinary faction-influence roll. A
         * check-modifier constraint with no `when` is consumed by the
         * faction-influence roll only (legacy default).
         */
        readonly when?: import('./effects.js').Condition;
        /**
         * For an influence modifier: the fate of the faction card when the
         * boosted (consuming) check fails. `'shuffle-faction-into-deck'` —
         * the faction is shuffled back into its player's play deck instead
         * of being discarded. The Dark Power (as-79): "If the check is not
         * successful, shuffle the faction into your play deck."
         */
        readonly onFailure?: 'shuffle-faction-into-deck';
        /**
         * For a faction-influence modifier: substitute the influencer's
         * unused direct influence with his prowess. When the constraint is
         * consumed, the influencer's whole unused-DI contribution (free DI
         * plus conditional DI bonuses) is removed from the check and
         * `min(effective prowess, max)` is added instead. The prowess is
         * read at *resolution* time — CRF 22 on Threats (le-244): "your
         * prowess is calculated when it resolves" — which is why this is a
         * constraint payload rather than a play-time baked `value`.
         * Threats: "Warrior does not use his unused direct influence for
         * the attempt. Instead he uses his prowess, to a maximum modifier
         * of +6."
         */
        readonly prowessSubstitution?: { readonly max: number };
      }
    | {
        /**
         * Little Snuffler: when the creature's attack is not defeated,
         * resources requiring a scout in the target company cannot be
         * played for the rest of the turn.
         */
        readonly type: 'deny-scout-resources';
      }
    | {
        /**
         * Chill Douser: when its attack is not canceled, all other attacks
         * by creatures of the given race against the target company for the
         * rest of the turn receive a bonus to both strikes and prowess.
         * The constraint source is the Chill Douser instance; when resolving
         * a creature's attack, if the creature's instance ID matches the
         * source the boost is skipped (so the card never boosts itself).
         */
        readonly type: 'creature-attack-boost';
        /** Creature race that receives the boost (e.g. "undead"). */
        readonly race: string;
        /** Strike bonus applied to matching creature attacks. */
        readonly strikes: number;
        /** Prowess bonus applied to matching creature attacks. */
        readonly prowess: number;
      }
    | {
        /**
         * Arouse Defenders (le-101): a single-use boost applied to one of the
         * target company's automatic-attacks at its site — the first attack the
         * company faces consumes it, matching the "one automatic-attack (your
         * choice)" modelling of Choking Shadows (tw-21). The constraint is
         * scoped `company-site-phase` and targets the moving company; the site
         * auto-attack initiation in `reducer-site.ts` adds {@link prowessBonus}
         * to the attack's prowess and, when {@link uncancelable} is set, marks
         * the combat as impossible to cancel, then removes the constraint.
         *
         * {@link siteDefinitionId} records the target site so the "cannot be
         * duplicated on a given site" limit can count copies bound to it (same
         * approach as Greed le-113).
         */
        readonly type: 'auto-attack-boost';
        /** Prowess added to the boosted automatic-attack (le-101: +2). */
        readonly prowessBonus: number;
        /** When set, the boosted automatic-attack cannot be canceled. */
        readonly uncancelable: boolean;
        /** Target site definition (for the per-site duplication limit). */
        readonly siteDefinitionId: CardDefinitionId;
      }
    | {
        /**
         * Generic attribute override: a conditional `add`/`override`
         * modifier on an entity attribute. Collapses what used to be
         * three separate constraint kinds
         * (`auto-attack-prowess-boost`, `site-type-override`,
         * `region-type-override`) into one primitive the engine reads
         * via the {@link AttributeModifierFilter} dispatch.
         *
         * Consumers look up matching modifiers for an entity + attribute
         * at read time; the optional {@link filter} narrows further
         * against a per-read context (e.g. only at ruins-and-lairs).
         * Some attributes have single-use semantics (e.g.
         * `auto-attack.prowess`): consumers remove the constraint after
         * applying it.
         */
        readonly type: 'attribute-modifier';
        /**
         * Which attribute this modifier acts on. New attributes require
         * a one-line union extension plus the matching consumer.
         */
        readonly attribute: AttributePath;
        /** How the modifier combines with the base value. */
        readonly op: 'add' | 'override';
        /**
         * The adjustment. `add` expects a number; `override` expects
         * the new value (SiteType, RegionType, etc., encoded as the
         * appropriate string).
         */
        readonly value: number | string;
        /**
         * Optional DSL condition evaluated per-read against a context
         * that exposes the entity under inspection (e.g.
         * `{ site: { type, definitionId }, region: { name, type } }`).
         * When present and non-matching, the modifier is skipped.
         */
        readonly filter?: Condition;
        /**
         * For a `site.type` `override`: when true, this override is scoped to
         * the untap-phase healing check only. {@link getEffectiveSiteType}
         * skips it, so hazard keying, movement, bring-into-play, and
         * item/faction/ally playability all still see the printed site type;
         * only the haven-healing sweep in `reducer-untap.ts` honours it.
         * Houses of Healing (td-125): "Site becomes a Haven [{H}] for the
         * purposes of healing."
         */
        readonly healingOnly?: boolean;
        /**
         * For an `auto-attack.prowess` modifier: when true, the modifier is NOT
         * consumed after being applied to the first automatic-attack. Ordinary
         * one-shot auto-attack prowess boosts (Choking Shadows) are single-use —
         * the reducer removes them after the first attack. A `persistent`
         * modifier keeps applying to every automatic-attack the company faces at
         * the site until its {@link ConstraintScope} sweeps it (e.g. Come By
         * Night Upon Them le-176: "-1 to the prowess of all automatic-attacks at
         * the site" for the company's whole site phase).
         */
        readonly persistent?: boolean;
      }
    | {
        /**
         * A card- or constraint-granted action attached to an entity
         * (usually a company). The legal-action layer iterates active
         * `granted-action` constraints in each window and emits a
         * generic `activate-granted-action` per eligible candidate.
         * The reducer reads the constraint's `apply` and dispatches on
         * its `type`. Replaces the old `cancel-hazard-by-tap`
         * (Great Ship) and River's cancel-constraint machinery.
         *
         * Fields mirror {@link GrantActionEffect} with the addition of
         * `phase` (where the action is legal) and an optional
         * `window` (sub-step identifier). The generic
         * `activate-granted-action` action type carries `actionId`,
         * `characterId`, and `sourceCardId` — the source is the
         * constraint's `source` (the card that added it).
         */
        readonly type: 'granted-action';
        /** Stable action identifier emitted by the legal-action layer. */
        readonly action: string;
        /**
         * Which phase the action is legal in. When absent, the
         * granted-action is available in any phase the emitter is
         * invoked in (used by River's ranger-cancel, which fires in
         * both M/H and Site phases).
         */
        readonly phase?: Phase;
        /**
         * Optional sub-step or window within the phase. Interpretation
         * is phase-specific (e.g. `'chain-declaring'` for M/H).
         */
        readonly window?: string;
        /** The cost to activate this ability. */
        readonly cost: ActionCost;
        /**
         * Optional DSL condition evaluated against a per-candidate
         * context including `actor` (the tapping character) and any
         * window-specific fields like `path` or `chain`. When absent,
         * every candidate is eligible.
         */
        readonly when?: Condition;
        /** The effect executed when the action is dispatched. */
        readonly apply: TriggeredAction;
      }
    | {
        /**
         * Two or Three Tribes Present: hazard creatures of the named race
         * played against the target company do not count against the
         * hazard limit for the remainder of the company's M/H phase.
         */
        readonly type: 'creature-type-no-hazard-limit';
        /** The creature race exempted from the hazard limit. */
        readonly exemptRace: string;
      }
    | {
        /**
         * Dragon's Desolation (tw-29) Mode B: one hazard creature of the
         * named race may be played on the target company ignoring its
         * normal keying. The constraint is consumed when a creature of the
         * matching race is played against this company — `remainingPlays`
         * decrements by 1, and the constraint is removed when it hits 0.
         * The Dragon played "is not considered keyed to anything" (CRF),
         * so normal keying requirements (site-type, region-type) are
         * waived for the single enabled play.
         */
        readonly type: 'creature-keying-bypass';
        /** The creature race whose keying is bypassed. */
        readonly race: string;
        /** How many more creature plays this constraint permits. */
        readonly remainingPlays: number;
      }
    | {
        /**
         * Withered Lands (td-85): a turn-scoped environment that softens
         * creature keying. Each boost lets one region of type `from` in a
         * company's site path count as `count` regions of type `asType`
         * (e.g. one Shadow-land as two Wildernesses). The boosts are
         * alternatives — at most one is applied per keying check, never
         * combined. Consulted by the creature-keying matchers
         * (`findCreatureKeyingMatches`, `checkCreatureKeying`); the actual
         * path is never mutated.
         */
        readonly type: 'region-keying-boost';
        /** The alternative region treatments this environment enables. */
        readonly boosts: readonly {
          readonly from: import('./common.js').RegionType;
          readonly asType: import('./common.js').RegionType;
          readonly count: number;
        }[];
      }
    | {
        /**
         * Incite Defenders: the next time automatic-attacks are resolved
         * for the target company, one automatic-attack is duplicated
         * (faced a second time immediately after the original). Consumed
         * when the duplicate attack initiates.
         */
        readonly type: 'auto-attack-duplicate';
      }
    | {
        /**
         * Permanent event (e.g. The Moon Is Dead) that duplicates all automatic-attacks
         * of the given creature race. Each matching auto-attack must be faced twice.
         * Added via `on-event: self-enters-play → add-constraint` and persists
         * `until-cleared`. Removed when the source card leaves play.
         */
        readonly type: 'auto-attack-race-duplicate';
        /** Creature race whose auto-attacks are duplicated (lowercase, e.g. "undead"). */
        readonly race: string;
      }
    | {
        /**
         * Many Turns and Doublings: the hazard limit for the target
         * company is modified by {@link value}. Applied after the base
         * limit calculation in `computeHazardLimit`. The "no minimum"
         * clause means the limit may drop below the standard floor of 2.
         */
        readonly type: 'hazard-limit-modifier';
        /** The adjustment to the hazard limit (negative to decrease). */
        readonly value: number;
      }
    | {
        /**
         * Roam the Waste (ba-73): each of the constrained player's companies is
         * "considered to have one fewer Wilderness / Shadow-land … in its site
         * path" for the rest of the turn. Player-targeted and turn-scoped; read
         * when a moving company's `resolvedSitePath` is built
         * (`handleRevealNewSite`), removing up to {@link reductions}[type] tokens
         * of each region type from the path (and the parallel name entry), so it
         * flows to creature keying, ahunt matching, force-return-to-origin, and
         * end-of-company-MH corruption region counts alike.
         */
        readonly type: 'site-path-reduction';
        /** Region type → number of tokens to remove from each company's site path. */
        readonly reductions: Partial<Record<import('./common.js').RegionType, number>>;
      }
    | {
        /**
         * Promptings of Wisdom / Piercing All Shadows: cancels hazard
         * effects that force the company to return to its site of origin
         * or that tap the company's current or new site. Placed when the
         * bearer ranger taps; scoped to the rest of the turn.
         */
        readonly type: 'cancel-return-and-site-tap';
      }
    | {
        /**
         * Magical Harp: cancels effects for the rest of the turn that
         * discard a target character in the bearer's company. Placed when
         * the item is tapped; scoped to the rest of the turn. Pass-through
         * in `applyConstraint` — consumed directly by any future
         * character-discard resolver by checking for an active
         * `cancel-character-discard` constraint on the target company.
         */
        readonly type: 'cancel-character-discard';
      }
    | {
        /**
         * Site-bound boolean marker: toggles one site-scoped behaviour for the
         * site whose definition id matches {@link siteDefinitionId} (across all
         * versions of the site). Collapses the formerly separate single-purpose
         * site constraint kinds — see {@link SiteFlag} for the per-flag rules
         * each value used to document. Consumers test
         * `kind.type === 'site-flag' && kind.flag === '<name>'`, or (preferably)
         * the `hasSiteFlag` / `hasSiteFlagForPlayer` helpers in
         * `engine/constraint-kind.ts`. Player-gated flags also constrain via the
         * constraint's player `target`.
         */
        readonly type: 'site-flag';
        /** Which site behaviour this marker toggles. */
        readonly flag: SiteFlag;
        /** The definition id of the bound site (matches all versions). */
        readonly siteDefinitionId: import('./common.js').CardDefinitionId;
      }
    | {
        /**
         * Vile Fumes (wh-54): the site's printed automatic-attacks are
         * *replaced* by a single bespoke attack (Gas). Added via the
         * `transform-site` grant-action and scoped `until-cleared`,
         * filtered by the site's definition ID so "all versions of the
         * site" are affected. Consumed in `manifestations.ts`
         * `getActiveAutoAttacks`, which returns `[attack]` in place of the
         * printed list when a matching constraint is present.
         */
        readonly type: 'replace-automatic-attacks';
        /** The definition ID of the site whose automatic attacks are replaced. */
        readonly siteDefinitionId: import('./common.js').CardDefinitionId;
        /** The replacement automatic-attack (e.g. Gas: 1 strike, 7 prowess). */
        readonly attack: import('./cards-sites.js').BespokeAutoAttack;
      }
    | {
        /**
         * FEAR! FIRE! FOES! (as-29) Mode A: one **additional** automatic-attack
         * is created at a specific site instance for the rest of the turn.
         * Installed (scope `'turn'`) when the hazard short-event resolves during
         * M/H against a company moving to a Free-hold/Border-hold, keyed to the
         * destination site instance (which becomes the company's `currentSite`).
         * `getActiveAutoAttacks` appends {@link attack} when its `siteInstanceId`
         * matches the queried site instance, so the company faces it as a real
         * automatic-attack in the site phase.
         */
        readonly type: 'extra-automatic-attack';
        /** The site instance the extra attack is created at. */
        readonly siteInstanceId: import('./common.js').CardInstanceId;
        /** The additional automatic-attack (carries `forceDetainment` / empty race). */
        readonly attack: import('./cards-sites.js').AutomaticAttack;
      }
    | {
        /**
         * Blasting Fire (wh-51): every faction-influence attempt made
         * against a faction at the named site is modified by {@link value}
         * for the rest of the turn. Placed (scope `'turn'`) when the item
         * is discarded during the site phase; matched by `siteDefinitionId`
         * against the influencing company's current site in
         * `legal-actions/site.ts`.
         */
        readonly type: 'influence-at-site-modifier';
        /** The definition ID of the site whose influence attempts are modified. */
        readonly siteDefinitionId: import('./common.js').CardDefinitionId;
        /** The bonus (or penalty if negative) applied to the influence roll. */
        readonly value: number;
      }
    | {
        /**
         * Greed (le-113 / tw-42): while this turn-scoped constraint is bound to
         * the site, each character at the site (other than the character playing
         * the item) must make a corruption check each time an item is played at
         * the site, modified by subtracting the item's printed corruption points.
         * Installed by the Greed short-event on resolution and fired by the
         * site-phase item-play handler (`fireItemPlayCorruptionChecks`). Matched
         * by `siteDefinitionId` against the item-playing company's current site.
         */
        readonly type: 'item-play-corruption-check';
        /** The definition ID of the bound site (matches all versions). */
        readonly siteDefinitionId: import('./common.js').CardDefinitionId;
        /**
         * Characters whose `target.*` context matches this condition are exempt
         * from the check (for Greed: Hobbits, Wizards, Ringwraiths). Absent =
         * every character at the site (other than the item-player) checks.
         */
        readonly exemptFilter?: import('./effects.js').Condition;
      }
    | {
        /**
         * METD §7 / rule 10.08 — once a player attempts the no-tap
         * variant of removing a corruption card from a character, no
         * further attempts (tap or no-tap) on the same
         * character+corruption-card pair may happen for the rest of
         * the turn. Scope is `'turn'`, so this clears at next untap.
         */
        readonly type: 'corruption-removal-locked';
        /** Character that attempted the removal. */
        readonly characterId: CardInstanceId;
        /** Corruption card instance the lock applies to. */
        readonly corruptionInstanceId: CardInstanceId;
      }
    | {
        /**
         * Once-per-turn lock for a grant-action flagged
         * {@link GrantActionEffect.oncePerTurn}. Added (turn-scoped) by the
         * grant-action reducer the first time the ability resolves and read
         * by the legal-action scanner to suppress further activations for the
         * rest of the turn. Keyed by the source card instance and action id
         * so distinct once-per-turn abilities (or copies) never collide.
         * Used by Strangling Coils (ba-76).
         */
        readonly type: 'granted-action-used';
        /** Source card instance whose ability was used. */
        readonly sourceInstanceId: CardInstanceId;
        /** The grant-action's `action` identifier. */
        readonly actionId: string;
      }
    | {
        /**
         * Orc-draughts / Miruvor style: flat stat bonus to every
         * character in the target company for the constraint's scope.
         * The effect resolver synthesises an equivalent
         * {@link StatModifierEffect} for each character belonging to
         * the company when computing stats, so caps and override
         * semantics match the DSL path exactly.
         */
        readonly type: 'company-stat-modifier';
        /** Which stat receives the bonus. */
        readonly stat: 'prowess' | 'body';
        /** The bonus applied to every character in the company. */
        readonly value: number;
      }
    | {
        /**
         * Vilya style: turn-scoped stat bonus applied to a single named
         * character instance. The effect resolver synthesises an equivalent
         * {@link StatModifierEffect} when computing that character's stats,
         * so caps and override semantics match the DSL path exactly.
         * Swept at turn-end alongside {@link company-stat-modifier}.
         */
        readonly type: 'character-stat-modifier';
        /** Which stat receives the bonus. */
        readonly stat: 'prowess' | 'body' | 'direct-influence';
        /** The bonus applied to the named character. */
        readonly value: number;
        /** The character instance to which the bonus applies. */
        readonly characterId: CardInstanceId;
        /**
         * Optional name of a card that must remain in play for the bonus to
         * apply (Heart of Dark Fire ba-63: "+5 direct influence this turn while
         * Strangling Coils is in play"). Re-checked by the effect resolver on
         * every stat computation, so the bonus lapses the moment the named card
         * leaves play. When absent, the bonus is unconditional (Vilya style).
         */
        readonly requiresCardInPlay?: string;
      }
    | {
        /**
         * Book of Mazarbul style: +N to the active player's hand size for
         * the rest of the turn. Added when the bearer (a sage) taps the
         * item during the organization phase; swept at turn-end, just
         * before the next untap phase.
         */
        readonly type: 'hand-size-modifier';
        /** The hand size adjustment (positive to increase). */
        readonly value: number;
      }
    | {
        /**
         * The targeted character is able to use the Palantír that added this
         * constraint — i.e. the constraint's `source` card instance, and only
         * that one. Palantír of Elostirion (le-332): "If the bearer is a sage
         * … the bearer is able to use this Palantír this turn if he taps." The
         * sage taps himself (the grant-action's `{ tap: "bearer" }` cost) to
         * add this turn-scoped constraint; the item's own tap-to-draw ability
         * then sees `bearer.canUsePalantir` as true (see
         * `buildGrantActionContext`, which matches the constraint's `source`
         * against the card whose ability is being gated).
         */
        readonly type: 'can-use-palantir';
      }
    | {
        /**
         * Rescue Prisoners style: the bearer character may not untap
         * during the normal untap phase while this constraint is active.
         * Placed when a permanent event with `trigger-attack-on-play`
         * enters play and the post-combat state has at least one untapped
         * character. Cleared when the card is stored via `store-item`.
         * Scope is `until-cleared` so it persists across turns until
         * explicitly removed.
         */
        readonly type: 'bearer-cannot-untap';
        /** The permanent-event card instance that placed this restriction. */
        readonly cardInstanceId: import('./common.js').CardInstanceId;
      }
    | {
        /**
         * Fled into Darkness (ba-18): a **one-shot** untap skip on a character.
         * The next time the character would untap during the untap phase he
         * stays tapped instead; the constraint is then removed and the source
         * card (a `flee-from-strike` permanent-event in the owner's cardsInPlay)
         * is discarded. Scoped to `until-cleared` so it persists across turns
         * until that single untap fires. `cardInstanceId` is the in-play card to
         * discard when the skip is consumed.
         */
        readonly type: 'skip-next-untap';
        /** The `flee-from-strike` card instance to discard when the skip fires. */
        readonly cardInstanceId: import('./common.js').CardInstanceId;
      }
    | {
        /**
         * Marker placed when a `modify-attack` (fromHand) card with
         * `duplication-limit scope "attack"` is played. Stored with
         * `scope: { kind: 'attack' }` so it is swept when combat
         * finalizes. The duplication check in `modifyAttackActions`
         * counts constraints of this type from the same source definition
         * to prevent re-play on the same attack.
         *
         * Example: The Old Thrush (tw-346) — "-3 prowess and body; cannot
         * be duplicated on a given attack."
         */
        readonly type: 'attack-card-played';
      }
    | {
        /**
         * Hermit's Hill (dm-32): a company discarded two minor items to
         * unlock major item playability at the current untapped site for
         * the rest of this company's site phase. Both major items
         * (subtype "major") and hoard items (keyword "hoard") become
         * playable. Scoped to `company-site-phase` so it is swept when
         * the company's site phase ends.
         */
        readonly type: 'major-item-unlocked';
      }
    | {
        /**
         * Hermit's Hill (le-382): a covert company discarded two minor
         * items to make any one gold ring item playable at the current
         * untapped site this turn, "regardless of its text restrictions"
         * — the unlock bypasses both the site's `playableResources` gate
         * and the ring's own `item-play-site` restriction. The minion
         * sibling of `major-item-unlocked`; scoped to
         * `company-site-phase` so it is swept when the company's site
         * phase ends (the site tapping on the ring's play naturally
         * limits the unlock to one gold ring).
         */
        readonly type: 'gold-ring-item-unlocked';
      }
    | {
        /**
         * Records Unread (as-130): a player discarded the item to "make
         * Information playable at any Shadow-hold". While this constraint
         * is active, a resource of category {@link subtype} (e.g.
         * `"information"`) may be played at any site whose type matches
         * {@link siteType} (e.g. `"shadow-hold"`), even when that site does
         * not normally list the category in its `playableResources`.
         * Targeted at the discarding player and scoped to `turn`.
         */
        readonly type: 'site-resource-unlocked';
        /**
         * Site type at which the resource category becomes playable
         * (e.g. `"shadow-hold"` for Records Unread). Mutually exclusive with
         * {@link siteCondition}: exactly one of the two selects the matching
         * sites.
         */
        readonly siteType?: string;
        /**
         * Compound site selector, evaluated against the site context
         * (`site.siteType`, `site.regionType`, `site.name`, `site.region`).
         * Used when "such a site" is not a single site type — e.g. A Panoply
         * of Wings (wh-37) unlocks Information at "any non-Haven,
         * non-Shadow-hold, non-Dark-hold site in a Wilderness".
         */
        readonly siteCondition?: Condition;
        /** Resource category unlocked (e.g. `"information"`). */
        readonly subtype: string;
      }
    | {
        /**
         * Great-road (tw-249): the hazard player may draw up to twice the
         * normal number of cards during this company's M/H phase. The
         * multiplier is applied in `transitionToDrawCards` after the base
         * `hazardDrawMax` is computed from the site and character modifiers.
         * Scoped to `company-mh-phase` so it is swept when the company's
         * M/H sub-phase ends.
         */
        readonly type: 'hazard-draw-multiplier';
        /** Factor to multiply the base hazard draw count by (e.g. 2). */
        readonly multiplier: number;
      }
    | {
        /**
         * Great-road (tw-249): at the end of the turn the company may
         * return to the haven where it began the turn without triggering
         * a new M/H phase. The constraint records the origin haven so the
         * EOT legal-action layer can offer the option and the reducer can
         * execute the site swap. Scoped to `turn` — swept at turn-end if
         * the player chooses not to use it.
         */
        readonly type: 'haven-return-option';
        /** Full SiteInPlay snapshot of the haven at time of play. */
        readonly originHavenInstanceId: CardInstanceId;
        readonly originHavenDefinitionId: import('./common.js').CardDefinitionId;
        readonly originHavenStatus: import('./common.js').CardStatus;
      }
    | {
        /**
         * Marks a character as a prisoner of a hazard host (CoE rule 8.35).
         *
         * While this constraint is active:
         * - The character cannot take any actions (including healing / untapping).
         * - The character costs 0 GI to control.
         * - The character is worth negative marshalling points.
         * - The character cannot be targeted by cards that do not specifically
         *   affect prisoners.
         *
         * Scoped to `game` (never auto-swept; removed explicitly when the
         * prisoner is rescued or the host is discarded).
         */
        readonly type: 'character-is-prisoner';
        /** Instance ID of the hazard host's card — locates the HazardHost record. */
        readonly hostInstanceId: CardInstanceId;
      }
    | {
        /**
         * Press-gang (ba-22): marks a character held "off to the side" with a
         * Press-gang hazard permanent-event. Like a prisoner (CoE 8.35) it costs
         * 0 general influence, is worth **negative** character marshalling points
         * to its owner, and never untaps or heals. Unlike a prisoner there is no
         * rescue site or HazardHost record — the hold ends only when the
         * Press-gang card leaves play (the character returns to its owner's hand)
         * or a new capture replaces it. Scoped `until-cleared`; removed explicitly.
         */
        readonly type: 'character-pressed';
        /** Instance ID of the Press-gang card holding this character. */
        readonly hostInstanceId: CardInstanceId;
      }
    | {
        /**
         * Tidings of Bold Spies (le-143): queued M/H-phase combat attacks that
         * duplicate the destination site's automatic-attacks. One attack per entry
         * in `attacks`; `attackIndex` is the index of the NEXT attack to initiate.
         * When `attackIndex >= attacks.length` the queue is exhausted and the
         * constraint is removed by `finalizeCombat`. Scoped to
         * `company-mh-phase` so it is always swept if combat is somehow skipped.
         */
        readonly type: 'tidings-attacks-queue';
        /** Full list of auto-attack specs copied from the destination site at play time. */
        readonly attacks: readonly import('./cards-sites.js').AutomaticAttack[];
        /** Index of the next attack to initiate (0 = first attack was already started). */
        readonly attackIndex: number;
      }
    | {
        /**
         * Traitor (tw-105): a corruption check failed while a combat was
         * already active (e.g. a Corpse-candle pre-defense check), so the
         * traitor attack could not start immediately. `finalizeCombat`
         * initiates it right after the current combat resolves and removes
         * this constraint — the CRF "chain immediately following" timing.
         * Targeted at the traitor's company; scoped to `turn` as a backstop
         * (combat always finalizes within the turn).
         */
        readonly type: 'traitor-attack-queued';
        /** Strike prowess of the queued attack (traitor's printed prowess + bonus). */
        readonly prowess: number;
        /** Number of strikes the attack delivers. */
        readonly strikes: number;
        /** Modifier applied to any character body check the attack produces. */
        readonly bodyCheckModifier: number;
        /** Lowercase race of the traitor (the attack has the traitor's race per CRF). */
        readonly race?: string;
        /** Definition of the character who became the traitor (name/race for display). */
        readonly traitorDefinitionId: CardDefinitionId;
        /** Controller of the traitor's company (the defending player). */
        readonly defendingPlayerId: PlayerId;
        /** The opponent, who chooses the character to be attacked. */
        readonly attackingPlayerId: PlayerId;
      }
  /**
   * The Great Hunt (wh-91) reveal-and-attack queue. Holds the ordered list of
   * revealed hazard-creature instances that will attack the controller's Alatar
   * company, and how far the sequence has progressed. Each `great-hunt-attack`
   * combat's finalization advances `queueIndex`; when it reaches the end the
   * process completes (reshuffling the opponent play deck if `reshuffleDeck`)
   * and the constraint is removed. Scoped `until-cleared`; targeted at the
   * controlling player.
   */
  | {
        readonly type: 'great-hunt-reveal';
        /** The Great Hunt card instance driving the process. */
        readonly greatHuntInstanceId: CardInstanceId;
        /** Ordered creature instances (in the opponent's deck/discard) to attack. */
        readonly creatureInstanceIds: readonly CardInstanceId[];
        /** Index of the next creature to attack (0 = none started yet). */
        readonly queueIndex: number;
        /** Whether to reshuffle the opponent's play deck when the sequence ends. */
        readonly reshuffleDeck: boolean;
      }
  /**
   * The Great Hunt (wh-91) ongoing discard tracker. While present (the card is
   * in play), the post-reduce sweep offers the controller a
   * `great-hunt-discard-attack` for each hazard-creature the opponent newly
   * discards during the controller's turn. `processedDiscardIds` records every
   * discard instance already handled (offered) so no creature is offered twice
   * — the loop-prevention ruling. Scoped `until-cleared`; targeted at the
   * controlling player; removed when the card leaves play.
   */
  | {
        readonly type: 'great-hunt-active';
        readonly greatHuntInstanceId: CardInstanceId;
        readonly processedDiscardIds: readonly CardInstanceId[];
      }
    | {
        /**
         * Darkness Wielded (ba-55): a one-shot *deferred* free attack
         * cancellation granted to the target player when Darkness Wielded's
         * cancel mode resolves ("cancel this attack and a latter attack of your
         * choice against his company this turn"). While present, the
         * legal-action layer offers a costless `cancel-attack`
         * (`mode: "free-later-cancel"`) during any later combat this turn whose
         * defending company contains The Balrog (when
         * {@link restrictToBalrogCompany}); using it consumes this constraint.
         * Turn-scoped; targeted at the granted player.
         */
        readonly type: 'free-attack-cancel';
        /**
         * When true, the free cancel may only be used against an attack on a
         * company that contains The Balrog avatar ("against his company").
         */
        readonly restrictToBalrogCompany: boolean;
      }
    | {
        /**
         * Tookish Blood (tw-104), resource mode: "For the rest of the turn, the
         * target Hobbit cannot be discarded or returned to its owner's hand for
         * any reason." Placed (scope `'turn'`) on the target character when the
         * card is played as a resource. While present, the central character
         * removal helpers (`returnCharacterToHand` and the discard path of
         * `discardCharacter` in `pending-reducers.ts`) fizzle any attempt to
         * return the character to hand or discard it — including the card's own
         * hazard mode. Checked via `isCharacterRemovalProtected`
         * (`engine/removal-protection.ts`). Auto-swept at turn end.
         */
        readonly type: 'character-removal-protected';
      };
}

// ---- Sweep boundaries ----

/**
 * Discriminated boundary identifier passed to {@link sweepExpired} so it
 * can drop matching resolutions and constraints. Each phase reducer is
 * responsible for calling sweepExpired at the appropriate transitions.
 */
export type ScopeBoundary =
  | { readonly kind: 'phase-end'; readonly phase: Phase }
  | { readonly kind: 'phase-step-end'; readonly phase: Phase; readonly step: string }
  | { readonly kind: 'company-mh-end'; readonly companyId: CompanyId }
  | { readonly kind: 'company-site-end'; readonly companyId: CompanyId }
  /** Clears `attack`-scoped constraints when an attack finalizes. */
  | { readonly kind: 'attack-end' }
  /**
   * Raised when {@link playerId} leaves their organization phase, carrying the
   * turn number that organization phase belonged to. Clears
   * `next-organization-phase`-scoped constraints created on an earlier turn.
   */
  | { readonly kind: 'organization-phase-end'; readonly playerId: PlayerId; readonly turnNumber: number }
  | { readonly kind: 'turn-end' };
