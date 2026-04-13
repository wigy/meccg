/**
 * @module render
 *
 * Re-export hub for all DOM rendering functions used by the web client.
 * This module was split into focused sub-modules for maintainability.
 * External consumers (app.ts, company-view.ts) import from this file
 * to get the same public API as before the split.
 */

// Selection state (used by company-view.ts and hand rendering)
export {
  setTargetingInstruction,
  getSelectedCharacterForPlay,
  clearCharacterPlaySelection,
  getSelectedFactionForInfluence,
  clearFactionInfluenceSelection,
  getSelectedResourceForPlay,
  clearResourcePlaySelection,
  getSelectedAllyForPlay,
  clearAllyPlaySelection,
  getSelectedHazardForPlay,
  getSelectedHazardOnGuardAction,
  clearHazardPlaySelection,
  getSelectedInfluencerForOpponent,
  setSelectedInfluencerForOpponent,
  clearOpponentInfluenceSelection,
  getSelectedShortEvent,
  clearShortEventSelection,
} from './render-selection-state.js';

// Debug/text view panels
export { renderState, renderDraft, renderMHInfo, renderSiteInfo, renderFreeCouncilInfo } from './render-debug-panels.js';

// Game over scoring table
export { renderGameOverView } from './render-game-over.js';

// Action button panel
export { renderActions } from './render-actions.js';

// Player names, scores, GI
export { renderPlayerNames } from './render-player-names.js';

// Deck piles and pile browser
export { renderDeckPiles, resetDeckPiles, prepareSiteSelection, openMovementViewer, prepareFetchFromPile, closeSelectionViewer, clearSelectionState, clearSiteSelection } from './render-piles.js';

// Instructions and pass button
export { renderInstructions, renderPassButton } from './render-instructions.js';

// Card preview and attributes
export { setupCardPreview, buildCardAttributes } from './render-card-preview.js';

// Board (drafted characters, companies during setup)
export { renderDrafted } from './render-board.js';

// Hand arcs
export { renderHand, renderOpponentHand } from './render-hand.js';

// Chain of effects panel
export { renderChainPanel } from './render-chain.js';

// Log and notifications
export { renderLog, showNotification } from './render-log.js';
