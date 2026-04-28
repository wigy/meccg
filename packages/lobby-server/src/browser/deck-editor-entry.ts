/**
 * @module deck-editor-entry
 *
 * Entry point for the deck-editor bundle. Wires the deck browser (lobby
 * decks screen) and the full deck editor into `window.__meccg` so the
 * lobby bundle can trigger them without a direct compile-time dependency.
 *
 * This module runs when `deck-editor-bundle.js` is injected by `lazy-load.ts`.
 * By that point `window.__meccg` is already populated by the lobby bundle.
 */

import { loadDecks, setDeckBrowserCallbacks } from './deck-browser.js';
import { openNewDeckEditor, setNewEditorCallbacks } from './deck-editor-new.js';
import { setupDecksPreview } from './deck-editor.js';

const ns = window.__meccg!;

// Wire showScreen into the new editor.
setNewEditorCallbacks((id) => ns.showScreen?.(id));

// Wire openDeckEditor into the deck browser so "Edit" buttons work.
setDeckBrowserCallbacks(openNewDeckEditor);

// Set up hover card previews on the decks overview screen.
setupDecksPreview();

// Expose functions for the lobby bundle to call.
ns.loadDecks = loadDecks;
ns.openDeckEditor = openNewDeckEditor;
