/**
 * @module format
 *
 * Single text-based renderer for game state. Outputs plain text,
 * YAML-like indented text showing players, companies, characters, items,
 * combat, and events.
 *
 * This module re-exports all formatting functions from the focused
 * sub-modules: {@link format-helpers}, {@link format-cards},
 * {@link format-state}, and {@link format-actions}.
 *
 * There is ONE rendering function: {@link renderState} (internal).
 * Public entry points are {@link formatGameState} and {@link formatPlayerView}.
 *
 * Convenience wrappers {@link formatGameState} and {@link formatPlayerView}
 * adapt the engine's data structures into the renderer's input shape.
 */

// Re-export everything from sub-modules so existing imports continue to work.

export { formatSignedNumber, stripCardMarkers, CARD_TYPE_CSS, getCardCss } from './format-helpers.js';
export { formatCardName, formatCardList, formatDefName } from './format-cards.js';
export { buildInstanceLookup, formatGameState, formatPlayerView } from './format-state.js';
export { describeAction, extractActionCardDefs, getTitleCharacter, buildCompanyNames } from './format-actions.js';
