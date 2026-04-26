/**
 * @module deck-editor-entry
 *
 * Entry point for the deck-editor bundle. Imports deck browser and editor
 * modules and wires them into the `window.__meccg` cross-bundle namespace
 * so the lobby bundle can trigger deck operations without a direct
 * compile-time dependency.
 *
 * This module runs when `deck-editor-bundle.js` is injected by `lazy-load.ts`.
 * By that point, `bundle.js` has already run and `window.__meccg` is
 * populated with `appState`, `cardPool`, `showScreen`, and `connectLobbyWs`.
 */

import { loadDecks, setDeckBrowserCallbacks } from './deck-browser.js';
import { openDeckEditor, setDeckEditorCallbacks, setupDeckEditorPreview, setupDecksPreview } from './deck-editor.js';

const ns = window.__meccg!;

// Wire showScreen callback so deck editor can navigate back to the decks screen.
setDeckEditorCallbacks((id) => ns.showScreen?.(id));

// Wire openDeckEditor callback so deck browser can open the editor.
setDeckBrowserCallbacks(openDeckEditor);

// Set up hover card previews for both the decks screen and deck editor.
setupDeckEditorPreview();
setupDecksPreview();

// Expose functions for the lobby bundle to call.
ns.loadDecks = loadDecks;
ns.openDeckEditor = openDeckEditor;
