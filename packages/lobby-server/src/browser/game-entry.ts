/**
 * @module game-entry
 *
 * Entry point for the game bundle. Imports all game-specific modules and
 * wires them into the `window.__meccg` cross-bundle namespace so the lobby
 * bundle can call into the game without a direct compile-time dependency.
 *
 * This module runs when `game-bundle.js` is injected by `lazy-load.ts`.
 * By that point, `bundle.js` has already run and `window.__meccg` is
 * populated with `appState`, `cardPool`, `showScreen`, and `connectLobbyWs`.
 */

import type { ClientMessage } from '@meccg/shared';
import { cardImageProxyPath } from '@meccg/shared';
import {
  appState, cardPool,
  VIEW_KEY, DEV_MODE_KEY, AUTO_PASS_KEY,
} from './app-state.js';
import { connect, disconnect, resetVisualBoard, setLobbyCallbacks } from './game-connection.js';
import { connectPseudoAi } from './pseudo-ai.js';
import { resetCompanyViews } from './company-view.js';
import { clearDice, restoreDice } from './dice.js';
import { installKeyboardShortcuts } from './keyboard-shortcuts.js';
import { renderLog } from './render-log.js';

// Import side-effect modules so esbuild includes them in this bundle.
import './render-board.js';
import './render-hand.js';
import './render-piles.js';
import './render-actions.js';
import './render-instructions.js';
import './render-selection-state.js';
import './render-chain.js';
import './render-card-preview.js';
import './render-player-names.js';
import './render-debug-panels.js';
import './render-game-over.js';
import './render-text-format.js';
import './render-utils.js';
import './combat-view.js';
import './company-block.js';
import './company-character.js';
import './company-modals.js';
import './company-site.js';
import './company-view-state.js';
import './company-views.js';
import './company-actions.js';
import './flip-animate.js';

// ---- Register lobby callbacks so game-connection can call back into lobby ----

const ns = window.__meccg!;
setLobbyCallbacks(
  (id) => ns.showScreen?.(id),
  () => ns.connectLobbyWs?.(),
);

// ---- Expose game functions on window.__meccg ----

ns.connect = connect;
ns.disconnect = disconnect;
ns.resetVisualBoard = resetVisualBoard;
ns.resetCompanyViews = resetCompanyViews;
ns.connectPseudoAi = connectPseudoAi;
ns.clearDice = clearDice;
ns.restoreDice = restoreDice;

// ---- DOM event handler setup ----
// Called at module load time (after DOMContentLoaded has already fired).

installKeyboardShortcuts();

const viewToggleBtn = document.getElementById('view-toggle-btn') as HTMLButtonElement;
const debugView = document.getElementById('debug-view') as HTMLElement;
const visualView = document.getElementById('visual-view') as HTMLElement;
const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
const reseedBtn = document.getElementById('reseed-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const cheatRollSelect = document.getElementById('cheat-roll-select') as HTMLSelectElement;
const summonBtn = document.getElementById('summon-btn') as HTMLButtonElement;
const swapHandBtn = document.getElementById('swap-hand-btn') as HTMLButtonElement;
const devMenuBtn = document.getElementById('dev-menu-btn') as HTMLButtonElement;
const devMenuPopup = document.getElementById('dev-menu-popup') as HTMLElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const settingsModal = document.getElementById('settings-modal') as HTMLElement;
const settingsBackdrop = document.getElementById('settings-backdrop') as HTMLElement;
const settingsCloseBtn = document.getElementById('settings-close-btn') as HTMLButtonElement;
const devModeToggle = document.getElementById('dev-mode-toggle') as HTMLInputElement;
const autoPassToggle = document.getElementById('auto-pass-toggle') as HTMLInputElement;
const snapshotBtn = document.getElementById('snapshot-btn') as HTMLButtonElement;
const snapshotModal = document.getElementById('snapshot-modal') as HTMLElement;
const snapshotBackdrop = document.getElementById('snapshot-backdrop') as HTMLElement;
const snapshotList = document.getElementById('snapshot-list') as HTMLElement;
const SERVER_DEV = window.__MECCG_DEV === true;

/** Flash a button to confirm the action was triggered. */
function flashBtn(btn: HTMLElement): void {
  btn.classList.remove('btn-flash');
  void btn.offsetWidth;
  btn.classList.add('btn-flash');
}

function setViewMode(visual: boolean): void {
  debugView.classList.toggle('hidden', visual);
  visualView.classList.toggle('hidden', !visual);
  document.getElementById('game-log-panel')?.classList.toggle('hidden', !visual);
  viewToggleBtn.classList.toggle('mode-visual', visual);
  viewToggleBtn.classList.toggle('mode-debug', !visual);
  viewToggleBtn.title = visual ? 'Switch to debug view' : 'Switch to visual view';
  localStorage.setItem(VIEW_KEY, visual ? 'visual' : 'debug');
  if (!visual) {
    const log = document.getElementById('log')!;
    log.scrollTop = log.scrollHeight;
    clearDice();
  } else {
    restoreDice();
  }
}

function applyDevMode(on: boolean): void {
  viewToggleBtn.style.display = on ? '' : 'none';
  devMenuBtn.style.display = on ? '' : 'none';
  if (!on) {
    closeDevMenu();
    setViewMode(true);
  }
}

function closeDevMenu(): void {
  devMenuPopup.classList.add('hidden');
}

function closeSettings(): void {
  settingsModal.classList.add('hidden');
}

/** Clear all visual game state immediately (before server responds). */
export function clearGameBoard(): void {
  resetVisualBoard();
  document.getElementById('hand-arc')!.innerHTML = '';
  document.getElementById('opponent-arc')!.innerHTML = '';
  document.getElementById('actions')!.innerHTML = '';
  document.getElementById('pass-btn')!.classList.add('hidden');
  const chainPanel = document.getElementById('chain-panel');
  if (chainPanel) { chainPanel.classList.add('hidden'); chainPanel.innerHTML = ''; }
  for (const id of ['self-deck-box', 'opponent-deck-box']) {
    document.getElementById(id)?.classList.add('hidden');
  }
  const pseudoPanel = document.getElementById('pseudo-ai-panel');
  if (pseudoPanel) {
    pseudoPanel.classList.add('hidden');
    pseudoPanel.classList.remove('minimized');
    document.getElementById('pseudo-ai-actions')!.innerHTML = '';
  }
  resetCompanyViews();
  clearDice();
}

ns.clearGameBoard = clearGameBoard;

// Restore saved view mode
if (localStorage.getItem(VIEW_KEY) !== 'debug') {
  setViewMode(true);
}

viewToggleBtn.addEventListener('click', () => {
  setViewMode(!debugView.classList.contains('hidden'));
});

const pseudoAiMinimizeBtn = document.getElementById('pseudo-ai-minimize-btn');
if (pseudoAiMinimizeBtn) {
  pseudoAiMinimizeBtn.addEventListener('click', () => {
    const panel = document.getElementById('pseudo-ai-panel')!;
    const minimized = panel.classList.toggle('minimized');
    pseudoAiMinimizeBtn.textContent = minimized ? '□' : '_';
    pseudoAiMinimizeBtn.title = minimized ? 'Restore' : 'Minimize';
  });
}

disconnectBtn.addEventListener('click', () => {
  disconnect();
});

undoBtn.addEventListener('click', () => {
  if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
    const msg: ClientMessage = { type: 'undo' };
    appState.ws.send(JSON.stringify(msg));
    const logEl = document.getElementById('log');
    if (logEl && appState.logCountStack.length > 0) {
      const target = appState.logCountStack.pop()!;
      while (logEl.childElementCount > target) {
        logEl.removeChild(logEl.lastChild!);
      }
    }
    flashBtn(undoBtn);
  }
});

saveBtn.addEventListener('click', () => {
  if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
    const msg: ClientMessage = { type: 'save' };
    appState.ws.send(JSON.stringify(msg));
    flashBtn(saveBtn);
  }
});

reseedBtn.addEventListener('click', () => {
  if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
    const msg: ClientMessage = { type: 'reseed' };
    appState.ws.send(JSON.stringify(msg));
    flashBtn(reseedBtn);
  }
});

cheatRollSelect.addEventListener('change', () => {
  const total = parseInt(cheatRollSelect.value, 10);
  if (appState.ws && appState.ws.readyState === WebSocket.OPEN && total >= 2 && total <= 12) {
    const msg: ClientMessage = { type: 'cheat-roll', total };
    appState.ws.send(JSON.stringify(msg));
    renderLog(`>> Cheat: next roll will be ${total}`, cardPool);
  }
  cheatRollSelect.value = '';
});

summonBtn.addEventListener('click', () => {
  const cardName = prompt('Enter card name to summon:');
  if (cardName && appState.ws && appState.ws.readyState === WebSocket.OPEN) {
    const msg: ClientMessage = { type: 'summon-card', cardName };
    appState.ws.send(JSON.stringify(msg));
    renderLog(`>> Cheat: summoning "${cardName}"`, cardPool);
    flashBtn(summonBtn);
  }
});

swapHandBtn.addEventListener('click', () => {
  if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
    const msg: ClientMessage = { type: 'swap-hand' };
    appState.ws.send(JSON.stringify(msg));
    renderLog('>> Cheat: swapping hands', cardPool);
    flashBtn(swapHandBtn);
  }
});

loadBtn.addEventListener('click', () => {
  if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
    const msg: ClientMessage = { type: 'load' };
    appState.ws.send(JSON.stringify(msg));
    flashBtn(loadBtn);
    clearGameBoard();
  }
});

resetBtn.addEventListener('click', () => {
  if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
    const msg: ClientMessage = { type: 'reset' };
    appState.ws.send(JSON.stringify(msg));
    flashBtn(resetBtn);
    clearGameBoard();
  }
});

snapshotBtn.addEventListener('click', () => {
  void (async () => {
    try {
      const resp = await fetch('/api/snapshots');
      const snapshots = await resp.json() as { file: string; description: string; character?: string; site?: string }[];
      snapshotList.innerHTML = '';
      if (snapshots.length === 0) {
        snapshotList.textContent = 'No snapshots available.';
      } else {
        for (const snap of snapshots) {
          const item = document.createElement('div');
          item.className = 'snapshot-item';
          const images = document.createElement('div');
          images.className = 'snapshot-item-images';
          for (const defId of [snap.character, snap.site]) {
            if (!defId) continue;
            const def = cardPool[defId];
            const imgPath = def ? cardImageProxyPath(def) : undefined;
            if (imgPath) {
              const img = document.createElement('img');
              img.src = imgPath;
              img.alt = def.name;
              images.appendChild(img);
            }
          }
          if (images.childElementCount > 0) item.appendChild(images);
          const name = document.createElement('div');
          name.className = 'snapshot-item-name';
          name.textContent = snap.file;
          const desc = document.createElement('div');
          desc.className = 'snapshot-item-desc';
          desc.textContent = snap.description;
          item.appendChild(name);
          item.appendChild(desc);
          item.addEventListener('click', () => {
            if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
              const msg: ClientMessage = { type: 'load-snapshot', file: snap.file };
              appState.ws.send(JSON.stringify(msg));
              clearGameBoard();
            }
            snapshotModal.classList.add('hidden');
          });
          snapshotList.appendChild(item);
        }
      }
      snapshotModal.classList.remove('hidden');
    } catch {
      renderLog('Failed to fetch snapshot list');
    }
  })();
});

snapshotBackdrop.addEventListener('click', () => {
  snapshotModal.classList.add('hidden');
});

devMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  devMenuPopup.classList.toggle('hidden');
});

devMenuPopup.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('button')) closeDevMenu();
});

document.addEventListener('click', (e) => {
  if (devMenuPopup.classList.contains('hidden')) return;
  const target = e.target as HTMLElement;
  if (devMenuPopup.contains(target) || devMenuBtn.contains(target)) return;
  closeDevMenu();
});

if (!SERVER_DEV) {
  const devToggleLabel = devModeToggle.closest<HTMLElement>('.settings-toggle');
  if (devToggleLabel) devToggleLabel.style.display = 'none';
  const devHint = devToggleLabel?.nextElementSibling as HTMLElement | null;
  if (devHint?.classList.contains('settings-hint')) devHint.style.display = 'none';
  applyDevMode(false);
} else {
  devModeToggle.checked = localStorage.getItem(DEV_MODE_KEY) === 'true';
  applyDevMode(devModeToggle.checked);
}

settingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
});

settingsBackdrop.addEventListener('click', closeSettings);
settingsCloseBtn.addEventListener('click', closeSettings);

devModeToggle.addEventListener('change', () => {
  if (!SERVER_DEV) return;
  localStorage.setItem(DEV_MODE_KEY, String(devModeToggle.checked));
  applyDevMode(devModeToggle.checked);
});

autoPassToggle.checked = localStorage.getItem(AUTO_PASS_KEY) === 'true';

autoPassToggle.addEventListener('change', () => {
  localStorage.setItem(AUTO_PASS_KEY, String(autoPassToggle.checked));
  if (!autoPassToggle.checked && appState.autoPassTimer) {
    clearTimeout(appState.autoPassTimer);
    appState.autoPassTimer = null;
  }
});
