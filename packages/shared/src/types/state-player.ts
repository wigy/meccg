/**
 * @module state-player
 *
 * Per-player state type for the MECCG engine.
 * Defines the complete state of one player including all card zones,
 * companies, characters, and scoring.
 */

import {
  PlayerId,
  WizardName,
  Alignment,
  TwoDiceSix,
} from './common.js';
import type {
  CardInstance,
  CharacterInPlay,
  CardInPlay,
  Company,
  MarshallingPointTotals,
} from './state-cards.js';
import type { CardDefinitionId, CardInstanceId, ById } from './common.js';
import type { AgentInPlay } from './state-agents.js';

// ---- Per-player state ----

/**
 * The complete state for one player, including all card zones and board position.
 *
 * MECCG players each maintain separate card zones (hand, play deck, discard, etc.)
 * and a collection of companies with characters in play. The player's wizard
 * identity is set after the draft phase. General influence (a shared pool of 20
 * minus mind values of controlled characters) determines how many characters
 * can be in play simultaneously.
 */
export interface PlayerState {
  /** Unique player identifier for this game session. */
  readonly id: PlayerId;
  /** Display name chosen by the player. */
  readonly name: string;
  /** The alignment of this player's wizard (wizard, ringwraith, fallen-wizard, balrog). */
  readonly alignment: Alignment;
  /** The wizard (Istari) this player controls, or null before wizard selection. */
  readonly wizard: WizardName | null;
  /** Cards currently in the player's hand (hidden from opponent). */
  readonly hand: readonly CardInstance[];
  /** The shuffled draw pile of resource and hazard cards (hidden from both players). */
  readonly playDeck: readonly CardInstance[];
  /** Face-up pile of discarded play deck cards. */
  readonly discardPile: readonly CardInstance[];
  /** The player's available site cards (hidden from opponent). */
  readonly siteDeck: readonly CardInstance[];
  /** Face-up pile of used/discarded site cards. */
  readonly siteDiscardPile: readonly CardInstance[];
  /** Reserve cards that can be fetched under specific game conditions. */
  readonly sideboard: readonly CardInstance[];
  /**
   * Marshalling point pile: defeated creatures and stored items (CoE rule
   * 2.II.4.1 places successfully stored items here). Labeled "MP Pile" in the
   * UI.
   */
  readonly killPile: readonly CardInstance[];
  /**
   * Cards that are no longer in play: eliminated characters (tracked for
   * MP-modifier effects with reason "elimination") and sites stored via
   * stolen-knowledge. Stored items go to `killPile` per CoE rule 2.II.4.1.
   */
  readonly outOfPlayPile: readonly CardInstance[];
  /** All companies this player controls on the map. */
  readonly companies: readonly Company[];
  /**
   * All agents this player has in play as hazards.
   * Agent characters live here, not in `characters`, so they are excluded from
   * general-influence accounting and follower machinery.
   */
  readonly agents: readonly AgentInPlay[];
  /** All characters this player has in play, keyed by their CardInstanceId for fast lookup. */
  readonly characters: ById<CharacterInPlay>;
  /** General cards in play on the table (permanent resources, factions, etc.) not attached to characters. */
  readonly cardsInPlay: readonly CardInPlay[];
  /**
   * Current marshalling point (victory point) totals broken down by category.
   * Updated whenever cards enter or leave play. Used for display and Free Council scoring.
   */
  readonly marshallingPoints: MarshallingPointTotals;
  /**
   * MEBA: one-time miscellaneous marshalling points awarded by special effects
   * that are not tied to a card remaining in play — currently Challenge the
   * Power (ba-52), whose 9–10 band grants the Balrog player 2 MP. Folded into
   * the `misc` category by `recompute-derived`. Defaults to 0/undefined.
   */
  readonly bonusMiscMarshallingPoints?: number;
  /**
   * One-time *kill* marshalling points awarded to this player for eliminating an
   * opposing hero outside the normal defeated-creature kill-pile flow — used by
   * A Malady Without Healing (le-159): "If target character is a hero and is
   * eliminated by these checks, you receive his kill marshalling points." Folded
   * into the `kill` category by `recompute-derived`. Defaults to 0/undefined.
   */
  readonly bonusKillMarshallingPoints?: number;
  /**
   * MEBA: set true once Challenge the Power (ba-52) resolves on its 9–10 band
   * ("The One Ring affects The Balrog"). Marks that the One Ring borne by the
   * Balrog now affects him; consumed wherever the Balrog's item/corruption
   * immunities are made conditional on this flag.
   */
  readonly oneRingAffectsBalrog?: boolean;
  /**
   * Marshalling point totals that count toward *calling* the endgame (Free
   * Council / Audience with Sauron). Identical to {@link marshallingPoints}
   * except that MPs of cards held by companies at an Under-deeps site are
   * excluded (MEAS §6e) — those still count in the final tally, just not toward
   * reaching the call threshold. Recomputed alongside `marshallingPoints`.
   */
  readonly callableMarshallingPoints: MarshallingPointTotals;
  /**
   * Fallen-wizard stage points (MEWH): the running total of stage points
   * printed on this player's in-play stage permanent-events. Derived (summed
   * from `stage-points` effects) by `recomputeDerived`, never mutated directly.
   * Always 0 for non-Fallen-wizard players. A Fallen-wizard must keep this at
   * 3 or more, and some rules key off higher thresholds (e.g. the optional
   * company-vs-company combat rule above 10).
   */
  readonly stagePoints: number;
  /**
   * How much of the player's 20-point general influence pool is currently committed
   * to controlling characters. Characters whose mind value exceeds remaining GI cannot be played.
   */
  readonly generalInfluenceUsed: number;
  /**
   * Sum of general-influence modifiers from cards currently in play (e.g. Bade to Rule: +5).
   * Recomputed by recomputeDerived. Effective GI pool = GENERAL_INFLUENCE + generalInfluenceBonus.
   */
  readonly generalInfluenceBonus: number;
  /**
   * Portion of `generalInfluenceBonus` that may NOT be used to control
   * characters (`Σ max(0, value - controlLimit)` over in-play general-influence
   * modifiers). The full bonus still counts toward the player's unused general
   * influence for defensive hazard subtraction, but the character-control cap
   * is `effectiveGeneralInfluence - generalInfluenceControlPenalty`. Non-zero
   * only for cards like Truths of Doom (wh-108, +6 GI / control-limit 2).
   * Recomputed by recomputeDerived.
   */
  readonly generalInfluenceControlPenalty: number;
  /**
   * Absolute replacement for the base general-influence pool, set by an in-play
   * `stat-modifier` with `stat: "general-influence"` and `op: "set"`. When
   * present it substitutes for the number the pool would otherwise start from
   * (a Fallen-wizard avatar's printed white-hand number, or the base 20);
   * `generalInfluenceBonus` still applies on top of it.
   *
   * Non-undefined only while a Radagast Shapeshifter form (wh-112/115/116) is
   * on Radagast — "adopting the given attributes" replaces his printed general
   * influence rather than adjusting it. Recomputed by recomputeDerived.
   */
  readonly generalInfluenceOverride?: number;
  /**
   * Number of times this player's play deck has been exhausted (reshuffled from discard).
   * The game ends via Free Council when a player exhausts their deck twice.
   */
  readonly deckExhaustionCount: number;
  /** Whether this player has called the Free Council (endgame trigger). */
  readonly freeCouncilCalled: boolean;
  /** The result of this player's most recent dice roll, or null before the first roll. */
  readonly lastDiceRoll: TwoDiceSix | null;
  /**
   * Whether this player accessed the sideboard during the current turn's
   * untap phase. Used to halve the hazard limit when this player is the
   * hazard player during the opponent's M/H phase. Reset at the start of
   * each untap phase.
   */
  readonly sideboardAccessedDuringUntap: boolean;
  /**
   * Whether this player is in the deck exhaustion exchange sub-flow.
   * Set to true when deck-exhaust is executed; cleared when the player
   * passes to complete the reshuffle. During this sub-flow, only
   * exchange-sideboard and pass actions are legal.
   */
  readonly deckExhaustPending: boolean;
  /**
   * How many cards have been exchanged between discard and sideboard
   * during the current deck exhaustion. Maximum 5.
   */
  readonly deckExhaustExchangeCount: number;
  /**
   * When a Ringwraith avatar fails a body check with an unmodified roll of
   * exactly 7 or 8 (MELE §8.R1), the Ringwraith is returned to hand rather
   * than eliminated. This field records the definition ID of the Ringwraith
   * that was returned.
   *
   * While set:
   * - This player may not reveal a *different* Ringwraith.
   * - The opponent may not reveal this same Ringwraith.
   *
   * Cleared when the returned Ringwraith is re-played.
   */
  readonly ringwraithReturnedToHand?: CardDefinitionId;
  /**
   * Creatures currently reserved by Summons from Long Sleep (as-39) cards in
   * cardsInPlay. Each entry links the reserved creature instance to the
   * permanent-event card that reserved it. Reserved creatures do not reside
   * in any normal zone (hand, deck, etc.) and are exempt from the hazard
   * limit while reserved.
   */
  readonly reservedCreatures: readonly {
    readonly sourceCardInstanceId: CardInstanceId;
    readonly creature: CardInstance;
  }[];
  /**
   * Site locations (by definitionId — "any version of this site", matching
   * the identity keying used elsewhere for this card family, e.g.
   * `CardInPlay.attachedToSite`) where this player has, at some point in the
   * game, successfully played a faction. Set once and never cleared — unlike
   * `SitePhaseState.factionPlayedThisSitePhase`, which only reflects the
   * *current* site-phase visit. Consulted by the `company-context`
   * play-condition (`company.playedFactionHere`) for No Strangers at this
   * Time (as-51): "Playable during the site phase … if you have played a
   * faction there" is a persistent fact about the site, not scoped to the
   * same visit as the faction play.
   */
  readonly factionsPlayedAtSites?: Readonly<Record<CardDefinitionId, true>>;
}
