/**
 * @module lobby-screens
 *
 * Lobby mode screen management, authentication forms, lobby WebSocket
 * for online presence and challenges, and the lobby initialization flow.
 * Coordinates transitions between login, register, lobby, decks, deck
 * editor, inbox, and game screens.
 */

import {
  appState, type ScreenId,
  BACKGROUNDS, BG_KEY,
  EDITING_DECK_KEY, VIEWING_INBOX_KEY, VIEWING_DECKS_KEY, VIEWING_CREDITS_KEY,
  MAIL_TAB_KEY, MAIL_MSG_KEY,
} from './app-state.js';
import { restoreGameSession, saveGameSession } from './session.js';
import { connect, setLobbyCallbacks } from './game-connection.js';
import { connectPseudoAi } from './pseudo-ai.js';
import { loadDecks } from './deck-browser.js';
import { openDeckEditor } from './deck-editor.js';
import { openInbox, openSent, autoSelectMessage, updateMailBadge } from './inbox.js';
import { openCreditsPage, updateCreditsBadge } from './credits-page.js';
import { renderLog } from './render.js';

/** All screen IDs in the lobby UI. */
const ALL_SCREENS: ScreenId[] = ['auth-screen', 'lobby-screen', 'decks-screen', 'deck-editor-screen', 'inbox-screen', 'credits-screen', 'connect-form'];

/**
 * Pick a random hero background image for the auth screen and apply it.
 * Reuses the same pool as the in-game `--visual-bg` so login and lobby
 * share visual language.
 */
export function selectRandomAuthHero(): void {
  const bg = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
  document.documentElement.style.setProperty('--auth-hero-bg', `url('${bg}')`);
}

/**
 * Switch the auth screen between Login and Register tabs.
 * Toggles the `auth-screen--login` / `auth-screen--register` class on the
 * container; CSS handles which form is visible.
 */
export function showAuthTab(tab: 'login' | 'register'): void {
  const screen = document.getElementById('auth-screen');
  if (!screen) return;
  screen.classList.toggle('auth-screen--login', tab === 'login');
  screen.classList.toggle('auth-screen--register', tab === 'register');
  document.getElementById('auth-tab-login')?.classList.toggle('auth-tab--active', tab === 'login');
  document.getElementById('auth-tab-register')?.classList.toggle('auth-tab--active', tab === 'register');
  document.getElementById('auth-tab-login')?.setAttribute('aria-selected', String(tab === 'login'));
  document.getElementById('auth-tab-register')?.setAttribute('aria-selected', String(tab === 'register'));
  // Focus the first input of the visible form for fast typing
  const firstInputId = tab === 'login' ? 'login-name' : 'register-name';
  setTimeout(() => document.getElementById(firstInputId)?.focus(), 0);
}

/** Screens that should show the persistent nav bar. */
const NAV_SCREENS: ScreenId[] = ['lobby-screen', 'decks-screen', 'deck-editor-screen', 'inbox-screen', 'credits-screen'];

/** Show one screen, hiding all others. */
export function showScreen(id: ScreenId): void {
  for (const screenId of ALL_SCREENS) {
    const el = document.getElementById(screenId);
    if (el) el.classList.toggle('hidden', screenId !== id);
  }
  // Show/hide the persistent nav bar
  const nav = document.getElementById('lobby-nav');
  if (nav) nav.classList.toggle('hidden', !NAV_SCREENS.includes(id));
  // Update active nav item
  document.getElementById('nav-lobby')?.classList.toggle('lobby-nav-item--active',
    id === 'lobby-screen');
  document.getElementById('nav-decks')?.classList.toggle('lobby-nav-item--active',
    id === 'decks-screen' || id === 'deck-editor-screen');
  document.getElementById('nav-mail')?.classList.toggle('lobby-nav-item--active',
    id === 'inbox-screen');
  // Update player name and credits on all screens
  for (const el of document.querySelectorAll('.screen-player-name')) {
    el.textContent = appState.lobbyPlayerName ?? '';
  }
  updateCreditsBadge();
  // Reset lobby button state when showing the lobby
  if (id === 'lobby-screen') {
    const smartBtn = document.getElementById('play-smart-ai-btn') as HTMLButtonElement | null;
    if (smartBtn) { smartBtn.textContent = 'Play vs Smart-AI'; smartBtn.disabled = false; }
    const pseudoBtn = document.getElementById('play-pseudo-ai-btn') as HTMLButtonElement | null;
    if (pseudoBtn) { pseudoBtn.textContent = 'Play vs Pseudo-AI'; pseudoBtn.disabled = false; }
    void loadDecks();
  }
  // Load decks when showing the decks screen
  if (id === 'decks-screen') {
    void loadDecks();
  }
}

/** Show an error message on an auth form. */
export function showAuthError(id: string, msg: string): void {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
}

/** Apply the saved background image. */
export function applyBackground(): void {
  const saved = localStorage.getItem(BG_KEY);
  const bg = saved && BACKGROUNDS.includes(saved) ? saved : BACKGROUNDS[0];
  document.documentElement.style.setProperty('--visual-bg', `url('${bg}')`);
}

/** Select and apply a random background image. */
export function selectRandomBackground(): void {
  const bg = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
  localStorage.setItem(BG_KEY, bg);
  document.documentElement.style.setProperty('--visual-bg', `url('${bg}')`);
}

/** Connect the lobby WebSocket for online presence and challenges. */
export function connectLobbyWs(): void {
  if (appState.lobbyWs && appState.lobbyWs.readyState === WebSocket.OPEN) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  appState.lobbyWs = new WebSocket(`${protocol}//${window.location.host}`);

  appState.lobbyWs.onmessage = (event) => {
    const msg = JSON.parse(event.data as string) as { type: string; [key: string]: unknown };
    switch (msg.type) {
      case 'online-players': {
        const players = (msg.players as { name: string; displayName: string; credits: number }[]);
        // Update own credits from the broadcast
        const self = players.find(p => p.name === appState.lobbyPlayerName);
        if (self) {
          appState.lobbyPlayerCredits = self.credits;
          updateCreditsBadge();
        }
        const others = players.filter(p => p.name !== appState.lobbyPlayerName);
        const container = document.getElementById('online-players')!;
        if (others.length === 0) {
          container.innerHTML = '<p class="lobby-empty">No other players online</p>';
        } else {
          container.innerHTML = '';
          for (const player of others) {
            const item = document.createElement('div');
            item.className = 'lobby-player-item';
            const span = document.createElement('span');
            span.textContent = player.displayName;
            const btn = document.createElement('button');
            btn.textContent = 'Challenge';
            if (!appState.currentDeckId) btn.disabled = true;
            btn.addEventListener('click', () => {
              appState.lobbyWs?.send(JSON.stringify({ type: 'challenge', opponentName: player.name }));
              btn.textContent = 'Sent';
              btn.disabled = true;
            });
            item.appendChild(span);
            item.appendChild(btn);
            container.appendChild(item);
          }
        }
        break;
      }
      case 'challenge-received': {
        appState.challengeFrom = msg.from as string;
        const incoming = document.getElementById('challenge-incoming')!;
        const fromDisplay = (msg.fromDisplayName as string) ?? appState.challengeFrom;
        document.getElementById('challenge-text')!.textContent = `${fromDisplay} wants to play!`;
        incoming.classList.remove('hidden');
        break;
      }
      case 'challenge-declined': {
        const byDisplay = (msg.byDisplayName as string) ?? (msg.by as string);
        renderLog(`${byDisplay} declined your challenge.`);
        break;
      }
      case 'game-starting': {
        appState.gamePort = msg.port as number;
        appState.gameToken = msg.token as string;
        appState.opponentName = (msg.opponent as string) ?? null;
        appState.isPseudoAi = (msg.pseudoAi as boolean) ?? false;
        appState.pseudoAiToken = (msg.aiToken as string) ?? null;
        const opponentDisplay = (msg.opponentDisplayName as string) ?? (msg.opponent as string);
        saveGameSession();
        // Close lobby WS during game
        if (appState.lobbyWs) { appState.lobbyWs.close(); appState.lobbyWs = null; }
        // Hide lobby, show game
        showScreen('auth-screen'); // hide all screens
        document.getElementById('auth-screen')!.classList.add('hidden');
        document.getElementById('game')!.classList.remove('hidden');
        selectRandomBackground();
        appState.autoReconnect = true;
        renderLog(`Game starting vs ${opponentDisplay} on port ${appState.gamePort}...`);
        connect(appState.lobbyPlayerName!);
        // For pseudo-AI, open a second WS as the AI player with the captured deck
        if (appState.isPseudoAi && appState.opponentName) {
          connectPseudoAi(appState.opponentName, appState.pendingAiDeck);
          appState.pendingAiDeck = null;
        }
        break;
      }
      case 'error': {
        renderLog(`Lobby: ${msg.message as string}`);
        break;
      }
      case 'mail-notification': {
        const unread = msg.unreadCount as number;
        updateMailBadge(unread);
        break;
      }
      case 'system-notification': {
        const container = document.getElementById('toast-container');
        if (container) {
          const toast = document.createElement('div');
          toast.className = 'toast toast--system';
          toast.textContent = msg.message as string;
          const closeBtn = document.createElement('span');
          closeBtn.className = 'toast-close';
          closeBtn.textContent = '\u2715';
          closeBtn.addEventListener('click', () => toast.remove());
          toast.appendChild(closeBtn);
          container.appendChild(toast);
        }
        break;
      }
      case 'force-reload': {
        location.reload();
        break;
      }
    }
  };

  appState.lobbyWs.onclose = () => {
    appState.lobbyWs = null;
    // Auto-reconnect after 3s so we receive force-reload after a server reboot
    setTimeout(() => connectLobbyWs(), 3000);
  };
}

/** Initialize lobby mode on page load. */
export async function initLobby(): Promise<void> {
  // Wire up the lobby callbacks for game-connection module
  setLobbyCallbacks(showScreen, connectLobbyWs);

  try {
    const resp = await fetch('/api/me');
    if (resp.ok) {
      const data = await resp.json() as { name: string; isReviewer?: boolean; credits?: number };
      appState.lobbyPlayerName = data.name;
      appState.lobbyPlayerIsReviewer = data.isReviewer ?? false;
      appState.lobbyPlayerCredits = data.credits ?? 0;

      // Rejoin active game if session was saved (e.g. page refresh)
      if (restoreGameSession()) {
        showScreen('auth-screen');
        document.getElementById('auth-screen')!.classList.add('hidden');
        document.getElementById('game')!.classList.remove('hidden');
        selectRandomBackground();
        appState.autoReconnect = true;
        renderLog(`Reconnecting to game on port ${appState.gamePort}...`);
        connect(appState.lobbyPlayerName);
        // For pseudo-AI games, reconnect the AI WS
        if (appState.isPseudoAi && appState.opponentName) {
          connectPseudoAi(appState.opponentName);
        }
        return;
      }

      // Restore deck editor if we were editing before reload
      const editingDeck = sessionStorage.getItem(EDITING_DECK_KEY);
      if (editingDeck) {
        connectLobbyWs();
        void openDeckEditor(editingDeck);
        return;
      }

      // Restore inbox if we were viewing it before reload
      if (sessionStorage.getItem(VIEWING_INBOX_KEY)) {
        connectLobbyWs();
        const savedTab = sessionStorage.getItem(MAIL_TAB_KEY);
        const savedMsg = sessionStorage.getItem(MAIL_MSG_KEY);
        if (savedTab === 'sent') {
          void openSent().then(() => { if (savedMsg) autoSelectMessage(savedMsg); });
        } else {
          void openInbox().then(() => { if (savedMsg) autoSelectMessage(savedMsg); });
        }
        return;
      }

      // Restore decks screen if we were browsing decks before reload
      if (sessionStorage.getItem(VIEWING_DECKS_KEY)) {
        connectLobbyWs();
        showScreen('decks-screen');
        return;
      }

      // Restore credits page if we were viewing it before reload
      if (sessionStorage.getItem(VIEWING_CREDITS_KEY)) {
        connectLobbyWs();
        void openCreditsPage();
        return;
      }

      showScreen('lobby-screen');
      connectLobbyWs();
    } else {
      selectRandomAuthHero();
      showAuthTab('login');
      showScreen('auth-screen');
    }
  } catch {
    selectRandomAuthHero();
    showAuthTab('login');
    showScreen('auth-screen');
  }
}
