/**
 * @module actions-long-event
 *
 * Action type for playing long-event resource cards.
 *
 * Resource long-events remain in play for one full turn cycle and provide
 * ongoing effects during that period, then are automatically discarded.
 */

import type { PlayerId, CardInstanceId } from './common.js';

/**
 * Play a resource long-event card from hand during the Long-event phase.
 *
 * Resource long-events can only be played during the long-event phase.
 * They remain in play for one full turn cycle (one of your turns and one
 * of your opponent's turns), then are discarded at the beginning of your
 * next long-event phase.
 */
export interface PlayLongEventAction {
  readonly type: 'play-long-event';
  /** The player playing the long-event. */
  readonly player: PlayerId;
  /** The long-event card instance to play from hand. */
  readonly cardInstanceId: CardInstanceId;
}
