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

import type { CardInstanceId, CompanyId, PlayerId, CardDefinitionId, Race } from './common.js';
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
   * Flat modifier added to the attacker's side of the final comparison: the sum
   * of one-shot influence `check-modifier` constraint values that matched this
   * opponent-influence attempt (e.g. Mine or No One's ba-68: +10 against an
   * item/ally/Orc-or-Troll faction) and of any bonus granted by the card that
   * declared the attempt (Twisted Tales dm-96: "+6 to influence attempt").
   * 0 (or absent) when no booster was in effect.
   */
  readonly boostModifier?: number;
  /**
   * When true the attempt succeeds without a defence roll — the defending
   * player still gets the window to cancel it outright (e.g. Wizard's
   * Laughter), but cannot roll it down. Used by Twisted Tales (dm-96):
   * "Attempt is automatically successful if target faction is playable at the
   * agent's home site."
   */
  readonly autoSuccess?: boolean;
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
        /**
         * The Precious (tw-98): on a **failed** check, also discard this
         * item — resolved at enqueue time to the item's current bearer
         * within the checking character's company, which may be a
         * *different* character than the one making the check. Null when
         * the named item could not be resolved (already left play).
         */
        readonly alsoDiscardItemId?: CardInstanceId | null;
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
        /**
         * Raw (pre-modifier) 2d6 values that always fail the check regardless
         * of the modified total — News of Doom (le-127): "Discard any faction
         * if its result is 2 or 3, or if its result plus [GI] is less than
         * 10." The "result is 2 or 3" clause reads the unmodified roll, so it
         * cannot be folded into `threshold`/`comparison` (which compare the
         * modified total).
         */
        readonly alwaysFailRolls?: readonly number[];
        /**
         * Modified-total values that trigger `action` INSTEAD of the pass/fail
         * branch — the Orc/Troll printed discard numbers (CoE 3.I.3/3.I.4):
         * Veils Flung Away (le-146) discards an Orc/Troll whose modified
         * body-check total matches a printed discard number, while any other
         * total falls through to the threshold comparison (a failed check
         * merely taps). Unlike `alwaysFailRolls` (raw roll), `values` are
         * compared against the modified total, since body modifiers shift the
         * discard numbers by the same amount.
         */
        readonly matchOutcome?: {
          readonly values: readonly number[];
          readonly action: TriggeredAction;
        };
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
        /** Company the onPass/onFail verbs act on (`lock-company-movement`, Siege tw-87). */
        readonly targetCompanyId?: CompanyId;
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
        readonly creatureRace: Race;
        /** Roll + modifiers must exceed this for success. */
        readonly threshold: number;
        /** Bonus added when the character has the diplomat skill. */
        readonly diplomatBonus: number;
        /** Reduction to the company hazard limit on success. */
        readonly hazardLimitReduction: number;
      }
    | {
        /**
         * Riddling attempt, roll stage (td-148 Riddling Talk): a resource short
         * event has resolved against a creature attack. The defending player
         * rolls 2d6; total = roll + `sageBonus` per Sage in the company +
         * `hobbitBonus` per Hobbit in the company. If total > threshold, a
         * `riddling-guess` resolution is enqueued next (the roll alone does
         * not cancel the attack — see that kind for the second stage).
         */
        readonly type: 'riddling-attempt';
        /** The character making the riddling attempt. */
        readonly characterInstanceId: CardInstanceId;
        /** Race of the attacking creature. */
        readonly creatureRace: Race;
        /** Roll + modifiers must exceed this for success. */
        readonly threshold: number;
        /** Bonus added to the roll for each Sage-skilled character in the company. */
        readonly sageBonus: number;
        /** Bonus added to the roll for each Hobbit-race character in the company. */
        readonly hobbitBonus: number;
        /** Reduction to the company hazard limit if the following guess succeeds. */
        readonly hazardLimitReduction: number;
      }
    | {
        /**
         * Riddling attempt, guess stage (td-148 Riddling Talk): the riddling
         * roll succeeded. The player names a card; the opponent's hand is then
         * revealed (recorded in `GameState.revealedInstances`). If a card with
         * the named definition name is in the opponent's hand, the attack is
         * cancelled and the company hazard limit is decreased by
         * `hazardLimitReduction`. Otherwise the attack proceeds normally.
         */
        readonly type: 'riddling-guess';
        /** Reduction to the company hazard limit on a successful guess. */
        readonly hazardLimitReduction: number;
      }
    | {
        /**
         * Burglary attempt (td-103 Burglary): a character and the site have
         * been tapped "in lieu of facing" the site's automatic-attacks. The
         * player rolls 2d6, modified by `scoutBonus` if the character has the
         * Scout skill and `hobbitBonus` if he is a Hobbit. If the total is
         * greater than `threshold`, the company's automatic-attacks are
         * skipped entirely (`SitePhaseState.autoAttacksSkipped`) and an item
         * normally playable at the site may be played with the character
         * (`SitePhaseState.burglaryItemUnlock`). Otherwise the character must
         * face all of the site's automatic-attacks alone
         * (`SitePhaseState.soloAutoAttackCharacterId`), with no combat support
         * from the rest of his company.
         */
        readonly type: 'burglary-attempt';
        /** The character making the burglary attempt. */
        readonly characterInstanceId: CardInstanceId;
        /** The character's company. */
        readonly companyId: CompanyId;
        /** Roll + modifiers must exceed this for success. */
        readonly threshold: number;
        /** Bonus added to the roll if the character has the Scout skill. */
        readonly scoutBonus: number;
        /** Bonus added to the roll if the character is a Hobbit. */
        readonly hobbitBonus: number;
      }
    | {
        /**
         * Goodwill attempt (dm-160 Token of Goodwill): the diplomat passed his
         * corruption check and now discards one company item of `itemSubtype`
         * to make an influence roll (2d6 + unused DI). If the total exceeds
         * `threshold`, the attack is cancelled and the defending player may
         * fetch one resource card from the play deck or discard pile into hand.
         */
        readonly type: 'goodwill-attempt';
        /** The diplomat making the attempt. */
        readonly characterInstanceId: CardInstanceId;
        /** The diplomat's company — the item discarded must come from here. */
        readonly companyId: CompanyId;
        /** Item rank that must be discarded to make the roll. */
        readonly itemSubtype: 'minor' | 'major' | 'greater';
        /** Roll + unused DI must exceed this for success. */
        readonly threshold: number;
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
         * Opposed roll (No More Nonsense le-210): the card's play-target (the
         * *challenger*) and a second character chosen at play time (the
         * *opponent*) each make a 2d6 roll, `addStat` is added to each total,
         * and the totals are compared. The rolls happen one at a time — the
         * resolution stays queued after the challenger's roll (its total kept
         * in {@link challengerRoll}) until the opponent has rolled too, at
         * which point the source card's `opposed-roll` effect applies its
         * `onWin` / `onLose` outcomes.
         */
        readonly type: 'opposed-roll';
        /** The in-play card instance that ran the contest — the outcomes bind to it. */
        readonly sourceInstanceId: CardInstanceId;
        /** The card that ran the contest (its `opposed-roll` effect holds the outcomes). */
        readonly sourceDefinitionId: CardDefinitionId;
        /** The card's play-target — rolls first. */
        readonly challengerId: CardInstanceId;
        /** The other character chosen from the challenger's company — rolls second. */
        readonly opponentId: CardInstanceId;
        /** Stat added to each side's roll before the comparison. */
        readonly addStat: 'prowess' | 'body' | 'mind';
        /** `'gt'` — the challenger must strictly exceed the opponent; `'gte'` — ties win. */
        readonly comparison: 'gt' | 'gte';
        /** The challenger's 2d6 total, once rolled. Absent until the first roll is made. */
        readonly challengerRoll?: number;
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
        /**
         * How many 2d6 rolls this test makes (default 1). Wizard's Test
         * (tw-365) sets 2: the player rolls twice and then chooses which
         * total the test uses.
         */
        readonly rollCount?: number;
        /**
         * Modified totals rolled so far (one per completed roll). The
         * resolution stays queued — in place, so it keeps its queue position
         * ahead of anything the same card enqueued behind it — until
         * `rollCount` totals are in; the player then resolves it with a
         * `choose-gold-ring-test-roll` action naming the total to use.
         */
        readonly rolledTotals?: readonly number[];
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
        /**
         * Narrows the candidates to the items borne by this one character
         * (Indûr Dawndeath tw-46: "makes any wounded character discard an item
         * of his choice" — the card-player picked the character, its controller
         * picks the item). Absent = any item in the company (Brigands).
         */
        readonly characterId?: CardInstanceId;
        /**
         * DSL condition every candidate item's card definition must match
         * (tw-46: "but not a ring"). Absent = every item qualifies.
         */
        readonly itemFilter?: Condition;
      }
    | {
        /**
         * A `discard-substitute` item (Leaf Brooch dm-171) stands between a
         * hazard/resource effect and the cards it would discard. The owner of
         * the doomed cards either names one to save — discarding the substitute
         * in its place — or declines, in which case every card still listed in
         * {@link requiredInstanceIds} is discarded.
         *
         * The engine enqueues this *instead of* performing the forced discard,
         * so this resolution owns the discard itself. It re-queues while both
         * another substitute and another doomed card remain, letting a company
         * carrying two Leaf Brooches save two items from one requirement.
         */
        readonly type: 'discard-substitute-offer';
        /** The company holding both the substitute and the doomed cards. */
        readonly companyId: CompanyId;
        /** The substitute item that would be discarded in place of a saved card. */
        readonly substituteInstanceId: CardInstanceId;
        /** Cards the triggering effect requires to be discarded, still in play. */
        readonly requiredInstanceIds: readonly CardInstanceId[];
        /** Name of the card that forced the discard, for logging. */
        readonly sourceName: string;
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
         * Upkeep decision for an in-play event carrying an `event-maintenance`
         * effect, fired at the moment named by that effect's `trigger`.
         *
         * One resolution covers a single *stage* of the payment. The
         * controller's `upkeep` stage always comes first; when the effect also
         * declares a `counterChain`, the outcome is then contested by
         * alternating `challenge` (opponent) and `counter` (controller)
         * stages until a side declines or can no longer pay.
         *
         * The actor pays with one action per card, so `remainingToPay` counts
         * down within a stage; the opt-out (`discard-self` at `upkeep`,
         * `decline` at `challenge`/`counter`) is only offered while nothing
         * has been paid yet — i.e. `remainingToPay === stageCount`. A stage is
         * only ever enqueued when its actor holds enough matching cards to
         * finish it, so a part-paid stage can always be completed.
         *
         * Resolved by a `pay-event-maintenance` action.
         *
         * Used by *Thrice Outnumbered* (le-142, upkeep only) and *Balance
         * Between Powers* (dm-118, upkeep + counter chain).
         */
        readonly type: 'event-maintenance';
        /** The in-play event card requiring maintenance payment. */
        readonly sourceInstanceId: CardInstanceId;
        readonly sourceDefinitionId: CardDefinitionId;
        /**
         * Which side of the bidding war this resolution belongs to:
         * - `upkeep` — the controller keeps the card or discards it.
         * - `challenge` — the opponent pays to discard the card.
         * - `counter` — the controller pays to save it.
         */
        readonly stage: 'upkeep' | 'challenge' | 'counter';
        /** Matching hand cards the actor must still discard to finish this stage. */
        readonly remainingToPay: number;
        /** Full cost of this stage, so the opt-out can be offered only up front. */
        readonly stageCount: number;
        /** The player who controls the source card (holds it in `cardsInPlay`). */
        readonly controllerId: PlayerId;
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
         * Enduring Tales (dm-125): "When any player discards a card from his
         * hand, he may discard it to the top of his play deck (and always
         * face down) instead of to his discard pile." A game-wide
         * `hand-discard-recycle-option` marker in either player's bare
         * `cardsInPlay` makes every hand-to-discard-pile transition —
         * regardless of which of the engine's many independent code paths
         * caused it — optionally redirectable. Enqueued reactively as a
         * prev/next diff (`hand-discard-recycle-trigger.ts`) once the
         * discard has already landed in the owner's discard pile; the owner
         * may move that exact instance to the top of their play deck
         * (`recycle-hand-discard`) or leave it discarded (`pass`).
         */
        readonly type: 'hand-discard-recycle-offer';
        /** The card instance now sitting in the owner's discard pile. */
        readonly instanceId: CardInstanceId;
        /** Name of the long-event granting the option, for logging. */
        readonly sourceName: string;
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
         * Elf-song (tw-223): "each character at a Haven [{H}] may immediately
         * remove one corruption card." One resolution per eligible character
         * (bearing at least one corruption card, standing at a matching site
         * when Elf-song entered play), enqueued by
         * `offer-corruption-removal-at-site`. The character's controller
         * either removes one of the character's corruption cards (their
         * choice, if more than one) or declines — either way the resolution
         * clears.
         */
        readonly type: 'remove-corruption-offer';
        /** The eligible character. */
        readonly characterId: CardInstanceId;
        /** Definition ID of the source card (Elf-song), for logging. */
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
         * Great Secrets Buried There (dm-63): the deck owner has had the top
         * cards of their play deck revealed and at least one is an eligible
         * (non-special, non-hoard) item. They must choose exactly one
         * (`choose-set-aside-item`) to place off to the side under the host
         * card. The choice is mandatory (no pass — the resolution is only
         * enqueued when `eligibleInstanceIds` is non-empty). On resolution the
         * remaining revealed cards are shuffled back into the deck.
         */
        readonly type: 'great-secrets-choose-item';
        /** Instance ids of ALL revealed top-of-deck cards (top-first). */
        readonly revealedInstanceIds: readonly CardInstanceId[];
        /** Instance ids of the eligible (non-special, non-hoard item) subset. */
        readonly eligibleInstanceIds: readonly CardInstanceId[];
        /** The player whose deck was revealed and who is choosing. */
        readonly deckOwnerId: PlayerId;
        /** The host permanent-event instance the chosen item is set aside under. */
        readonly hostInstanceId: CardInstanceId;
      }
    | {
        /**
         * Mirror of Galadriel (tw-282): the card-player has already looked at
         * the opponent's hand and must now choose **one** play deck whose top
         * {@link count} cards they look at and shuffle back on top
         * (`choose-peek-deck` action), or decline with `pass` ("You may …").
         * Enqueued only when at least one eligible deck has cards.
         */
        readonly type: 'choose-peek-deck';
        /** How many top cards of the chosen deck are looked at and shuffled. */
        readonly count: number;
        /** Which decks may be chosen (mirrors the effect's `deckChoice`). */
        readonly deckChoice: 'any' | 'self' | 'opponent';
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
      }
    | {
        /**
         * The Hunt (dm-143): after the card is played on Alatar (or another
         * bearer) during the organization phase, the controller names one
         * hazard-creature instance among the opponent's revealed-and-known
         * (`GameState.handRevealedInstances`) play-deck/discard-pile cards
         * (`choose-hunt-target` action) to attack the bearer as a
         * one-character company, or `pass` when no candidate exists.
         */
        readonly type: 'hunt-target-choice';
        /** The Hunt card instance driving the process (already discarded). */
        readonly huntInstanceId: CardInstanceId;
        /** The character The Hunt was played on — the sole defender. */
        readonly bearerInstanceId: CardInstanceId;
        /** The opponent whose piles hold the candidate creatures. */
        readonly opponentId: PlayerId;
        /** The bearer's company (for combat company bookkeeping). */
        readonly companyId: CompanyId;
      }
    | {
        /**
         * "Playable … immediately after his company faces …" resource
         * permanent-events (No News of Our Riding le-211). Enqueued for the
         * defending player the moment a combat their company faced ends (rule
         * 8.03 — the attack counts as faced even if it was canceled), provided
         * the ended attack satisfies the card's `play-window` `when` filter and
         * at least one character of that company is a legal target.
         *
         * The player resolves it with a `play-permanent-event` naming one of
         * {@link cardInstanceIds} and a `targetCharacterId`, or declines with
         * `pass` — the window is optional and closes immediately either way.
         */
        readonly type: 'post-attack-play-offer';
        /** The company that just faced the attack. */
        readonly companyId: CompanyId;
        /** Hand cards whose after-attack play-window matched the ended attack. */
        readonly cardInstanceIds: readonly CardInstanceId[];
      }
    | {
        /**
         * CoE 10.13: an influence attempt declared with an identical card
         * revealed from hand (rule 10.11) has just succeeded, so the attacker
         * "may immediately play the identical card with the influencing
         * character (without tapping the site and without another influence
         * check required)".
         *
         * The revealed card is back in the attacker's hand by the time this is
         * enqueued — the offer is optional, and declining must leave it there
         * rather than anywhere else. Resolved by a `play-revealed-card` action,
         * or `pass` to decline.
         *
         * The play waives the card's own playability restrictions: a character
         * revealed this way needs no matching home site or haven ("a Hobbit may
         * be played in this way"), an item needs no `playableAt` match, and a
         * faction skips the influence check it would normally require. What is
         * *not* waived is influence: a revealed character still has to be
         * controllable, which is why {@link PlayRevealedCardAction} carries a
         * controller.
         */
        readonly type: 'influence-reveal-play-offer';
        /** The revealed identical card, sitting in the actor's hand. */
        readonly revealedInstanceId: CardInstanceId;
        /**
         * The character that made the influence attempt. The card is played
         * "with" them: an item or ally attaches to them, and a character joins
         * their company.
         */
        readonly influencerId: CardInstanceId;
      }
    | {
        /**
         * CoE 3.47: the active player left their organization phase with the
         * total mind of their non-follower characters above their general
         * influence, and must now remove non-avatar characters until they are
         * back within it. Enqueued at the organization/long-event boundary and
         * kept alive, one removal per action, until the overflow is gone (or
         * nothing removable is left).
         *
         * The rule prescribes a strict order, so each step offers only the
         * highest-priority tier that still has a member:
         *
         * 1. Characters brought into play during this organization phase
         *    ({@link playedThisTurnIds}) — these go back to the player's *hand*
         *    rather than the discard pile.
         * 2. Characters that lost direct-influence control between organization
         *    phases and were never reassigned ({@link uncontrolledIds}) —
         *    discarded.
         * 3. Any other non-avatar character, the player's free choice —
         *    discarded.
         *
         * Both id lists are captured at enqueue time (the organization phase
         * state they come from is gone by the time this resolves) and filtered
         * against live state at each step, so a character removed as collateral
         * (e.g. a follower dispersed with its controller) simply drops out.
         *
         * Resolved by repeated `influence-overflow-discard` actions.
         */
        readonly type: 'influence-overflow-discard';
        /** Tier 1: characters brought into play this organization phase (return to hand). */
        readonly playedThisTurnIds: readonly CardInstanceId[];
        /** Tier 2: characters that reverted to general influence outside the organization phase. */
        readonly uncontrolledIds: readonly CardInstanceId[];
      }
    | {
        /**
         * Here Is a Snake! (dm-137): "Opponent may reveal to you any number of
         * hazards from his hand. He may only play hazards he revealed to you
         * (including on-guard cards) for the remainder of target company's
         * movement/hazard phase. Alternatively, a face-down agent is tapped
         * and revealed."
         *
         * Actor is the hazard player (opponent of the card's controller). Each
         * `reveal-hazard-for-snake` action reveals one more hazard card from
         * their hand, appending its instance ID to {@link revealedIds} (mirrors
         * `arrange-deck-top`'s accumulate-then-finalize shape, but the count is
         * unbounded — "any number" — so there is no target length and the actor
         * finalizes explicitly with `pass`). On `pass`, {@link revealedIds}
         * (even empty) becomes the allow-list of an `only-revealed-hazards-on-company`
         * constraint on {@link companyId} for the rest of its M/H phase (CoE
         * rule 4.3 supports an agent tap "initiating a hazard effect" while
         * still face-down at declaration).
         *
         * While {@link revealedIds} is still empty, the actor may instead take
         * `tap-reveal-agent-for-snake` on an eligible face-down, untapped agent —
         * the printed alternative — which taps and reveals that agent and
         * dequeues this resolution with **no** constraint added (CoE rule 4.3).
         * Once any card has been revealed the alternative is no longer offered:
         * the actor has committed to the reveal-and-restrict path.
         */
        readonly type: 'reveal-hazards-choice';
        /** The company the restriction (if any) will apply to. */
        readonly companyId: CompanyId;
        /** Hand instance IDs revealed to the card's controller so far, in reveal order. */
        readonly revealedIds: readonly CardInstanceId[];
      }
    | {
        /**
         * A Lie in Your Eyes (as-23): the defending player (the targeted
         * character's controller) picks how to respond to the hazard-event's
         * threat — tap the character, tap an untapped ally the character
         * controls, or let the card-player roll to try to discard the
         * character. Resolved by a `choose-tap-or-roll` action. The "roll"
         * choice enqueues a follow-up generic `dice-check` resolution rather
         * than rolling inline.
         */
        readonly type: 'tap-or-roll-choice';
        /** The threatened character. */
        readonly characterInstanceId: CardInstanceId;
        /** Who rolls if the "roll" branch is chosen (the hazard/card player). */
        readonly rollingPlayer: PlayerId;
        /** Added to the character's effective mind to form the discard threshold. */
        readonly rollAddend: number;
      }
    | {
        /**
         * Long Dark Reach (dm-70): the card-player has revealed the top cards
         * of their own play deck and at least one is an eligible attacker
         * candidate (Nazgûl, Dragon, or non-unique creature, playable outside
         * Coastal Sea). They must choose exactly one
         * (`choose-long-dark-reach-attacker`) to immediately attack the target
         * company. The choice is mandatory (no pass — the resolution is only
         * enqueued when {@link eligibleInstanceIds} is non-empty). On
         * resolution the unused revealed cards are shuffled among themselves
         * and returned to the top of the card-player's play deck.
         */
        readonly type: 'reveal-deck-choose-attacker';
        /** Instance ids of ALL revealed top-of-deck cards (top-first). */
        readonly revealedInstanceIds: readonly CardInstanceId[];
        /** Instance ids of the eligible-attacker subset. */
        readonly eligibleInstanceIds: readonly CardInstanceId[];
        /** The card-player whose own deck was revealed and who is choosing. */
        readonly cardPlayerId: PlayerId;
        /** The company the chosen creature will attack. */
        readonly targetCompanyId: CompanyId;
        /** The company's owner (defending player). */
        readonly defendingPlayerId: PlayerId;
        /** The Long Dark Reach event instance (for logging / attackSource attribution). */
        readonly sourceInstanceId: CardInstanceId;
      }
    | {
        /**
         * Chance of Being Lost (dm-49): the roll-then-swap dice-check passed
         * and at least one eligible replacement site exists — the hazard
         * player's own `siteDeck` entries whose region matches the moving
         * company's destination site's region (or one of its
         * `adjacentRegions`), excluding the destination site's own name. The
         * hazard player picks one via `swap-new-site-choice`; mandatory (no
         * pass — only enqueued when eligible candidates exist), mirroring
         * `reveal-deck-choose-attacker`'s eligibility-gated enqueue.
         */
        readonly type: 'swap-new-site-choice';
        /** The moving company whose destination site is being replaced. */
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
  /**
   * Lives exactly as long as a hazard long-event owned by {@link playerId}
   * would — "the long-event effect will remain until the appropriate time"
   * (CRF 22 on Witch-king of Angmar tw-113). Hazard long-events are discarded
   * at the end of the long-event phase in which their owner is the *hazard*
   * player ([2.III.3]), so the `long-event-phase-end` boundary drops this
   * constraint the first time it is raised for {@link playerId} on a strictly
   * later turn than {@link afterTurn} (the turn the effect was created in).
   *
   * Used for a long-event whose *effect* outlives the card: Witch-king of
   * Angmar is discarded the moment his long-event resolves, so there is no
   * card in play for the ordinary [2.III.3] sweep to remove — the constraint
   * has to carry the duration itself.
   */
  | { readonly kind: 'next-long-event-phase'; readonly playerId: PlayerId; readonly afterTurn: number }
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
  | 'technology-item-unlocked'
  /** Mallorn (dm-148): the bound site untaps during its owner's untap phase, defying the normal "site cards never untap" rule. */
  | 'site-untaps-during-untap-phase'
  /** Mallorn (dm-148): the bound site is always returned to the location deck rather than discarded when a company departs, even while tapped — the dynamic counterpart of the printed `always-return-to-deck` site-rule. */
  | 'site-always-returns-to-deck'
  /** War-forges (wh-83): one non-hoard, non-unique minor item is playable at the bound site this turn, whether the site is tapped or untapped, sourced from hand, the discard pile, or the sideboard. */
  | 'war-forges-item-unlocked'
  /** King under the Mountain (td-126): the bound site counts as a Dwarf-hold (the `dwarf-hold` site keyword) for every purpose that consults it. */
  | 'dwarf-hold-override';

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
         * Elf-path (td-111): like `only-creatures-keyed-to-site-at-ruins-lairs`,
         * but the restriction applies **only if** the target company's resolved
         * site path is exactly one or two regions and contains no Dark-domain
         * [{d}] or Shadow-land [{s}] regions. While active and the path is
         * safe, the opponent may only play hazard creatures keyed to the
         * company's new site (by site-type or site-name); region-keyed
         * creatures are dropped. When the path is longer or crosses a
         * Dark-domain/Shadow-land, the constraint imposes nothing.
         */
        readonly type: 'only-creatures-keyed-to-site-if-safe-path';
      }
    | {
        /**
         * Paths of the Dead (tw-302): while active, the opponent may only play
         * hazard creatures of the given race against the target company ("The
         * only hazard creatures that may be played on this company are Undead,
         * but any Undead may be played on the company").
         */
        readonly type: 'only-race-creatures-on-company';
        /** The only race whose hazard creatures may be played against the company. */
        readonly race: Race;
      }
    | {
        /**
         * Master of Esgaroth (td-135): the target company "can take a second
         * movement/hazard phase immediately following its first" — the
         * standing, destination-gated counterpart of the one-shot
         * `grant-extra-mh-phase` short event (Forced March le-185), which is
         * played at the *end* of the M/H phase and therefore knows the
         * destination already.
         *
         * td-135 is played at the end of the **organization** phase, before
         * the move resolves, so the gate is evaluated later: when the
         * company's movement/hazard phase ends
         * (`advanceAfterCompanyMH`), the engine checks that the company
         * actually moved and that its new site matches
         * {@link requiresDestinationSiteType} (absent = any destination). On a
         * match the constraint is consumed (removed) and the company enters
         * the shared `extra-mh-move-offer` step, so exactly one extra phase is
         * granted no matter where the second move lands.
         */
        readonly type: 'extra-mh-phase';
        /** Site type the company must have moved to, or undefined for any. */
        readonly requiresDestinationSiteType?: import('./common.js').SiteType;
      }
    | {
        /**
         * World Gnawed by the Nameless (as-110): "All hazard creatures the
         * company faces this turn keyed to Shadow-holds [{S}] attack normally,
         * not as detainment." Turn-scoped, installed on the target company by
         * the `keyed-attacks-normal` DSL effect when the carrying resource
         * event resolves. `isDetainmentAttack` receives the union of these
         * site types (via its `normalIfKeyedToSiteTypes` context field) and
         * forces any attack actually keyed to one of them to resolve as a
         * normal, non-detainment attack.
         */
        readonly type: 'keyed-attacks-normal';
        /** Site types whose keyed attacks against the company become normal. */
        readonly siteTypes: readonly import('./common.js').SiteType[];
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
         * For an influence modifier: what happens when the boosted
         * (consuming) check succeeds. `'draw-card'` draws one card for the
         * influencer's controller. Lordly Presence (tw-267): "If the
         * influence check is successful, draw a card."
         */
        readonly onSuccess?: 'draw-card';
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
         *
         * The `target` decides how wide the boost reaches: a `company` target
         * boosts attacks against that one company (Chill Douser), a `player`
         * target boosts attacks against **every** company that player controls
         * — "all Wolf, Spider, and Animal attacks" (Dwar of Waw tw-31, via the
         * `attack-race-boost` effect).
         *
         * `race` is omitted entirely for a race-agnostic modifier that applies
         * to every attack regardless of creature race — Wizard's Flame
         * (tw-361, via the `company-attack-modifier` effect): "All attacks
         * against Wizard's company suffer a -2 modification to prowess."
         */
        readonly type: 'creature-attack-boost';
        /**
         * Creature race — or races — that receive the boost (e.g. `"undead"`,
         * or `["wolf", "spider", "animal"]`). Omit to match every race.
         */
        readonly race?: Race | readonly Race[];
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
         * Liquid Fire (wh-52): a single-use constraint on the target company
         * that causes all strikes of the next qualifying automatic-attack the
         * company faces to automatically be defeated (as if parried),
         * regardless of the roll — "cause all strikes from all attacks of a
         * … creature keyed to a site to fail." A strike defeated this way
         * still triggers the normal creature body check when the creature
         * has body, so the company may still kill it, but that body check is
         * penalized by {@link bodyCheckModifier} ("resulting body checks for
         * the creature are modified by -2").
         *
         * An automatic-attack whose creature race is in {@link excludeRaces}
         * (Dragon, Ringwraith/Nazgûl, Balrog) is unaffected and does not
         * consume the constraint, so it carries over to a later qualifying
         * attack at the same site visit. The site auto-attack initiation in
         * `reducer-site.ts` resolves and consumes the constraint, threading
         * `forcedStrikeDefeat` / `forcedDefeatBodyCheckModifier` onto the
         * combat; `combat-strike.ts` and `combat-actions.ts` consume those.
         */
        readonly type: 'defeat-attack-strikes';
        /** Added to the creature body check produced by a forced-defeat strike. */
        readonly bodyCheckModifier: number;
        /** Creature races this effect does not apply to. */
        readonly excludeRaces: readonly Race[];
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
         * For a `site.type` `override`: when true, this override does not count
         * toward "is this site a haven" for the purpose of playing (recruiting)
         * a character there. `getEffectiveSiteType`'s callers that check
         * haven-for-recruiting pass `excludeCharacterPlayOverrides` to skip it;
         * every other consumer (hazard keying, movement, bring-into-play,
         * item/faction/ally playability, healing) still honours the override.
         * The White Tree (tw-348): "Minas Tirith becomes a Haven [{H}] for the
         * purposes of healing and playing hazards" — explicitly excluding
         * character recruiting.
         */
        readonly excludesCharacterPlay?: boolean;
        /**
         * For a `site.type` `override`: when true, this override is scoped to
         * healing and character recruiting only — the inverse of
         * {@link excludesCharacterPlay}. {@link getEffectiveSiteType} skips it
         * for every general consumer (hazard keying, movement, storage,
         * item/faction/ally playability), exactly like {@link healingOnly},
         * but callers that pass `excludeCharacterPlayOverrides` (checking
         * haven-for-recruiting) still honour it. The untap-phase
         * haven-healing sweep (`reducer-untap.ts`) scans `site.type` override
         * constraints directly rather than through `getEffectiveSiteType`, so
         * it honours this override regardless of the flag. Mallorn (dm-148):
         * "Bag End becomes a Haven [{H}] for the purposes of healing and
         * bringing characters into play."
         */
        readonly characterPlayOnly?: boolean;
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
        readonly exemptRace: Race;
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
        readonly race: Race;
        /** How many more creature plays this constraint permits. */
        readonly remainingPlays: number;
      }
    | {
        /**
         * Fell Beast (tw-33): played standalone (no existing attack) against a
         * company's M/H phase — "A Nazgûl must be played as the first declared
         * action ... or else this card is returned to its player's hand"
         * (CRF). Targets the company Fell Beast was played against; consumed
         * by the next hazard-creature card of `race` played against that same
         * company (`handlePlayHazard`/`handlePlayReservedCreature`-adjacent
         * creature-play path), which folds `strikesModifier`/`prowessModifier`/
         * `grantAttackerChoosesDefenders` into the resulting attack and may use
         * `keyingRegionTypes`/`keyingSiteTypes` to satisfy keying beyond the
         * creature's own printed `keyedTo`. If the company's M/H phase ends
         * with the constraint still unconsumed, `finalizeCompanyMH` returns
         * the source card from discard to its owner's hand instead of merely
         * dropping the constraint.
         */
        readonly type: 'nazgul-boost-pending';
        /** The creature race this boost applies to (`"ringwraith"`). */
        readonly race: Race;
        /** Strikes delta applied to the boosted creature's attack. */
        readonly strikesModifier: number;
        /** Prowess delta applied to the boosted creature's attack. */
        readonly prowessModifier: number;
        /** Whether the boosted creature's attack grants attacker-chooses-defenders. */
        readonly grantAttackerChoosesDefenders: true;
        /** Extra region types the boosted creature may additionally be keyed to. */
        readonly keyingRegionTypes?: readonly import('./common.js').RegionType[];
        /** Extra site types the boosted creature may additionally be keyed to. */
        readonly keyingSiteTypes?: readonly import('./common.js').SiteType[];
      }
    | {
        /**
         * Fell Beast (tw-33): "Cannot be duplicated on a given Nazgûl." Marks a
         * specific unique Nazgûl creature definition as having already received
         * a Fell Beast boost (Mode A), forever — `until-cleared` scope, never
         * auto-cleared. Checked before offering/consuming a `nazgul-boost-pending`
         * constraint for the same creature; a matching marker makes that
         * creature ineligible while any *other* Nazgûl remains eligible.
         */
        readonly type: 'nazgul-boost-used';
        /** The boosted creature's definition id (unique, so 1:1 with the named Nazgûl). */
        readonly creatureDefinitionId: CardDefinitionId;
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
        /** Creature race whose auto-attacks are duplicated (e.g. `"undead"`). */
        readonly race: Race;
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
         * Lost in Dark-domains (tw-52): "If the company has a Dark-domain
         * [{d}] in its site path, its hazard limit is doubled until the end
         * of the turn." A hazard short-event played during the target
         * company's own movement/hazard phase, once the site path is already
         * resolved (unlike `hazard-limit-region-count`/`hazard-limit-modifier`,
         * which are added before `set-hazard-limit` runs). Applied in
         * `effectiveHazardLimit` (hazard-limit.ts) as a multiplier over the
         * sum of `hazardLimitAtReveal` and every additive modifier, so it
         * doubles whatever the company's live limit already is rather than
         * a fixed base.
         */
        readonly type: 'hazard-limit-multiplier';
        /** Factor the hazard limit is multiplied by (2 for "doubled"). */
        readonly value: number;
      }
    | {
        /**
         * Fair Sailing (tw-232) and the "Fair Travels in X" family: the
         * hazard limit for the target company decreases by {@link perCount}
         * for every region of {@link regionType} in its resolved site path,
         * floored at {@link floor} ("to a minimum of two"). Added by an
         * end-of-organization-phase resource short-event targeting a
         * company that has declared movement (`company.moving`); the
         * region-type count is only known once the company's site path is
         * resolved during its own movement/hazard phase, so — unlike
         * `hazard-limit-modifier` — this kind is read directly from
         * `snapshotHazardLimit` (mh-steps.ts) against the resolved path
         * rather than applied as a flat delta at play time.
         */
        readonly type: 'hazard-limit-region-count';
        /** Region type counted in the company's resolved site path. */
        readonly regionType: import('./common.js').RegionType;
        /** Amount added to the hazard limit per matching region (negative to decrease). */
        readonly perCount: number;
        /** Floor the hazard limit is never reduced below by this constraint. */
        readonly floor: number;
      }
    | {
        /**
         * Fair Sailing's named-region sibling: Anduin River (tw-191) and the
         * "mountain-crossing" family (Ash Mountains tw-194, Misty Mountains
         * tw-284, Mountains of Shadow tw-287, White Mountains tw-359) — "if the
         * site moved to is in one of the regions listed above, the hazard limit
         * is reduced by two (to a minimum of two)". Unlike
         * `hazard-limit-region-count` (counts a region *type* across the whole
         * path), this fires **once** — a flat {@link value} — when the
         * company's final destination region *name* (last entry of the resolved
         * site path, or the destination site's region for starter movement) is
         * among {@link regionNames}. Read directly from `snapshotHazardLimit`
         * (mh-steps.ts) once the destination is known, mirroring
         * `hazard-limit-region-count`'s deferred-check timing. Added by the
         * card's no-tap ("alternatively") mode — mutually exclusive with
         * `region-adjacency-shortcut`, added by its ranger-tap mode.
         */
        readonly type: 'hazard-limit-region-name-match';
        /** Region names that trigger the reduction when the company's destination lies within one. */
        readonly regionNames: readonly string[];
        /** The hazard-limit adjustment applied once when matched (negative to decrease). */
        readonly value: number;
        /** Floor the hazard limit is never reduced below by this constraint. */
        readonly floor: number;
      }
    | {
        /**
         * Anduin River (tw-191) and the "mountain-crossing" family's ranger-tap
         * mode: "tap the ranger to move [this company] as if the following
         * pairs of regions were adjacent". Turn-scoped and company-targeted,
         * added when the card is played by tapping an untapped ranger in the
         * target company. Consulted at both the organization-phase
         * plan-movement pass and the Movement/Hazard declare-path
         * (`withExtraRegionAdjacency`, movement-map.ts) — mirroring
         * `evilHourRegionBonus`'s dual-consult pattern — so the extra
         * adjacency widens which sites are reachable via region movement and
         * which region-card paths are offered to reach an already-declared
         * destination. A no-op for a company that ultimately uses starter or
         * Under-deeps movement instead ("if the company uses region cards for
         * its site path").
         */
        readonly type: 'region-adjacency-shortcut';
        /** Bidirectional region-name pairs treated as adjacent for this company's region movement. */
        readonly pairs: readonly (readonly [string, string])[];
      }
    | {
        /**
         * Ash Mountains (tw-194) and its "movement enhancer" family: an
         * end-of-organization-phase resource short-event bound to a company
         * containing a ranger. While active, `declare-path` region-movement
         * enumeration (`legal-actions/movement-hazard.ts`) treats each named
         * {@link pairs} entry as an extra adjacency edge, but only offers
         * paths using it while the company still has an untapped character
         * with {@link requiredSkill}. If the resolved path actually uses one
         * of those virtual edges, `handleRevealNewSite` (mh-steps.ts) taps
         * that character, removes this constraint, and injects
         * {@link attack} as a `region-shortcut-attack` combat before the
         * hazard limit is set. Otherwise the constraint survives to
         * `snapshotHazardLimit`, which applies {@link hazardLimitReduction}
         * if the company's resolved destination region is one of the
         * (flattened) region names in {@link pairs} — the printed
         * "alternatively" clause. The two payoffs are mutually exclusive on
         * a single move because firing the attack removes the constraint
         * before the hazard-limit check ever sees it.
         */
        readonly type: 'region-shortcut';
        /** Region-name pairs treated as adjacent for path-finding purposes. */
        readonly pairs: readonly (readonly [string, string])[];
        /** Skill an untapped company member must have to use the shortcut. */
        readonly requiredSkill: import('./common.js').Skill;
        /** Forced attack faced when the shortcut is actually used. */
        readonly attack?: {
          readonly race: import('./common.js').Race;
          readonly strikes: number;
          readonly prowess: number;
        };
        /** Hazard-limit adjustment applied when the destination region matches, and the shortcut was not used. */
        readonly hazardLimitReduction: { readonly value: number; readonly floor: number };
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
         * Whole Villages Roused (wh-31): the site's printed automatic-attacks
         * are *replaced*, for this one company's visit only, by the automatic-
         * attacks printed on the **corresponding site card of the other
         * alignment** (same printed name, hero-site ↔ minion-site), each
         * boosted by {@link prowessBoost} and carrying the applicable
         * detainment mode. Installed (scope `'turn'`) when the hazard
         * short-event resolves during M/H against a company moving to a hero
         * Border-hold/Free-hold or a minion Shadow-hold/Dark-hold, keyed to
         * the destination site *instance* (matching only this company's copy,
         * unlike {@link ActiveConstraint.kind} `'replace-automatic-attacks'`
         * which matches every printing by definition id). Consumed in
         * `manifestations.ts` `getActiveAutoAttacks`, which returns the
         * mirrored, boosted attack list in place of the printed one when a
         * matching constraint is present.
         */
        readonly type: 'mirror-automatic-attacks';
        /** The site instance whose printed attacks are replaced. */
        readonly siteInstanceId: import('./common.js').CardInstanceId;
        /** Definition id of the corresponding site card the attacks are borrowed from. */
        readonly mirrorSiteDefinitionId: import('./common.js').CardDefinitionId;
        /** Added to each borrowed attack's printed prowess. */
        readonly prowessBoost: number;
        /**
         * Hero-hold mode ("detainment against hero companies"): the id of the
         * hero-aligned player, baked onto each borrowed attack as
         * {@link import('./cards-sites.js').AutomaticAttack.detainmentAgainstPlayer}.
         * Absent when this constraint is in minion-hold mode.
         */
        readonly detainmentAgainstPlayer?: import('./common.js').PlayerId;
        /**
         * Minion-hold mode ("detainment against overt companies"): bakes
         * {@link import('./cards-sites.js').AutomaticAttack.detainmentAgainstOvert}
         * onto each borrowed attack. Absent when this constraint is in
         * hero-hold mode.
         */
        readonly detainmentAgainstOvert?: boolean;
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
         * King under the Mountain (td-126): "Only Dwarves may play items at
         * this site." Bound (scope `'until-cleared'`) to the site definition
         * id where the target Dwarf's company defeated an at-home Dragon
         * manifestation attack. Consumed by the item-play candidate-character
         * filter in `legal-actions/site.ts` — only characters of {@link race}
         * may bear a newly played item at the site.
         */
        readonly type: 'item-play-race-restriction';
        /** The definition ID of the bound site (matches all versions). */
        readonly siteDefinitionId: import('./common.js').CardDefinitionId;
        /** Only characters of this race may play items at the site. */
        readonly race: Race;
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
         * CRF rule 10.08 (Rule 7.3): the no-tap -3 variant of removing a
         * corruption card "cannot be taken if an attempt to remove the
         * same corruption card has already been made this turn." This
         * marks that a standard tap-and-roll attempt has been made on
         * the character+corruption-card pair, so the no-tap variant is
         * withheld for the rest of the turn — while further tap-and-roll
         * attempts remain allowed per rule 7.3.1 (e.g. if the character
         * is untapped again). Scope is `'turn'`, so this clears at next
         * untap. Superseded by `corruption-removal-locked` once the
         * no-tap variant is actually used, which blocks everything.
         */
        readonly type: 'corruption-removal-attempted';
        /** Character that attempted the removal. */
        readonly characterId: CardInstanceId;
        /** Corruption card instance the attempt applies to. */
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
         * Optional ceiling applied to the running stat total immediately after
         * this bonus is added (mirrors a JSON `stat-modifier`'s `max` field —
         * see {@link resolveStatModifiers}). Used by Biter and Beater! (as-46):
         * "the maximum values indicated by the weapons still apply" — the +2
         * bonus it grants a named-weapon bearer is capped at that weapon's own
         * printed maximum, so it cannot push the total past a ceiling the
         * weapon's own bonus alone would already respect.
         */
        readonly max?: number;
        /**
         * Optional name of a card that must remain in play for the bonus to
         * apply (Heart of Dark Fire ba-63: "+5 direct influence this turn while
         * Strangling Coils is in play"). Re-checked by the effect resolver on
         * every stat computation, so the bonus lapses the moment the named card
         * leaves play. When absent, the bonus is unconditional (Vilya style).
         */
        readonly requiresCardInPlay?: string;
        /**
         * When true, the bonus applies only while the constraint's `source`
         * card instance is still **attached to** {@link characterId} (in that
         * character's `items` or `hazards`). Lets a permanent event that keeps
         * sitting on its bearer carry a modifier whose value was fixed at play
         * time — No More Nonsense (le-210) rolls once and then grants its
         * leader ±2 direct influence for as long as the card stays on him.
         * Without it an `until-cleared` constraint would outlive its source.
         */
        readonly requiresSourceBorne?: boolean;
      }
    | {
        /**
         * Attack-scoped reduction of the attacking creature's body-check
         * target for strikes faced by one named character — the short-event
         * counterpart of an item's `enemy-modifier` (stat "body", op
         * "subtract"), which normally only reaches a bearer through their own
         * borne items. Consulted in `handleBodyCheckRoll`'s `bodyCheckTarget
         * === 'creature'` branch alongside `resolveEnemyBody`'s item-sourced
         * reduction; `Math.max(0, ...)` mirrors the `subtract` op's floor.
         * Scoped to `{ kind: 'attack' }` so it is swept when combat finalizes.
         *
         * Used by Biter and Beater! (as-46): "Every Sword of Gondolin,
         * Orcrist, and Glamdring in target company … lower the body of
         * strikes their bearers face by 1" — one constraint per matching
         * borne weapon, targeting that weapon's bearer.
         */
        readonly type: 'character-creature-body-modifier';
        /** Amount subtracted from the creature's body-check target. */
        readonly value: number;
        /** The character instance whose faced strikes are reduced. */
        readonly characterId: CardInstanceId;
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
         * Morgul-knife (tw-64) / The Pale Sword (tw-97): "a character with
         * this card may attempt to remove it instead of untapping or
         * healing." Added by the corruption card's `grant-action` the
         * instant it is activated — regardless of the removal roll's
         * outcome, attempting it costs the bearer this untap phase's untap
         * and heal. Scoped to `turn` (it only ever needs to survive from
         * activation to the same untap phase's `performUntap` sweep).
         */
        readonly type: 'skip-untap-and-heal';
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
         * return to the site where it began the turn without triggering
         * a new M/H phase. The constraint records the origin site so the
         * EOT legal-action layer can offer the option and the reducer can
         * execute the site swap. Scoped to `turn` — swept at turn-end if
         * the player chooses not to use it. Not Haven-exclusive despite the
         * name: Ancient Stair (dm-115) plays it from an Under-deeps-adjacent
         * surface site, gated by {@link requiresMovedToKeyword}.
         */
        readonly type: 'haven-return-option';
        /** Full SiteInPlay snapshot of the origin site at time of play. */
        readonly originHavenInstanceId: CardInstanceId;
        readonly originHavenDefinitionId: import('./common.js').CardDefinitionId;
        readonly originHavenStatus: import('./common.js').CardStatus;
        /**
         * Ancient Stair (dm-115): only offer the return option when the
         * company's site at end of turn carries this keyword (`"under-deeps"`).
         * Omitted for an unconditional offer (Great-road tw-249).
         */
        readonly requiresMovedToKeyword?: string;
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
         * No Better Use (ba-41): marks a character held "off to the side" by a
         * host card that lives in a *bearer* character's `items` (not bare in
         * `cardsInPlay` like Press-gang's host) — captured in lieu of a CvCC
         * body check rather than by intercepting a discard. Scored exactly
         * like a prisoner (CoE 8.35) / `character-pressed` capture: 0 general
         * influence, negative character marshalling points, never untaps or
         * heals (`recompute-derived.ts` / `reducer-untap.ts` /
         * `influence-overflow.ts` treat this kind identically to
         * `character-is-prisoner` / `character-pressed`). Kept as a distinct
         * kind — rather than reusing `character-pressed` — because
         * `sweepPressGang`'s host-liveness check only looks at `cardsInPlay`
         * and would otherwise treat an item-attached host as "gone" on the
         * very next `postReduce` pass, immediately releasing the capture.
         * Scoped `until-cleared`; removed explicitly by
         * `engine/no-better-use.ts`'s `sweepNoBetterUseCaptures`.
         */
        readonly type: 'character-captured-by-bearer';
        /** Instance ID of the host card (in the bearer's `items`) holding this character. */
        readonly hostInstanceId: CardInstanceId;
        /**
         * The capturing character's instance id. `sweepNoBetterUseCaptures`
         * watches this character each `postReduce` pass and releases the held
         * character (forming a fresh company at its last known site) the
         * moment it is wounded or can no longer be found in
         * `bearerOwnerId`'s `characters`.
         */
        readonly bearerCharacterId: CardInstanceId;
        /** Owner of {@link bearerCharacterId} (and of `hostInstanceId`). */
        readonly bearerOwnerId: PlayerId;
        /**
         * The bearer's company's `currentSite` as of the most recent sweep
         * pass while the bearer was still resolvable — refreshed continuously
         * so it tracks the bearer's movement, and used as the release site if
         * the bearer has already vanished from play by the time a sweep pass
         * detects the release condition.
         */
        readonly bearerLastKnownSite: import('./state-cards.js').SiteInPlay | null;
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
        /** Race of the traitor (the attack has the traitor's race per CRF). */
        readonly race?: Race;
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
        /**
         * When set, the free cancel may only be used against an attack on this
         * specific company ("the next … attack the company faces this turn" —
         * Fifteen Birds in Five Firtrees dm-129, as opposed to ba-55's
         * player-wide "his company" match on Balrog membership).
         */
        readonly restrictToCompanyId?: CompanyId;
        /**
         * When true, the free cancel may only be used against an attack sourced
         * from a non-unique hazard creature (`enemy.unique !== true`), mirroring
         * the granting card's own gate. Used by Fifteen Birds in Five Firtrees
         * (dm-129).
         */
        readonly requireNonUniqueCreature?: boolean;
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
      }
    | {
        /**
         * Fifteen Birds in Five Firtrees (dm-129): "An untapped character in
         * the company must tap to face any strike from a subsequent hazard
         * creature attack for the rest of the turn." Turn-scoped, targeted at
         * the company that played the card. The `assign-strike` reducer
         * (`reducer-combat.ts`) checks this constraint whenever a *new* (not
         * excess) strike is assigned during a hazard-creature-sourced combat
         * (`attack.source` in creature / on-guard-creature / played-auto-attack)
         * against the target company, and taps the assigned character in
         * place when it was untapped.
         */
        readonly type: 'tap-on-strike-assignment';
      }
    | {
        /**
         * Here Is a Snake! (dm-137): once the hazard player finalizes their
         * `reveal-hazards-choice` resolution (by `pass`, with zero or more
         * cards revealed), the opponent may, "for the remainder of target
         * company's movement/hazard phase," play only the hazards they
         * revealed. Company-scoped, `company-mh-phase` scope (auto-clears when
         * the target company's M/H phase ends).
         *
         * Filters `play-hazard` actions targeting the protected company (both
         * hazard creatures and hazard events), dropping any whose
         * `cardInstanceId` is not in {@link allowedInstanceIds}. An empty list
         * (the opponent revealed nothing) blocks every hazard play against the
         * company for the rest of its M/H phase. "including on-guard cards" is
         * enforced separately by `onGuardWindowActions`
         * (`legal-actions/pending.ts`), which looks this constraint up
         * directly — while an on-guard-window resolution is queued,
         * `computeLegalActions` never reaches the generic constraint
         * post-filter that this kind would otherwise ride.
         */
        readonly type: 'only-revealed-hazards-on-company';
        /** Instance IDs of the hazard cards the opponent revealed; the sole plays still allowed. */
        readonly allowedInstanceIds: readonly CardInstanceId[];
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
  /**
   * Raised when the long-event phase ends ([2.III.3] — the moment the hazard
   * player's hazard long-events are discarded), carrying that hazard player's
   * id and the turn number. Clears `next-long-event-phase`-scoped constraints
   * owned by {@link hazardPlayerId} that were created on an earlier turn.
   */
  | { readonly kind: 'long-event-phase-end'; readonly hazardPlayerId: PlayerId; readonly turnNumber: number }
  | { readonly kind: 'turn-end' };
