/**
 * @module app
 *
 * Browser entry point for the MECCG web client. Connects to the
 * client-web server via WebSocket (which proxies to the game server),
 * renders game state, and sends actions on button click.
 *
 * Most logic has been extracted into focused modules:
 * - app-state: shared mutable state and constants
 * - session: game session persistence (save/restore/clear)
 * - pseudo-ai: pseudo-AI panel and second WebSocket
 * - game-connection: game server WebSocket, reconnection, rejoin
 * - deck-browser: deck listing, catalog, compact previews, CRUD
 * - deck-editor: deck editor rendering and card list
 * - inbox: mail inbox/sent UI
 * - lobby-screens: screen management, auth, lobby WS, init
 */

import type { ClientMessage } from '@meccg/shared';
import { cardImageProxyPath } from '@meccg/shared';
import {
  appState, cardPool, LOBBY_MODE, SERVER_DEV,
  VIEW_KEY, DEV_MODE_KEY, AUTO_PASS_KEY,
  VIEWING_INBOX_KEY, VIEWING_DECKS_KEY, VIEWING_CREDITS_KEY, EDITING_DECK_KEY,
  MAIL_TAB_KEY, MAIL_MSG_KEY,
} from './app-state.js';
import { savePlayerName, loadPlayerName } from './session.js';
import { connect, disconnect, resetVisualBoard } from './game-connection.js';
import { setDeckBrowserCallbacks } from './deck-browser.js';
import { setupDeckEditorPreview, setupDecksPreview, openDeckEditor, setDeckEditorCallbacks } from './deck-editor.js';
import { openInbox, openSent } from './inbox.js';
import { setInboxCallbacks } from './inbox.js';
import { openCreditsPage, setCreditsPageCallbacks } from './credits-page.js';
import { showAlert, showConfirm } from './dialog.js';
import {
  showScreen, showAuthError, applyBackground, selectRandomBackground,
  connectLobbyWs, initLobby, showAuthTab, selectRandomAuthHero,
} from './lobby-screens.js';
import { renderLog, setupCardPreview, showNotification } from './render.js';
import { resetCompanyViews } from './company-view.js';
import { clearDice, restoreDice } from './dice.js';
import { installKeyboardShortcuts } from './keyboard-shortcuts.js';

declare global {
  interface Window {
    /** Set by the server -- true when the web proxy is started with --dev. */
    __MECCG_DEV?: boolean;
    /** Set by the lobby server -- true when running in lobby mode. */
    __LOBBY?: boolean;
    /** Set by the lobby server -- version from package.json. */
    __MECCG_VERSION?: string;
  }
}

const versionEl = document.getElementById('lobby-nav-version');
if (versionEl && window.__MECCG_VERSION) {
  versionEl.textContent = `v${window.__MECCG_VERSION}`;
}

// ---- Wire up cross-module callbacks ----

// These break circular dependencies between modules that need each other.
setDeckBrowserCallbacks(openDeckEditor);
setDeckEditorCallbacks(showScreen);
setInboxCallbacks(showScreen);
setCreditsPageCallbacks(showScreen);

// ---- UI Setup ----

document.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('name-input') as HTMLInputElement;
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
  const connectForm = document.getElementById('connect-form') as HTMLElement;
  const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;

  applyBackground();
  setupCardPreview(cardPool);
  setupDeckEditorPreview();
  setupDecksPreview();
  const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
  const reseedBtn = document.getElementById('reseed-btn') as HTMLButtonElement;
  const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
  const viewToggleBtn = document.getElementById('view-toggle-btn') as HTMLButtonElement;
  const debugView = document.getElementById('debug-view') as HTMLElement;
  const visualView = document.getElementById('visual-view') as HTMLElement;

  function setViewMode(visual: boolean): void {
    debugView.classList.toggle('hidden', visual);
    visualView.classList.toggle('hidden', !visual);
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

  viewToggleBtn.addEventListener('click', () => {
    setViewMode(!debugView.classList.contains('hidden'));
  });

  // Pseudo-AI panel minimize/restore toggle
  const pseudoAiMinimizeBtn = document.getElementById('pseudo-ai-minimize-btn');
  if (pseudoAiMinimizeBtn) {
    pseudoAiMinimizeBtn.addEventListener('click', () => {
      const panel = document.getElementById('pseudo-ai-panel')!;
      const minimized = panel.classList.toggle('minimized');
      pseudoAiMinimizeBtn.textContent = minimized ? '\u25a1' : '_';
      pseudoAiMinimizeBtn.title = minimized ? 'Restore' : 'Minimize';
    });
  }

  /** Flash a button to confirm the action was triggered. */
  function flashBtn(btn: HTMLElement): void {
    btn.classList.remove('btn-flash');
    void btn.offsetWidth;
    btn.classList.add('btn-flash');
  }

  // Restore saved view mode (default to visual when no preference stored)
  if (localStorage.getItem(VIEW_KEY) !== 'debug') {
    setViewMode(true);
  }

  function startGame(name: string, newBackground = false): void {
    if (newBackground) selectRandomBackground();
    savePlayerName(name);
    appState.autoReconnect = true;
    connectForm.style.display = 'none';
    document.getElementById('game')!.classList.remove('hidden');
    connect(name);
  }

  connectBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
      renderLog('Invalid name: only letters, numbers, spaces, hyphens, and underscores allowed');
      return;
    }
    startGame(name, true);
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectBtn.click();
  });

  // ---- Lobby mode event handlers ----
  if (LOBBY_MODE) {
    const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
    const registerBtn = document.getElementById('register-btn') as HTMLButtonElement;
    const authTabLogin = document.getElementById('auth-tab-login') as HTMLButtonElement;
    const authTabRegister = document.getElementById('auth-tab-register') as HTMLButtonElement;
    const acceptChallengeBtn = document.getElementById('accept-challenge-btn') as HTMLButtonElement;
    const declineChallengeBtn = document.getElementById('decline-challenge-btn') as HTMLButtonElement;

    authTabLogin.addEventListener('click', () => showAuthTab('login'));
    authTabRegister.addEventListener('click', () => showAuthTab('register'));

    loginBtn.addEventListener('click', () => { void (async () => {
      const name = (document.getElementById('login-name') as HTMLInputElement).value.trim();
      const password = (document.getElementById('login-password') as HTMLInputElement).value;
      if (!name || !password) { showAuthError('login-error', 'Name and password are required'); return; }
      try {
        const resp = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, password }),
        });
        const data = await resp.json() as { name?: string; isReviewer?: boolean; credits?: number; error?: string };
        if (!resp.ok) { showAuthError('login-error', data.error ?? 'Login failed'); return; }
        appState.lobbyPlayerName = data.name!;
        appState.lobbyPlayerIsReviewer = data.isReviewer ?? false;
        appState.lobbyPlayerCredits = data.credits ?? 0;
        showScreen('lobby-screen');
        connectLobbyWs();
      } catch { showAuthError('login-error', 'Connection error'); }
    })(); });

    // Enter key on login form
    for (const id of ['login-name', 'login-password']) {
      document.getElementById(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });
    }

    registerBtn.addEventListener('click', () => { void (async () => {
      const name = (document.getElementById('register-name') as HTMLInputElement).value.trim();
      const displayName = (document.getElementById('register-display-name') as HTMLInputElement).value.trim();
      const email = (document.getElementById('register-email') as HTMLInputElement).value.trim();
      const password = (document.getElementById('register-password') as HTMLInputElement).value;
      if (!name || !email || !password) { showAuthError('register-error', 'All fields are required'); return; }
      try {
        const resp = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, ...(displayName ? { displayName } : {}) }),
        });
        const data = await resp.json() as { name?: string; isReviewer?: boolean; credits?: number; error?: string };
        if (!resp.ok) { showAuthError('register-error', data.error ?? 'Registration failed'); return; }
        appState.lobbyPlayerName = data.name!;
        appState.lobbyPlayerIsReviewer = data.isReviewer ?? false;
        appState.lobbyPlayerCredits = data.credits ?? 0;
        showScreen('lobby-screen');
        connectLobbyWs();
      } catch { showAuthError('register-error', 'Connection error'); }
    })(); });

    // Enter key on register form
    for (const id of ['register-name', 'register-display-name', 'register-email', 'register-password']) {
      document.getElementById(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') registerBtn.click(); });
    }

    const doLogout = () => { void (async () => {
      await fetch('/api/logout', { method: 'POST' });
      appState.lobbyPlayerName = null;
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.removeItem(VIEWING_CREDITS_KEY);
      if (appState.lobbyWs) { appState.lobbyWs.close(); appState.lobbyWs = null; }
      selectRandomAuthHero();
      showAuthTab('login');
      showScreen('auth-screen');
    })(); };
    document.getElementById('logout-btn')!.addEventListener('click', doLogout);

    /**
     * Disable every play button in the lobby while a game launch is in flight.
     * The browser dims disabled buttons via the `.lobby-play-btn:disabled` rule.
     */
    function setLobbyPlayButtonsDisabled(disabled: boolean): void {
      for (const btn of document.querySelectorAll<HTMLButtonElement>('#lobby-screen .lobby-play-btn')) {
        btn.disabled = disabled;
      }
      for (const btn of document.querySelectorAll<HTMLButtonElement>('.lobby-player-item button')) {
        btn.disabled = disabled;
      }
    }

    // ---- Smart-AI ----
    const playSmartAiBtn = document.getElementById('play-smart-ai-btn') as HTMLButtonElement;

    /** Send the play-smart-ai message and disable the UI. */
    function launchSmartAiGame(): void {
      if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN) {
        const aiDeckSelect = document.getElementById('ai-deck-select') as HTMLSelectElement;
        appState.lobbyWs.send(JSON.stringify({ type: 'play-smart-ai', deckId: aiDeckSelect.value }));
        playSmartAiBtn.textContent = 'Starting...';
        setLobbyPlayButtonsDisabled(true);
      }
    }

    playSmartAiBtn.addEventListener('click', () => { void (async () => {
      const resp = await fetch('/api/saves/check?opponent=AI-Smart');
      if (resp.ok) {
        const data = await resp.json() as { hasSave: boolean };
        if (data.hasSave) {
          const cont = await showConfirm(
            'A saved game exists against Smart-AI. Continue the saved game or start a new one?',
            { okLabel: 'Continue', cancelLabel: 'Start New' },
          );
          if (!cont) {
            await fetch('/api/saves/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ opponent: 'AI-Smart' }),
            });
          }
        }
      }
      launchSmartAiGame();
    })(); });

    // ---- Pseudo-AI ----
    const playPseudoAiBtn = document.getElementById('play-pseudo-ai-btn') as HTMLButtonElement;

    /** Send the play-pseudo-ai message and disable the UI. */
    function launchPseudoAiGame(): void {
      if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN) {
        const aiDeckSelect = document.getElementById('ai-deck-select') as HTMLSelectElement;
        const deckId = aiDeckSelect.value;
        // Capture the AI deck now, before the lobby screen is hidden
        appState.pendingAiDeck = appState.cachedCatalog.find(d => d.id === deckId) ?? null;
        appState.lobbyWs.send(JSON.stringify({ type: 'play-pseudo-ai', deckId }));
        playPseudoAiBtn.textContent = 'Starting...';
        setLobbyPlayButtonsDisabled(true);
      }
    }

    playPseudoAiBtn.addEventListener('click', () => { void (async () => {
      const resp = await fetch('/api/saves/check?opponent=AI-Pseudo');
      if (resp.ok) {
        const data = await resp.json() as { hasSave: boolean };
        if (data.hasSave) {
          const cont = await showConfirm(
            'A saved game exists against Pseudo-AI. Continue the saved game or start a new one?',
            { okLabel: 'Continue', cancelLabel: 'Start New' },
          );
          if (!cont) {
            await fetch('/api/saves/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ opponent: 'AI-Pseudo' }),
            });
          }
        }
      }
      launchPseudoAiGame();
    })(); });

    acceptChallengeBtn.addEventListener('click', () => {
      if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN && appState.challengeFrom) {
        appState.lobbyWs.send(JSON.stringify({ type: 'accept-challenge', from: appState.challengeFrom }));
        document.getElementById('challenge-incoming')!.classList.add('hidden');
        appState.challengeFrom = null;
      }
    });

    declineChallengeBtn.addEventListener('click', () => {
      if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN && appState.challengeFrom) {
        appState.lobbyWs.send(JSON.stringify({ type: 'decline-challenge', from: appState.challengeFrom }));
        document.getElementById('challenge-incoming')!.classList.add('hidden');
        appState.challengeFrom = null;
      }
    });

    // "Choose a deck" link in the no-deck notice
    document.getElementById('no-deck-link')!.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('nav-decks')!.click();
    });

    // Nav bar buttons
    document.getElementById('nav-lobby')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.removeItem(VIEWING_CREDITS_KEY);
      showScreen('lobby-screen');
    });
    document.getElementById('nav-decks')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_CREDITS_KEY);
      sessionStorage.setItem(VIEWING_DECKS_KEY, '1');
      showScreen('decks-screen');
    });
    document.getElementById('nav-mail')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_CREDITS_KEY);
      void openInbox();
    });
    document.getElementById('lobby-credits-badge')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.setItem(VIEWING_CREDITS_KEY, '1');
      void openCreditsPage();
    });

    // Feature request modal handlers
    const frModal = document.getElementById('feature-request-modal')!;
    const frSubject = document.getElementById('feature-request-subject') as HTMLInputElement;
    const frBody = document.getElementById('feature-request-body') as HTMLTextAreaElement;
    const closeFeatureModal = () => { frModal.classList.add('hidden'); };
    document.getElementById('feature-request-backdrop')!.addEventListener('click', closeFeatureModal);
    document.getElementById('feature-request-cancel')!.addEventListener('click', closeFeatureModal);
    document.getElementById('feature-request-send')!.addEventListener('click', () => {
      const brief = frSubject.value.trim();
      const text = frBody.value.trim();
      if (!brief || !text) return;
      void (async () => {
        const resp = await fetch('/api/mail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipients: ['admin'],
            subject: `Feature Request: ${brief}`,
            topic: 'feature-request',
            body: text,
          }),
        });
        if (resp.ok) {
          closeFeatureModal();
          showNotification('Request sent!');
          void openSent();
        } else {
          const data = await resp.json().catch(() => ({})) as { error?: string };
          await showAlert(data.error ?? 'Failed to send feature request');
        }
      })();
    });
  }

  // Bug report modal handlers
  const brModal = document.getElementById('bug-report-modal')!;
  const brSubject = document.getElementById('bug-report-subject') as HTMLInputElement;
  const brBody = document.getElementById('bug-report-body') as HTMLTextAreaElement;
  const closeBugModal = () => { brModal.classList.add('hidden'); };
  document.getElementById('bug-report-backdrop')!.addEventListener('click', closeBugModal);
  document.getElementById('bug-report-cancel')!.addEventListener('click', closeBugModal);
  document.getElementById('bug-report-send')!.addEventListener('click', () => {
    const brief = brSubject.value.trim();
    const text = brBody.value.trim();
    if (!brief || !text) return;
    const fullBody = `Game ID: ${appState.currentGameId ?? 'unknown'}\nSequence number: ${appState.currentStateSeq}\n\n${text}`;
    void (async () => {
      const resp = await fetch('/api/mail/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: `Bug Report: ${brief}`,
          body: fullBody,
          otherPlayer: appState.opponentName,
        }),
      });
      if (resp.ok) {
        closeBugModal();
        showNotification('Bug report sent!');
      } else {
        const data = await resp.json().catch(() => ({})) as { error?: string };
        await showAlert(data.error ?? 'Failed to send bug report');
      }
    })();
  });
  document.getElementById('bug-report-btn')!.addEventListener('click', () => {
    if (appState.lobbyPlayerCredits <= 0) {
      void showAlert('No credits available. Top up your credits before sending a bug report.');
      return;
    }
    brSubject.value = '';
    brBody.value = '';
    brModal.classList.remove('hidden');
    brSubject.focus();
  });

  installKeyboardShortcuts();

  // ---- Settings modal ----
  const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
  const settingsModal = document.getElementById('settings-modal') as HTMLElement;
  const settingsBackdrop = document.getElementById('settings-backdrop') as HTMLElement;
  const settingsCloseBtn = document.getElementById('settings-close-btn') as HTMLButtonElement;
  const devModeToggle = document.getElementById('dev-mode-toggle') as HTMLInputElement;

  const cheatRollSelect = document.getElementById('cheat-roll-select') as HTMLSelectElement;
  const summonBtn = document.getElementById('summon-btn') as HTMLButtonElement;
  const swapHandBtn = document.getElementById('swap-hand-btn') as HTMLButtonElement;
  const devMenuBtn = document.getElementById('dev-menu-btn') as HTMLButtonElement;
  const devMenuPopup = document.getElementById('dev-menu-popup') as HTMLElement;

  function closeDevMenu(): void {
    devMenuPopup.classList.add('hidden');
  }

  function applyDevMode(on: boolean): void {
    viewToggleBtn.style.display = on ? '' : 'none';
    devMenuBtn.style.display = on ? '' : 'none';
    if (!on) {
      closeDevMenu();
      setViewMode(true);
    }
  }

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

  // When the server is not in dev mode, hide the dev mode toggle entirely
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

  function closeSettings(): void {
    settingsModal.classList.add('hidden');
  }

  settingsBackdrop.addEventListener('click', closeSettings);
  settingsCloseBtn.addEventListener('click', closeSettings);

  devModeToggle.addEventListener('change', () => {
    if (!SERVER_DEV) return;
    localStorage.setItem(DEV_MODE_KEY, String(devModeToggle.checked));
    applyDevMode(devModeToggle.checked);
  });

  const autoPassToggle = document.getElementById('auto-pass-toggle') as HTMLInputElement;
  autoPassToggle.checked = localStorage.getItem(AUTO_PASS_KEY) === 'true';

  autoPassToggle.addEventListener('change', () => {
    localStorage.setItem(AUTO_PASS_KEY, String(autoPassToggle.checked));
    if (!autoPassToggle.checked && appState.autoPassTimer) {
      clearTimeout(appState.autoPassTimer);
      appState.autoPassTimer = null;
    }
  });

  disconnectBtn.addEventListener('click', () => {
    disconnect();
  });

  undoBtn.addEventListener('click', () => {
    if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'undo' };
      appState.ws.send(JSON.stringify(msg));
      // Revert game log to the snapshot before the last action
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

  /** Clear all visual game state immediately (before server responds). */
  function clearGameBoard(): void {
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
    // Clear pseudo-AI action list
    const pseudoPanel = document.getElementById('pseudo-ai-panel');
    if (pseudoPanel) {
      pseudoPanel.classList.add('hidden');
      pseudoPanel.classList.remove('minimized');
      document.getElementById('pseudo-ai-actions')!.innerHTML = '';
    }
    resetCompanyViews();
    clearDice();
  }

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
    cheatRollSelect.value = '';  // Reset to "Roll" label
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

  // ---- Snapshot modal ----
  const snapshotBtn = document.getElementById('snapshot-btn') as HTMLButtonElement;
  const snapshotModal = document.getElementById('snapshot-modal') as HTMLElement;
  const snapshotBackdrop = document.getElementById('snapshot-backdrop') as HTMLElement;
  const snapshotList = document.getElementById('snapshot-list') as HTMLElement;

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

          // Card images (character + site)
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

  resetBtn.addEventListener('click', () => {
    if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'reset' };
      appState.ws.send(JSON.stringify(msg));
      flashBtn(resetBtn);
      clearGameBoard();
    }
  });

  // Initial screen
  if (LOBBY_MODE) {
    // In lobby mode: check session, show login or lobby
    void initLobby();
  } else {
    // Standalone mode: show connect form, auto-connect if name saved
    connectForm.style.display = '';
    const savedName = loadPlayerName();
    if (savedName) {
      startGame(savedName);
    }
  }
});
