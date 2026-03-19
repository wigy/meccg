/**
 * @module ai/strategy
 *
 * Interface for AI strategies. Each strategy implements a single method
 * that picks an action from the list of legal actions. New strategies
 * can be added by creating a new file in this directory and registering
 * it in the strategy loader.
 */

import type { GameAction, PlayerView, CardDefinition } from '@meccg/shared';

/** The context provided to the AI for decision making. */
export interface AiContext {
  /** The current game view from this player's perspective. */
  readonly view: PlayerView;
  /** The card pool for resolving card definitions. */
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** All legal actions available this turn. */
  readonly legalActions: readonly GameAction[];
}

/** An AI strategy picks one action from the available legal actions. */
export interface AiStrategy {
  /** Human-readable name of this strategy. */
  readonly name: string;
  /** Select an action to play. */
  pickAction(context: AiContext): GameAction;
}
