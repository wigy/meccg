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
} from './common.js';
import { CardDefinition } from './cards.js';
import type { GameAction } from './actions.js';

// Re-export everything from sub-modules
export * from './state-cards.js';
export * from './state-player.js';
export * from './state-phases.js';
export * from './state-combat.js';

// Import types needed for GameState
import type { PlayerState } from './state-player.js';
import type { PhaseState } from './state-phases.js';
import type { CombatState, ChainState, PendingEffect } from './state-combat.js';

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
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** Current turn number (1-based), incremented each time the active player changes. */
  readonly turnNumber: number;
  /** The player who won the initiative roll and took the first turn. Null during setup before the roll. */
  readonly startingPlayer: PlayerId | null;
  /** Queue of effects waiting to be resolved before the game can proceed. */
  readonly pendingEffects: readonly PendingEffect[];
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
}

// ---- Instance resolution helpers ----

/** All pile names on PlayerState that store CardInstance arrays. */
const PILE_NAMES = [
  'hand', 'playDeck', 'discardPile', 'siteDeck', 'siteDiscardPile',
  'sideboard', 'killPile', 'eliminatedPile',
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
  for (const player of state.players) {
    // Characters (Record keyed by instanceId — O(1))
    const char = player.characters[instanceId as string];
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

    // Piles
    for (const pileName of PILE_NAMES) {
      const pile = player[pileName];
      for (const card of pile) {
        if (card.instanceId === instanceId) return card.definitionId;
      }
    }
  }


  // Cards on the chain of effects
  if (state.chain) {
    for (const entry of state.chain.entries) {
      if (entry.card?.instanceId === instanceId) return entry.card.definitionId;
    }
  }

  return undefined;
}
