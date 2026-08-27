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
  Race,
  RegionType,
  SiteType,
} from './common.js';
import type { CardInstance, ItemInPlay } from './state-cards.js';
import type { CardEffect, TriggerAttackEntry } from './effects.js';
import type { CreatureKeyingMatch } from './actions-movement-hazard.js';

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
   * Triggered by a `site-phase-start-attack` effect on a card besieging the
   * company's current site (Siege tw-87): the company faces the attack at the
   * beginning of its site phase, before it decides whether to enter the site.
   * These are NOT automatic-attacks — auto-attack modifiers, the home-site
   * tap-to-cancel option and the auto-attack duplicate constraints do not apply.
   * The besieging card stays in play after the attack (it is discarded only when
   * its bound site leaves play), so finalization disposes of nothing.
   */
  | {
      readonly type: 'siege-attack';
      /** The besieging card in play whose effect created this attack. */
      readonly cardInstanceId: CardInstanceId;
      /** The site instance the besieged company occupies. */
      readonly siteInstanceId: CardInstanceId;
    }
  /**
   * Triggered by Cruel Caradhras (td-9) via the `company-strike` DSL effect: a
   * hazard short-event that makes each character in the active company face one
   * strike (not a creature attack — no race, uncancelable). `eventInstanceId`
   * is the played short-event card.
   */
  | { readonly type: 'company-strike-event'; readonly eventInstanceId: CardInstanceId }
  /**
   * Triggered by Doubled Vigilance (dm-51) via the `site-entry-roll-attack`
   * DSL effect: the company failed the entry roll for the site the hazard
   * permanent-event is attached to, so it faces the effect's attack before any
   * of the site's automatic-attacks. `eventInstanceId` is the in-play hazard
   * card; it stays in play after the combat (it is discarded only when the
   * bound site leaves play), so finalization disposes of nothing.
   */
  | { readonly type: 'site-entry-attack'; readonly eventInstanceId: CardInstanceId }
  /**
   * Triggered by a `region-shortcut` constraint (Ash Mountains tw-194 and its
   * "movement enhancer" family): the company tapped its ranger to move as if
   * two otherwise-unconnected regions were adjacent, and faces the printed
   * forced attack for having done so. `eventInstanceId` is the resource
   * short-event that placed the constraint (already discarded by the time the
   * attack resolves — nothing to dispose of on finalization).
   */
  | { readonly type: 'region-shortcut-attack'; readonly eventInstanceId: CardInstanceId; readonly companyId: CompanyId }
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
    }
  /**
   * Triggered by The Hunt (dm-143) via the `named-creature-hunt` DSL effect: a
   * named hazard-creature (already known to the controller via
   * `GameState.handRevealedInstances`, sitting in the opponent's play deck or
   * discard pile) immediately attacks the bearer of The Hunt as though he were
   * a one-character company (`CombatState.soloDefenderInstanceId`). The
   * creature card is never moved out of its pile before the attack — it sits
   * in place, exactly like a `great-hunt-attack` — but a defeated attack
   * still moves it into the defending player's kill pile for marshalling
   * points (CoE rule 964), same as any other creature attack; see
   * `combat-finalize.ts`. `bearerInstanceId` is tapped (if untapped) once the
   * attack concludes, whether finalized or canceled.
   */
  | {
      readonly type: 'hunt-attack';
      readonly huntInstanceId: CardInstanceId;
      readonly creatureInstanceId: CardInstanceId;
      readonly bearerInstanceId: CardInstanceId;
    }
  /**
   * Triggered by Traitor (tw-105) via `on-event: corruption-check-failed` +
   * `traitor-attack`: a character who failed a corruption check "becomes a
   * traitor" and an attack (prowess = traitor's printed prowess + 10, same
   * race as the traitor, 1 strike, body checks +1) is made against a
   * character in the traitor's company, chosen by the opponent of that
   * company's controller (attacker-chooses-defenders). The Traitor card was
   * already discarded when the trigger fired, so `eventInstanceId` points
   * into a discard pile; no card is disposed or awarded at finalization.
   */
  | {
      readonly type: 'traitor-attack';
      /** The (already discarded) Traitor card instance that fired. */
      readonly eventInstanceId: CardInstanceId;
      /** Definition of the character who became the traitor (name/race for display). */
      readonly traitorDefinitionId: CardDefinitionId;
    }
  /**
   * Triggered by Long Dark Reach (dm-70) via the `reveal-deck-choose-attacker`
   * DSL effect: a creature the card-player named from the top of their own
   * play deck immediately attacks the targeted company normally (no
   * solo-defender restriction) — "regardless of its playability
   * requirements". The creature card is never moved out of the deck before
   * the attack — it sits in place, exactly like a `hunt-attack` — but a
   * defeated attack still moves it into the defending player's kill pile for
   * marshalling points (CoE rule 964), same as any other creature attack; see
   * `combat-finalize.ts`.
   */
  | {
      readonly type: 'long-dark-reach-attack';
      readonly sourceInstanceId: CardInstanceId;
      readonly creatureInstanceId: CardInstanceId;
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
   * - `'tie'` -- The character's modified roll exactly equalled the strike's
   *   modified prowess. The strike is ineffectual (CoE 3.iv.7 / rule 8.19): the
   *   character taps but is unharmed, and the strike is NOT defeated. Distinct
   *   from `'success'` so a tie does not count toward defeating the creature and
   *   award kill-MP (the creature must be beaten outright, "without any ties").
   * - `'wounded'` -- The character survived but is wounded (reduced capability).
   * - `'eliminated'` -- The character was killed and removed from play.
   * - `'canceled'` -- The strike was canceled before resolution (e.g. Fatty Bolger).
   * - `'captured'` -- The strike succeeded but the character was taken prisoner
   *   instead of wounded (take-prisoner hazards like Flies and Spiders dm-58,
   *   Troll-purse dm-95; CoE 8.35: "is not wounded — instead taken prisoner").
   *   Distinct from `'wounded'` so finalize-time wound triggers (bearer-wounded
   *   discards, wounded-by-race stamps, character-wounded-by-self effects) do
   *   not fire on an un-wounded prisoner.
   */
  readonly result?: 'success' | 'survived' | 'tie' | 'wounded' | 'eliminated' | 'canceled' | 'absorbed' | 'captured';
  /**
   * Whether the character was already wounded before this strike was resolved.
   * Used for body check calculation: +1 if already wounded (CoE rule 3.I).
   */
  readonly wasAlreadyWounded?: boolean;
  /**
   * CvCC only: whether the *attacking* character was already wounded before
   * this strike was resolved. The same CoE rule 3.I +1 applies to the body
   * check the attacker makes after losing the dual roll; the defender's
   * pre-strike status is in {@link wasAlreadyWounded}.
   */
  readonly attackerWasAlreadyWounded?: boolean;
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
  /**
   * How the facing character resolved this strike (`'tap'`, `'untap'`,
   * `'dodge'`, `'reroll'`). Recorded in `resolveStrikeCore` so the later
   * `body-check` action can gate `enemy-modifier` body reductions on the
   * resolution mode — e.g. Mechanical Bow (wh-53): "-1 to the body of any
   * strike its bearer faces **if he taps to face the strike**" is an
   * `enemy-modifier` body -1 gated on `combat.strikeMode: "tap"`. Absent until
   * the strike is resolved.
   */
  readonly strikeMode?: 'tap' | 'untap' | 'dodge' | 'reroll';
  /**
   * Amount added to the creature's body value for this strike's own body
   * check only (not persisted to {@link CombatState.creatureBody}). Set by
   * a `modify-attack` effect with `scope: "current-strike"` (e.g. Arrows
   * Shorn of Ebony td-99: "-2 body"). Read in `handleBodyCheckRoll`
   * alongside the other creature-body-check modifiers.
   */
  readonly strikeCreatureBodyModifier?: number;
  /**
   * When true, if this strike ultimately resolves as defeated (`result`
   * ends as `'success'` — including passing any creature body check),
   * every other unresolved strike of the same attack automatically
   * resolves as defeated too, by setting {@link CombatState.forcedStrikeDefeat}.
   * Set by a `modify-attack` effect with `scope: "current-strike"` and
   * `cascadeDefeatOnSuccess: true` (Arrows Shorn of Ebony td-99: "If this
   * strike is defeated, all other subsequent failed strikes from this
   * attack are automatically defeated"). Checked in `resolveStrikeCore`
   * (no-body-check path) and `handleBodyCheckRoll` (creature-body-check path).
   */
  readonly cascadesOnDefeat?: boolean;
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
  /** The canonical {@link Race} of the attacking creature (e.g. `"orc"`, `"wolf"`). Used to evaluate combat-conditional weapon effects like Glamdring's "max 9 against Orcs". Absent for attacks that name no race. */
  readonly creatureRace?: Race;
  /**
   * Every race the attacker counts as, when it prints more than one attack
   * type (Goblin-faces wh-13 "Orcs. Men."). Includes {@link creatureRace} as
   * its first entry and is omitted for the single-race majority. Exposed to
   * the DSL as `enemy.races`; `enemy.race` remains the single primary race.
   */
  readonly creatureRaces?: readonly Race[];
  /**
   * The region type this attack is keyed to. When the creature was played
   * with a declared `keyedBy` match (see {@link ChainEntryPayload}), this
   * reflects only that specific match — e.g. a creature whose `keyedTo`
   * lists both a region type and a site type as alternatives (Orc-watch:
   * Shadow/Dark region *or* Shadow-hold/Dark-hold site) is *not* considered
   * "keyed to Shadow-land" when the actual declared match was the site type.
   * Falls back to the flattened union of the creature's `keyedTo` region
   * types when no declared match is available (on-guard reveals, etc.).
   * Used to evaluate cancel-attack conditions like Stinker's "keyed to
   * Wilderness or Shadow-land". Only populated for creature hazards;
   * automatic attacks leave this empty.
   */
  readonly attackKeying?: readonly RegionType[];
  /**
   * The site type this attack is keyed to. Same declared-match precedence
   * as {@link attackKeying}, but for site types. Used by the
   * `no-attack-site-keyed` play-flag to determine whether an ally is immune
   * to a given creature attack. Only populated for creature hazards;
   * automatic attacks leave this absent (since automatic attacks are always
   * "at the site" and the immunity applies unconditionally for that case).
   */
  readonly attackSiteKeyingTypes?: readonly SiteType[];
  /**
   * The specific *region name* this attack is keyed to. Same declared-match
   * precedence as {@link attackKeying}, but for named regions (e.g. a
   * creature keyed by name to "Fangorn"). Used to evaluate cancel-attack
   * conditions like Beasts of the Wood wh-38's "an attack keyed by name to
   * one of the regions listed above". Only populated for creature hazards;
   * automatic attacks leave this absent.
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
  readonly phase: 'assign-strikes' | 'choose-strike-order' | 'resolve-strike' | 'body-check' | 'item-salvage' | 'discard-item-from-company' | 'trophy-offer' | 'shield-discard-roll' | 'cancel-prisoner-taking-choice';
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
   * During the 'cancel-prisoner-taking-choice' phase: the ally the defending
   * player may discard to cancel the current strike's prisoner-taking outcome
   * (e.g. Noble Hound dm-179 — "Discard Noble Hound to cancel any effect that
   * would take its controlling character prisoner"). The struck character is
   * `combat.strikeAssignments[combat.currentStrikeIndex].characterId`. If the
   * player discards the ally (`cancel-prisoner-taking` action), the character
   * is wounded normally instead of taken prisoner; a `pass` declines and the
   * prisoner-taking proceeds. Absent outside this phase.
   */
  readonly cancelPrisonerTakingOffer?: { readonly allyId: CardInstanceId };
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
   * Set when at least one of a multi-attack creature's sub-attacks was
   * canceled outright (via `cancel-attack`/Dark Quarrels-style cards or
   * `cancel-by-tap`) before it ever produced a strike-assignment entry.
   * Per CoE COMBAT / CRF 22 Annotation 14, a canceled attack is never
   * "defeated" — so even if every *other* attack's strike is genuinely
   * defeated in combat, the creature as a whole is not defeated and must
   * not earn kill-MP. `finalizeCombat` ANDs this into `allDefeated`
   * because a canceled attack leaves no trace in `strikeAssignments` for
   * the usual `every(a => a.result === 'success')` check to see.
   */
  readonly anyAttackCanceled?: boolean;
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
   * Multi-attack creatures only (`multiAttackCount > 1`): how much of a global
   * strikes boost (e.g. Rank upon Rank dm-80: "+1 strikes" to Man attacks)
   * exceeds the creature's own printed `strikesPerAttack`. Per CRF 22 Assassin:
   * "If an attack ... is given more than one strike, each additional strike
   * becomes an excess strike (-1 prowess modification) against the attacked
   * character" — the boost does not create genuine extra strike assignments;
   * it is applied as a `-1` prowess penalty (via `StrikeAssignment.excessStrikes`)
   * on each attack's single assignment instead. Absent or 0 when the creature's
   * per-attack strikes are unboosted.
   */
  readonly excessStrikesPerAttack?: number;
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
   * Collected from all characters in the defending company when
   * `strikeEffect: 'discard-item'` resolves, or from the struck character
   * alone when `strikeEffect: 'discard-item-character'` resolves
   * (Pick-pocket tw-79/tw-80).
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
   * CoE rule 3.i / 8.02 — Combat Step 1 (Pre-Assignment Actions). While the
   * attacker holds a live pre-assignment `modify-attack` option (e.g. an
   * unrevealed on-guard Unabated in Malice ba-26 on an automatic-attack) and
   * this flag is false, the attacker holds an exclusive priority window and
   * the defender may not begin strike assignment — otherwise the defender
   * could race ahead and foreclose the attacker's chance to modify the
   * attack as a whole ("continues until both players have finished taking
   * actions prior to strike assignment"). Flipped to true when the attacker
   * passes. Only relevant while `assignmentPhase === 'defender'` and no
   * strikes have been assigned yet.
   */
  readonly attackerPreAssignDone?: boolean;
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
   * the player accepts (moving the character into the attacked company for
   * good, plus scheduling post-attack effects) or when the attack
   * transitions out of cancel-window.
   */
  readonly havenJumpOffers?: readonly HavenJumpOffer[];
  /**
   * A `creature-attack-begins` + `force-check-all-company` corruption effect
   * (Corpse-candle, tw-23/le-67) raised when the attack began, deferred until
   * the cancel-window closes. The card text conditions the check on "if this
   * attack is not canceled," and CoE rule 3.i requires the pre-assignment
   * cancel/modify-attack window to close before anything conditioned on
   * non-cancellation resolves — so the corruption checks are enqueued only
   * when the defender passes out of the cancel-window (not at attack
   * declaration), mirroring how `havenJumpOffers` defer Alatar's offer.
   * Cleared once the checks are enqueued or the attack is canceled.
   */
  readonly pendingAttackBeginsCorruption?: {
    readonly source: CardInstanceId;
    readonly reason: string;
    readonly modifier: number;
  };
  /**
   * Character instance IDs that MUST each receive a strike before any
   * other defender/attacker assignment is legal. Populated when a
   * haven-join-attack is accepted with `forceStrike: true`. The
   * strike-assignment filter restricts defender assignment to these
   * targets while the list is non-empty.
   */
  readonly forcedStrikeTargets?: readonly CardInstanceId[];
  /**
   * Restricts defender/attacker strike assignment to this single character
   * instance — no other member of the defending company (nor an ally hosted
   * by one) may be assigned a strike. Set from
   * `SitePhaseState.soloAutoAttackCharacterId` on every automatic-attack
   * built for a company slot following a failed burglary attempt (Burglary,
   * td-103: "the character must face all automatic-attacks alone"). An ally
   * hosted by this character is still offered — it counts as "what he
   * himself can provide" — but allies hosted by any other company member do
   * not. Absent for every other combat.
   */
  readonly soloDefenderInstanceId?: CardInstanceId;
  /**
   * Side-effects to apply to a specific character when combat finalizes,
   * regardless of outcome. Enqueued by accepted haven-join offers
   * (e.g. Alatar's "must tap + corruption check following the attack").
   */
  readonly postAttackEffects?: readonly PostAttackEffect[];
  /**
   * Turning Hope to Despair (as-41): set when a hand-played `modify-attack`
   * carrying `postAttackMindRollSplit` was played against this attack. If the
   * attack ends up not fully defeated, `finalizeCombat` rolls a per-character
   * mind check (2d6 + mind vs. `threshold`) for every character still in the
   * defending company and splits off each one that fails.
   */
  readonly mindRollSplitPending?: { readonly threshold: number };
  /**
   * Icy Touch (td-33): set when a hand-played `modify-attack` carrying
   * `attachCorruptionOnWound` was played against this attack. The card was
   * already discarded by the ordinary from-hand `modify-attack` path (same
   * as every other card using that effect); this field just marks it as
   * eligible for reattachment. At combat finalization, `finalizeCombat`
   * looks for the first character wounded by the attack who has not already
   * had a corruption card played on him this turn and, if one exists,
   * splices the referenced instance out of `ownerPlayerIndex`'s discard pile
   * and onto that character's `hazards`. If no eligible character was
   * wounded, the card simply stays in the discard pile — "discard if not
   * played with a character" falls out for free.
   */
  readonly pendingCorruptionAttach?: {
    readonly sourceCardInstanceId: CardInstanceId;
    readonly sourceCardDefinitionId: CardDefinitionId;
    readonly ownerPlayerIndex: number;
  };
  /**
   * True when the creature carries `combat-attacker-chooses-defenders`
   * (e.g. Cave-drake). Determines the post-cancel-window transition:
   * attacker-chooses → `'attacker'` assignment; otherwise → `'defender'`
   * (used when cancel-window was opened solely for a haven-jump offer).
   */
  readonly attackerChoosesDefenders?: boolean;
  /**
   * True when a `free-strike-assignment` environment effect (Cloudless Day
   * td-104) is granting the defender free choice of strike targets for this
   * attack: `assignStrikeActions` offers every character/ally in the
   * defending company regardless of tapped/wounded status. Set only for
   * hazard-creature-sourced attacks (see {@link FreeStrikeAssignmentEffect}),
   * and only ever alongside `attackerChoosesDefenders` left unset — the grant
   * also suppresses the attack's own attacker-chooses-defenders rule at the
   * combat-initiation site that computed this flag.
   */
  readonly defenderFreeStrikeAssignment?: boolean;
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
   * When true, every strike of this attack automatically resolves as
   * defeated (as if parried), regardless of the roll. Two sources:
   * - Set at combat initiation from a consumed `defeat-attack-strikes`
   *   constraint (Liquid Fire wh-52: "cause all strikes from all attacks
   *   of a … creature keyed to a site to fail").
   * - Set mid-combat, after a single strike resolves, by a
   *   {@link StrikeAssignment.cascadesOnDefeat} strike ending as defeated
   *   (Arrows Shorn of Ebony td-99: "If this strike is defeated, all other
   *   subsequent failed strikes from this attack are automatically
   *   defeated") — applies only to strikes still unresolved at that point.
   * Each defeated strike still triggers the normal creature body check when
   * the creature has body ({@link creatureBody}), so the defending company
   * may still kill it — just at {@link forcedDefeatBodyCheckModifier} odds
   * (0 unless a Liquid-Fire-style source also set that field). Consumed in
   * `combat-strike.ts`'s `resolveStrikeCore`.
   */
  readonly forcedStrikeDefeat?: boolean;
  /**
   * Amount added to the creature body check (`bodyCheckTarget === 'creature'`)
   * produced by a {@link forcedStrikeDefeat} strike — Liquid Fire (wh-52):
   * "resulting body checks for the creature are modified by -2." Read
   * alongside the wounded-agent bonus and bearer-combat modifier in
   * `handleBodyCheckRoll`.
   */
  readonly forcedDefeatBodyCheckModifier?: number;
  /**
   * Sacrifice of Form (tw-321): set when the defending player plays the card
   * after strikes are assigned (alongside `forcedStrikeDefeat` /
   * `forcedDefeatBodyCheckModifier`). Names the host card and the Wizard being
   * sacrificed so the deferred sweep (`sacrifice-of-form.ts` `sweepSacrificeOfForm`,
   * hooked into `postReduce` via the same prev/next `combat: null` diff as
   * `enqueuePostAttackPlayOffers`) can discard the Wizard and set his items
   * aside once the whole attack — not just the current strike — has finished
   * resolving. Deferring past the end of the attack (rather than discarding
   * immediately) keeps the Wizard's `CharacterInPlay` data available while any
   * remaining strikes of this attack resolve, per the CRF ruling that he still
   * "faces any effects of a failed strike that was assigned to him."
   */
  readonly pendingSacrificeOfForm?: {
    readonly hostInstanceId: CardInstanceId;
    readonly characterInstanceId: CardInstanceId;
  };
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
   * When true, the defending player "cannot use or benefit from spells
   * against the attack" (The Hunt dm-143). Centrally enforced — not exposed
   * to card `when` conditions like {@link weaponsIneffective} — at the two
   * points spells could otherwise help the defender:
   * - `cancelAttackActions` (legal-actions/combat.ts) drops every
   *   `cancel-attack` option sourced from a card carrying the `spell` keyword
   *   (Vanishment tw-356, Wizard's River-horses tw-364).
   * - `collectCreatureAttackBoostEffects` (effects/resolver.ts) skips active
   *   `creature-attack-boost` constraints sourced from a `spell`-keyword card
   *   (Wizard's Flame tw-361's prowess reduction) when computing this
   *   attack's effective prowess/strikes.
   */
  readonly spellsIneffective?: boolean;
  /**
   * When true, this attack was reduced from multiple attacks by
   * *Forewarned Is Forearmed*. Exposed as `attack.isolated` in the
   * `attack-defeated` condition context so the card can self-discard
   * only when one of these isolated attacks is defeated.
   */
  readonly isolated?: boolean;
  /**
   * Special strike resolution override set by tap-agent-at-site hazard
   * short-events (e.g. An Article Missing dm-43) or a creature's own
   * `combat-strike-effect` effect (e.g. Thief tw-102, Pick-pocket tw-79).
   *
   * `'discard-item'`: a successful strike does not wound the defending
   * character; instead the defending company must discard one item of
   * their choice (defender picks), pooled from every character in the
   * company.
   * `'discard-item-character'`: same, but the discard pool is scoped to
   * items borne by the struck character alone (Pick-pocket tw-79/tw-80).
   */
  readonly strikeEffect?: 'discard-item' | 'discard-item-character';
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
   * Weapon item instance IDs whose effects have been cancelled for this
   * company-vs-company combat by a `combat-cancel-weapon` ability (Whip of Many
   * Thongs ba-82: "tap this item to cancel all effects of one weapon of your
   * choice in an opponent's company until the end of the combat"). While a
   * weapon's instance sits in this list, `collectCharacterEffects` drops every
   * effect it sources and `computeEffectiveStats` skips its structural
   * prowess/body — so the weapon contributes nothing to its bearer's combat
   * stats. The weapon itself is NOT discarded; the suppression clears when the
   * combat finalizes (this field lives on the discarded combat state).
   */
  readonly suppressedWeaponInstanceIds?: readonly CardInstanceId[];
  /**
   * When true, this attack uses the "each character faces one strike" rule
   * (CoE §3.I.1): every character in the defending company is automatically
   * assigned exactly one strike, with no player choice. After the cancel
   * window, the engine pre-assigns one strike per character and advances
   * directly to the resolve-strike phase.
   *
   * Used by sites like Mount Gundabad (le-395) whose auto-attack text reads
   * "each character faces 1 strike with N prowess", and by creatures carrying
   * `combat-one-strike-per-character` (Wandering Eldar le-97, Watcher in the
   * Water le-99, Neeker-breekers tw-493, …). Site automatic-attacks pre-assign
   * at combat creation; creature attacks keep the defender's pre-assignment
   * window (CoE 3.i) and assign when it is closed by a `pass`.
   */
  readonly eachCharacterFacesOneStrike?: boolean;
  /**
   * Set when the defending player closed their pre-assignment window (CoE 3.i)
   * on an `eachCharacterFacesOneStrike` attack, which assigns every strike at
   * once. Per CRF 22 Annotation 13 an attack may not be canceled once its
   * strikes have been assigned, so this ends the cancel window that
   * {@link CombatState.eachCharacterFacesOneStrike} otherwise keeps open for
   * attacks that never offer an `assign-strikes` window at all (site
   * automatic-attacks, Carrion Feeders ba-11).
   */
  readonly preAssignmentWindowClosed?: boolean;
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
       * For a short-event that discards a card in play (Voices of Malice
       * le-250, Marvels Told td-134, Ancient Secrets ba-36, The Cock Crows
       * tw-342), the in-play card chosen at declaration time. The discard is
       * performed by the chain resolver — not at play time — so the opponent
       * gets the response window every action is owed (CoE 9.4/9.5).
       */
      readonly discardTargetInstanceId?: CardInstanceId;
      /**
       * True for a short-event played in its "discard **every** matching card
       * in play" mode (Wizard's River-horses tw-364: "All Nazgûl events are
       * discarded"), i.e. a `move { select: 'filter-all', from: 'in-play',
       * to: 'discard' }`. There is no per-target choice to carry, so the flag
       * alone tells the chain resolver to run the sweep — and, crucially,
       * keeps the sweep from firing when the very same card is played in its
       * other (cancel-attack) mode, which pushes a bare `short-event` payload.
       */
      readonly discardAllInPlay?: true;
      /**
       * The character tapped as the short-event's `play-target` cost. Kept
       * separate from {@link targetCharacterId} (which selects other,
       * character-targeting resolution branches) because this one only
       * identifies who makes the follow-up corruption check.
       */
      readonly costTapCharacterId?: CardInstanceId;
      /**
       * For site-targeting short-events (e.g. Greed le-113): the site
       * definition ID the event is bound to. On resolution the event
       * installs its turn-scoped `item-play-corruption-check` constraint
       * bound to this site so item plays there trigger the checks.
       */
      readonly targetSiteDefinitionId?: import('./common.js').CardDefinitionId;
      /**
       * For company-targeted hazard short-events: the company the play was
       * declared against. Lets a site-scoped `duplication-limit` attribute an
       * unresolved on-chain copy to a site (via the company's destination /
       * current site) when the payload carries no `targetSiteDefinitionId` —
       * e.g. Incite Defenders/Denizens ("Cannot be duplicated on a given
       * site") played against a moving company.
       */
      readonly targetCompanyId?: import('./common.js').CompanyId;
      /**
       * For hazard short-events with `play-option` effects (e.g. Weariness of
       * the Heart le-149), the id of the option the hazard player chose at
       * play time. The chain resolver dispatches that option's `apply`.
       */
      readonly optionId?: string;
      /**
       * For an untargeted `play-option` mode acting on one specific card
       * instance (Returned Beyond All Hope as-35), the instance declared at
       * play time. Consumed by the chain resolver as the `move` target.
       */
      readonly optionTargetInstanceId?: CardInstanceId;
      /**
       * For a `force-opponent-discard` effect with a dynamic `count` (Khamûl the
       * Easterling tw-47), the number of cards the opponent must discard,
       * computed at declaration time (when the permanent-event mode was tapped,
       * while the source card was still in play — so "including this one" is
       * already accounted for). Read by the chain resolver; absent = 1.
       */
      readonly forcedDiscardCount?: number;
      /**
       * True when this event entered the chain by being revealed from an
       * on-guard slot rather than played from hand. Effects that cancel the
       * *play* of a hazard event but "cannot be used against an on-guard
       * card" (The Great Eye as-85) skip entries carrying this flag.
       */
      readonly fromOnGuard?: boolean;
    }
  | {
      readonly type: 'creature';
      /**
       * For Summons from Long Sleep (as-39): prowess bonus (+2) applied on
       * top of the creature's resolved prowess when initiating combat.
       * Also carries Fell Beast's (tw-33) -2 penalty when a consumed
       * `nazgul-boost-pending` constraint boosted this creature's play.
       */
      readonly prowessBonus?: number;
      /**
       * For Fell Beast (tw-33): strikes bonus (+1) applied on top of the
       * creature's resolved strike count when a consumed `nazgul-boost-pending`
       * constraint boosted this creature's play.
       */
      readonly strikesBonus?: number;
      /**
       * For Fell Beast (tw-33): when a consumed `nazgul-boost-pending`
       * constraint boosted this creature's play, the resulting attack gets
       * "attacker chooses defending characters".
       */
      readonly grantAttackerChoosesDefenders?: true;
      /**
       * For Summons from Long Sleep (as-39): the permanent-event instance to
       * discard after this creature's combat resolves.
       */
      readonly reservingCardInstanceId?: CardInstanceId;
      /**
       * The specific region/site match the hazard player declared to justify
       * playing this creature (from `PlayHazardAction.keyedBy` /
       * `PlayReservedCreatureAction.keyedBy`). When a creature's `keyedTo`
       * lists several independent ways it can be keyed (e.g. Orc-watch:
       * region type Shadow/Dark *or* site type Shadow-hold/Dark-hold), only
       * the declared match determines `CombatState.attackKeying` /
       * `attackSiteKeyingTypes` / `attackKeyingRegionNames` — not the card's
       * full `keyedTo` union. Absent for creature plays that bypass keying
       * declaration entirely (on-guard reveals, play-from-discard effects),
       * which fall back to the union of the card's `keyedTo`.
       */
      readonly keyedBy?: CreatureKeyingMatch;
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
       * For a `play-target: "nazgul-permanent-event"` hazard permanent-event
       * (Helms of Iron dm-64: "Discard the Nazgûl when this card is brought
       * into play"), the hazard player's own Nazgûl permanent-event instance
       * chosen at declaration. Threaded into the `self-enters-play` move's
       * `targetCardId` so the DSL move can discard it without a filter.
       */
      readonly targetNazgulInstanceId?: CardInstanceId;
      /**
       * For a card played in a `play-option` mode declared as a permanent-event
       * (Returned Beyond All Hope as-35 mode 3), the id of the chosen option.
       * The chain resolver dispatches that option's `apply` instead of placing
       * the card into `cardsInPlay`.
       */
      readonly optionId?: string;
      /**
       * The card instance the permanent-event option acts on (as-35 mode 3: the
       * eliminated creature to bring back to its owner's discard pile).
       */
      readonly optionTargetInstanceId?: CardInstanceId;
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
      /**
       * For a resource permanent-event played on one of the controller's own
       * in-play factions (Long Grievous Siege ba-40), the target faction
       * instance. On resolution the chain reducer places the card into the
       * controller's `cardsInPlay` with `attachedTo` set to this value.
       */
      readonly targetFactionInstanceId?: CardInstanceId;
      /**
       * For a resource permanent-event played on one of the controller's own
       * in-play resource long-events (Echo of All Joy td-110), the target
       * long-event instance. On resolution the chain reducer places the card
       * into the controller's `cardsInPlay` with `attachedToLongEvent` set to
       * this value.
       */
      readonly targetLongEventInstanceId?: CardInstanceId;
      /**
       * For a `faction-siege` permanent-event (Long Grievous Siege ba-40), the
       * site card instance in the controller's location deck chosen at play
       * time. On resolution the chain reducer moves it from the `siteDeck`
       * off to the side with the host and stamps the host's `attachedToSite`
       * with the site's definition id.
       */
      readonly besiegedSiteInstanceId?: CardInstanceId;
      /**
       * For a `play-with-stored-card` resource permanent-event (Wizard's
       * Trove wh-85 primary mode), the named companion card still in the
       * declaring player's hand (e.g. The White Tree). On resolution the
       * chain reducer moves the companion from hand into `cardsInPlay`
       * (mpPinned/textIgnored per the effect) linked to the resolving card,
       * and adds the effect's `site-protected` constraint for
       * `targetSiteDefinitionId`.
       */
      readonly companionCardInstanceId?: CardInstanceId;
      /**
       * For a `storage-site-transfer` resource permanent-event (Wizard's
       * Trove wh-85 "Alternatively" mode), the item to store at
       * `targetSiteDefinitionId` on resolution.
       */
      readonly storeItemInstanceId?: CardInstanceId;
      /** For a `storage-site-transfer` event: the character bearing `storeItemInstanceId`. */
      readonly storeCharacterId?: CardInstanceId;
      /**
       * For an `opposed-roll` permanent-event (No More Nonsense le-210), the
       * second character — "another character in the company" — chosen at play
       * time to roll against {@link targetCharacterId}. On resolution the chain
       * reducer enqueues the `opposed-roll` pending resolution for the pair.
       */
      readonly opposedCharacterId?: CardInstanceId;
      /**
       * True when this event entered the chain by being revealed from an
       * on-guard slot rather than played from hand. See the `short-event`
       * variant's field of the same name.
       */
      readonly fromOnGuard?: boolean;
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
      /**
       * Positive influence-check modifier from a Dragons "Roused" faction's
       * paid `influence-modification` (Smaug Roused le-285: discard a major
       * item for +3 / greater item for +6). The declare handler discards the
       * chosen item and threads the modifier here; the roll resolver adds it.
       */
      readonly bonusModifier?: number;
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
  /**
   * Whether declaring this entry counted one against the active company's hazard
   * limit. Recorded at declaration because the exemptions are only knowable then
   * (a `no-hazard-limit` play flag, or a creature whose race is exempt for the
   * site being moved to — see `isCreatureRaceExempt`, which needs the play action).
   *
   * CoE 2.IV.iii.1 makes the hazard limit an active condition for the whole
   * movement/hazard phase: "there must be no more declared actions that count
   * against the hazard limit when compared to that hazard limit **at
   * resolution**". So a limit lowered after declaration — Many Turns and
   * Doublings (td-132) with Gates of Morning in play — fizzles hazards already on
   * the chain. Only entries with this flag are subject to that check; an exempt
   * hazard never counted, so it can never exceed.
   *
   * Absent on every non-hazard entry (resource plays, passive conditions, …).
   */
  readonly countsAgainstHazardLimit?: boolean;
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
