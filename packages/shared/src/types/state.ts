/**
 * @module state
 *
 * Runtime game state types for the MECCG engine.
 *
 * The server maintains a single authoritative `GameState` object that is
 * updated purely via a reducer: `(state, action) -> state`. This module
 * re-exports all state types from their sub-modules and defines the
 * top-level GameState interface plus instance resolution helpers.
 *
 * Sub-modules:
 * - {@link module:state-cards} — Card instances, characters, companies, events, MPs
 * - {@link module:state-player} — Per-player state
 * - {@link module:state-phases} — Phase enums and phase-specific state
 * - {@link module:state-combat} — Combat, chain, and pending effects
 */

import {
  PlayerId,
  CardInstanceId,
  CardDefinitionId,
  ById,
  ByCardDefinitionId,
} from './common.js';
import { CardDefinition } from './cards.js';
import type { GameAction } from './actions.js';

// Re-export everything from sub-modules
export * from './state-agents.js';
export * from './state-cards.js';
export * from './state-player.js';
export * from './state-phases.js';
export * from './state-combat.js';

// Import types needed for GameState
import type { PlayerState } from './state-player.js';
import type { PhaseState } from './state-phases.js';
import { Phase, SetupStep } from './state-phases.js';
import type { CombatState, ChainState, PendingEffect } from './state-combat.js';
import type { PendingResolution, ActiveConstraint } from './pending.js';

// ---- Hazard Hosts (Rule 8.35 — Prisoners) ----

/**
 * A hazard host is a hazard permanent-event with a `take-prisoner` effect.
 * When the strike it is played on succeeds, the targeted character is taken
 * prisoner at the rescue site drawn from the hazard player's location deck.
 *
 * The host card and rescue site card remain as part of this record for the
 * lifetime of the imprisonment. Prisoner characters stay in
 * `player.characters` (the "no card disappears" invariant is preserved) and
 * gain a `character-is-prisoner` active constraint pointing back here.
 *
 * Rule 8.35 / 8.36 — CoE Rules.
 */
export interface HazardHost {
  /** The hazard permanent-event card instance (stays here — does not disappear). */
  readonly hostCard: import('./state-cards.js').CardInstance;
  /** The rescue site card instance (drawn from the hazard player's location deck). */
  readonly rescueSiteCard: import('./state-cards.js').CardInstance;
  /** Instance IDs of characters currently held prisoner by this host. */
  readonly prisoners: readonly CardInstanceId[];
  /** PlayerId of the hazard player who controls this host. */
  readonly ownedBy: PlayerId;
}

// ---- RNG ----

/**
 * Deterministic random number generator state.
 *
 * Using a seeded PRNG ensures that dice rolls and shuffles are reproducible
 * for replays, debugging, and testing. The counter increments with each
 * random number consumed.
 */
export interface RngState {
  /** The initial seed value for the PRNG algorithm. */
  readonly seed: number;
  /** Number of random values consumed so far (used to advance the PRNG sequence). */
  readonly counter: number;
}

// ---- Full Game State ----

/**
 * The complete, authoritative game state maintained by the server.
 *
 * This is the single source of truth for the entire game. The engine is a
 * pure reducer: `(GameState, GameAction) -> GameState`. The state includes
 * all hidden information (both players' hands, deck contents, etc.) and is
 * never sent directly to clients -- instead, a projection function produces
 * a per-player `PlayerView` with hidden information redacted.
 */
export interface GameState {
  /** Unique identifier for this game session, shared with all clients. */
  readonly gameId: string;
  /** Both players' complete state, as a fixed-size tuple. */
  readonly players: readonly [PlayerState, PlayerState];
  /** The player whose turn it currently is, or null during simultaneous phases (e.g. character draft). */
  readonly activePlayer: PlayerId | null;
  /** The current phase and its phase-specific bookkeeping state. */
  readonly phaseState: PhaseState;
  /**
   * Active combat sub-state, or null when no combat is in progress.
   * Combat is phase-independent: it can be triggered during Movement/Hazard
   * (creature hazards) or Site phase (automatic attacks, on-guard creatures,
   * agent attacks). When non-null, combat actions take priority over the
   * enclosing phase's normal actions.
   */
  readonly combat: CombatState | null;
  /**
   * Active chain of effects sub-state, or null when no chain is in progress.
   * The chain is phase-independent: it layers on top of any phase where cards
   * can be played. When non-null, chain actions take priority over both combat
   * and the enclosing phase's normal actions.
   */
  readonly chain: ChainState | null;
  /** The static card definition pool, keyed by CardDefinitionId. Loaded once at game start. */
  readonly cardPool: ByCardDefinitionId<CardDefinition>;
  /** Current turn number (1-based), incremented each time the active player changes. */
  readonly turnNumber: number;
  /** The player who won the initiative roll and took the first turn. Null during setup before the roll. */
  readonly startingPlayer: PlayerId | null;
  /** Queue of effects waiting to be resolved before the game can proceed. */
  readonly pendingEffects: readonly PendingEffect[];
  /**
   * Discrete pieces of work the engine has queued for the players to
   * resolve before continuing (Shape A — see `engine/pending.ts`).
   * Replaces the per-phase ad-hoc `pending*` fields. While any entry
   * targets the actor of an incoming action, only resolution actions
   * are legal for that actor. Drains FIFO per actor and is swept
   * automatically at scope boundaries.
   */
  readonly pendingResolutions: readonly PendingResolution[];
  /**
   * Scoped restrictions on the legal-action menu of some target
   * (company, character, or player) — see `engine/pending.ts`.
   * Filters but never blocks; auto-clears at the matching scope
   * boundary. Used by River, Lost in Free-domains, Stealth, and
   * future modal-restriction cards.
   */
  readonly activeConstraints: readonly ActiveConstraint[];
  /**
   * Active hazard hosts — hazard permanent-events with a `take-prisoner`
   * effect that are currently holding one or more characters prisoner.
   * Each entry records the host card, the rescue site, and the prisoner
   * character instance IDs. Prisoners remain in `player.characters` for
   * the invariant that no card instance ever disappears.
   *
   * Rule 8.35 / 8.36 — CoE Rules.
   */
  readonly hazardHosts: readonly HazardHost[];
  /**
   * Card **names** that have permanently claimed their card's once-per-game
   * "no other copy may do this" lock (`grant-action` with `singletonLock`).
   *
   * Pass the Doors of Dol Guldur (dm-154) ends "Once tapped, no other copy of
   * this card can be tapped." The restriction outlives the copy that claimed
   * it — that copy is later *stored*, leaving `cardsInPlay` for the
   * marshalling-point pile — so it cannot be derived from any card's current
   * status and is instead recorded here, never cleared. Keyed by name (not
   * instance) so copies from different printings of the same card share one
   * lock, mirroring how `duplication-limit` scope `game` counts by name.
   *
   * Absent on states built before the field existed; treat as empty.
   */
  readonly singletonTapLocks?: readonly string[];
  /** Deterministic RNG state for reproducible dice rolls and shuffles. */
  readonly rng: RngState;
  /** Monotonically increasing sequence number for state changes, used for log replay. */
  readonly stateSeq: number;
  /**
   * Reverse actions accumulated during the current phase. Each time a player
   * takes an organization action, the engine computes the action(s) that would
   * undo it and appends them here. Cleared automatically at every phase transition.
   * Used by legal-action computation to mark regressive (undo) actions.
   */
  readonly reverseActions: readonly GameAction[];
  /**
   * Tracks who gets one more turn after a player calls the Free Council.
   * Null means no call has been made. When set, the identified player gets
   * their final turn before the game transitions to the Free Council phase.
   */
  readonly lastTurnFor: PlayerId | null;
  /**
   * Dev-only: when set, the next dice roll will produce this total (2-12)
   * instead of using the RNG. The individual dice are randomly split to
   * sum to the target. Consumed (reset to null) after one roll.
   */
  readonly cheatRollTotal: number | null;
  /**
   * When true, play decks are never shuffled: the deck order supplied in the
   * game config is the literal draw order (index 0 = top of the deck). Both
   * the pre-draft shuffle at game creation and the `shuffle-play-deck` setup
   * step become order-preserving no-ops. Used by scripted games — the guided
   * tutorial — where the script must know every card drawn at every step.
   * Absent/false in normal games.
   */
  readonly orderedDecks?: boolean;
  /**
   * True once any developer-tools (debug menu) command has been used in
   * this game. A cheated game is played out normally, but its end result
   * is never recorded — neither to the per-game statistics record nor to
   * any player's game history. Once set the flag is never cleared.
   */
  readonly cheated: boolean;
  /**
   * Identities (instanceId → definitionId) of every card instance whose
   * definition has become publicly known at some point during the game.
   *
   * A card enters this map automatically when it lands in a location
   * classified as public to the opponent (e.g. `cardsInPlay`, the chain,
   * a company site, a revealed on-guard slot, the post-draft `drafted`
   * list). Once in the map the entry persists even if the instance later
   * moves back into a private pile (e.g. a played short event ends up
   * face-down in its owner's discard): the opponent already saw the
   * identity, so it remains part of the public record.
   *
   * Consumed by {@link extractActionCardDefs} to decide which identities
   * from a just-applied action may be named in the opponent's toast / log.
   * If an instance is absent from this map, its identity is private and
   * the audience sees "a card" instead of the real name.
   *
   * Maintained as a single choke-point in the reducer's post-pass — no
   * per-reducer-path instrumentation is required.
   */
  readonly revealedInstances: ById<CardDefinitionId>;
}

// ---- Instance resolution helpers ----

/** All pile names on PlayerState that store CardInstance arrays. */
const PILE_NAMES = [
  'hand', 'playDeck', 'discardPile', 'siteDeck', 'siteDiscardPile',
  'sideboard', 'killPile', 'outOfPlayPile',
] as const;

/**
 * Resolves a {@link CardInstanceId} to its {@link CardDefinitionId} by
 * searching all piles, in-play cards, characters, items, allies, and events.
 *
 * This replaces the old `state.instanceMap` lookup. It searches in-play
 * structures first (O(1) character lookup) then falls through to piles.
 *
 * @returns The definition ID, or undefined if the instance ID is not found.
 */
export function resolveInstanceId(state: GameState, instanceId: CardInstanceId): CardDefinitionId | undefined {
  // Callers legitimately pass an optional field that is absent. Without this
  // guard `company.currentSite?.instanceId === instanceId` is `undefined ===
  // undefined` for a company with no site — the lookup "matches" a null site
  // and the next expression dereferences it.
  if (instanceId === undefined || instanceId === null) return undefined;
  for (const player of state.players) {
    // Characters (Record keyed by instanceId — O(1))
    const char = player.characters[instanceId];
    if (char) return char.definitionId;

    // Items, allies, hazards on characters
    for (const ch of Object.values(player.characters)) {
      for (const item of ch.items) {
        if (item.instanceId === instanceId) return item.definitionId;
      }
      for (const ally of ch.allies) {
        if (ally.instanceId === instanceId) return ally.definitionId;
      }
      for (const hazard of ch.hazards) {
        if (hazard.instanceId === instanceId) return hazard.definitionId;
      }
      // Creatures taken as trophies (MELE §8.37) live only here once taken.
      for (const trophy of ch.trophies ?? []) {
        if (trophy.instanceId === instanceId) return trophy.definitionId;
      }
    }

    // General cards in play
    for (const card of player.cardsInPlay) {
      if (card.instanceId === instanceId) return card.definitionId;
    }

    // Company sites and on-guard cards
    for (const company of player.companies) {
      if (company.currentSite?.instanceId === instanceId) return company.currentSite.definitionId;
      if (company.destinationSite?.instanceId === instanceId) return company.destinationSite.definitionId;
      for (const card of company.onGuardCards) {
        if (card.instanceId === instanceId) return card.definitionId;
      }
      for (const hazard of company.hazards) {
        if (hazard.instanceId === instanceId) return hazard.definitionId;
      }
    }

    // Agent characters and their site stacks
    for (const agent of player.agents) {
      if (agent.character.instanceId === instanceId) return agent.character.definitionId;
      for (const item of agent.character.items) {
        if (item.instanceId === instanceId) return item.definitionId;
      }
      for (const ally of agent.character.allies) {
        if (ally.instanceId === instanceId) return ally.definitionId;
      }
      for (const hazard of agent.character.hazards) {
        if (hazard.instanceId === instanceId) return hazard.definitionId;
      }
      for (const trophy of agent.character.trophies ?? []) {
        if (trophy.instanceId === instanceId) return trophy.definitionId;
      }
      for (const site of agent.siteStack) {
        if (site.instanceId === instanceId) return site.definitionId;
      }
    }

    // Piles
    for (const pileName of PILE_NAMES) {
      const pile = player[pileName];
      for (const card of pile) {
        if (card.instanceId === instanceId) return card.definitionId;
      }
    }

    // Reserved creatures (Summons from Long Sleep / as-39)
    for (const r of player.reservedCreatures) {
      if (r.creature.instanceId === instanceId) return r.creature.definitionId;
    }
  }


  // Cards on the chain of effects
  if (state.chain) {
    for (const entry of state.chain.entries) {
      if (entry.card?.instanceId === instanceId) return entry.card.definitionId;
    }
  }

  // Hazard hosts (prisoner-holding cards: Troll-purse dm-95, etc.). The host
  // card and its rescue-site reference live only here while the host is active.
  // (`prisoners` are instance-id references to characters held elsewhere.)
  for (const host of state.hazardHosts) {
    if (host.hostCard.instanceId === instanceId) return host.hostCard.definitionId;
    if (host.rescueSiteCard.instanceId === instanceId) return host.rescueSiteCard.definitionId;
  }

  // Setup-phase draft zones: cards minted into draft pools / drafted lists /
  // set-aside / site selection live in phaseState until the draft is finalized.
  if (state.phaseState.phase === Phase.Setup) {
    const step = state.phaseState.setupStep;
    const find = (
      cards: readonly { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId }[],
    ): CardDefinitionId | undefined => {
      for (const c of cards) {
        if (c.instanceId === instanceId) return c.definitionId;
      }
      return undefined;
    };
    if (step.step === SetupStep.CharacterDraft) {
      for (const ds of step.draftState) {
        const r = find(ds.pool) ?? find(ds.drafted) ?? find(ds.draftedStageResources)
          ?? (ds.currentPick ? find([ds.currentPick]) : undefined);
        if (r) return r;
      }
      for (const arr of step.setAside) {
        const r = find(arr);
        if (r) return r;
      }
    } else if (step.step === SetupStep.ItemDraft) {
      for (const ids of step.itemDraftState) {
        const r = find(ids.unassignedItems);
        if (r) return r;
      }
      for (const pool of step.remainingPool) {
        const r = find(pool);
        if (r) return r;
      }
    } else if (step.step === SetupStep.CharacterDeckDraft) {
      for (const dds of step.deckDraftState) {
        const r = find(dds.remainingPool);
        if (r) return r;
      }
    } else if (step.step === SetupStep.StartingSiteSelection) {
      for (const ss of step.siteSelectionState) {
        const r = find(ss.selectedSites);
        if (r) return r;
      }
    }
  }

  return undefined;
}

/**
 * Returns the {@link PlayerId} that owns a card instance.
 *
 * Every instance ID is minted as `<playerId>-<counter>` (see `engine/init.ts`),
 * so deck-ownership is encoded in the prefix and derivable in O(1) without
 * any state lookup. Deck-ownership never transfers in MECCG — a hazard
 * played by player A against player B's company is physically located in B's
 * zones but its instance ID still belongs to A. This is exactly the
 * "who played it" attribution needed by rules like the Dragon manifestation
 * MP rule (defeating player earns MPs only if the manifestation was played
 * by the opponent).
 */
export function ownerOf(instanceId: CardInstanceId): PlayerId {
  const s = instanceId as string;
  const i = s.lastIndexOf('-');
  return s.slice(0, i) as PlayerId;
}
