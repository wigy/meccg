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
  VIEWING_SCOREBOARD_KEY, MAIL_TAB_KEY, MAIL_MSG_KEY,
} from './app-state.js';
import { restoreGameSession, saveGameSession } from './session.js';
import { openInbox, openSent, autoSelectMessage, updateMailBadge } from './inbox.js';
import { openCreditsPage, updateCreditsBadge } from './credits-page.js';
import { openScoreboardPage } from './scoreboard-page.js';
import { renderLog } from './render-log.js';
import { loadGameBundle, loadDeckEditorBundle } from './lazy-load.js';

/** All screen IDs in the lobby UI. */
const ALL_SCREENS: ScreenId[] = ['auth-screen', 'lobby-screen', 'decks-screen', 'deck-editor-screen', 'inbox-screen', 'credits-screen', 'scoreboard-screen', 'connect-form'];

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
const NAV_SCREENS: ScreenId[] = ['lobby-screen', 'decks-screen', 'deck-editor-screen', 'inbox-screen', 'credits-screen', 'scoreboard-screen'];

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
  document.getElementById('nav-scoreboard')?.classList.toggle('lobby-nav-item--active',
    id === 'scoreboard-screen');
  // Update player name and credits on all screens
  for (const el of document.querySelectorAll('.screen-player-name')) {
    el.textContent = appState.lobbyPlayerName ?? '';
  }
  updateCreditsBadge();
  // Reset lobby button state when showing the lobby
  if (id === 'lobby-screen') {
    const heuristicBtn = document.getElementById('play-heuristic-ai-btn') as HTMLButtonElement | null;
    if (heuristicBtn) { heuristicBtn.textContent = 'Play vs Heuristic-AI'; heuristicBtn.disabled = false; }
    const realBtn = document.getElementById('play-real-ai-btn') as HTMLButtonElement | null;
    if (realBtn) { realBtn.textContent = 'Play vs Real-AI (experimental)'; realBtn.disabled = false; }
    // Collapse the model picker again, so returning to the lobby starts from
    // the same state as a fresh visit.
    document.getElementById('real-ai-options')?.classList.add('hidden');
    const startRealBtn = document.getElementById('start-real-ai-btn') as HTMLButtonElement | null;
    if (startRealBtn) { startRealBtn.textContent = 'Start'; startRealBtn.disabled = false; }
    const mcBtn = document.getElementById('play-mc-ai-btn') as HTMLButtonElement | null;
    if (mcBtn) { mcBtn.textContent = 'Play vs MC-AI (experimental)'; mcBtn.disabled = false; }
    const modularBtn = document.getElementById('play-modular-ai-btn') as HTMLButtonElement | null;
    if (modularBtn) { modularBtn.textContent = 'Play vs Modular AI (experimental)'; modularBtn.disabled = false; }
    const pseudoBtn = document.getElementById('play-pseudo-ai-btn') as HTMLButtonElement | null;
    if (pseudoBtn) { pseudoBtn.textContent = 'Play vs Pseudo-AI'; pseudoBtn.disabled = false; }
    void loadDeckEditorBundle().then(() => window.__meccg?.loadDecks?.());
  }
  // Load decks when showing the decks screen
  if (id === 'decks-screen') {
    void loadDeckEditorBundle().then(() => window.__meccg?.loadDecks?.());
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

type OnlinePlayerRow = { name: string; displayName: string; credits: number; inGame: boolean };
type OnlineGameRow = {
  port: number; player1: string; player1DisplayName: string; player2: string; player2DisplayName: string;
};

/** Last online-players snapshot, so local state changes can re-render the list. */
let lastOnline: { players: OnlinePlayerRow[]; games: OnlineGameRow[] } | null = null;

/**
 * Render the online-players list from the last snapshot: games in progress as
 * "p1 vs. p2" with a Watch button, then challengeable players. The per-player
 * button is Challenge or, once a challenge has been sent, Cancel — tracked in
 * appState.sentChallenges so it survives re-renders. Safe to call any time the
 * list or the sent-challenge set changes.
 */
function renderOnlineList(): void {
  if (!lastOnline) return;
  const { players, games } = lastOnline;

  // Drop sent-challenge markers for anyone no longer challengeable (gone
  // offline or now in a game), so a stale "Cancel" button never lingers.
  for (const n of [...appState.sentChallenges]) {
    if (!players.some(p => p.name === n && !p.inGame)) appState.sentChallenges.delete(n);
  }

  // Players already shown as part of a "p1 vs p2" game must not also appear as
  // individual entries.
  const inListedGame = new Set<string>();
  for (const g of games) { inListedGame.add(g.player1); inListedGame.add(g.player2); }

  const others = players.filter(p => p.name !== appState.lobbyPlayerName && !inListedGame.has(p.name));
  const container = document.getElementById('online-players')!;
  container.innerHTML = '';

  // Ongoing games first: shown as "p1 vs. p2" with a Watch button.
  for (const game of games) {
    const item = document.createElement('div');
    item.className = 'lobby-player-item lobby-game-item';
    const span = document.createElement('span');
    span.textContent = `${game.player1DisplayName} vs. ${game.player2DisplayName}`;
    item.appendChild(span);
    // You cannot watch a game you are playing in (the server rejects it), so
    // offer Watch only to non-participants.
    const isParticipant = game.player1 === appState.lobbyPlayerName || game.player2 === appState.lobbyPlayerName;
    if (!isParticipant) {
      const btn = document.createElement('button');
      btn.textContent = 'Watch';
      btn.addEventListener('click', () => {
        appState.lobbyWs?.send(JSON.stringify({ type: 'watch-game', port: game.port }));
        btn.textContent = 'Joining...';
        btn.disabled = true;
      });
      item.appendChild(btn);
    }
    container.appendChild(item);
  }

  // Then individual players not in a listed game.
  for (const player of others) {
    const item = document.createElement('div');
    item.className = 'lobby-player-item';
    const span = document.createElement('span');
    span.textContent = player.displayName;
    item.appendChild(span);
    if (player.inGame) {
      // In an AI game (not watchable) — show a muted status, no Challenge.
      const status = document.createElement('span');
      status.className = 'lobby-player-status';
      status.textContent = 'In game';
      item.appendChild(status);
    } else {
      const btn = document.createElement('button');
      if (appState.sentChallenges.has(player.name)) {
        // Challenge already sent — offer to withdraw it.
        btn.textContent = 'Cancel';
        btn.className = 'lobby-cancel-btn';
        btn.addEventListener('click', () => {
          appState.lobbyWs?.send(JSON.stringify({ type: 'cancel-challenge', opponentName: player.name }));
          appState.sentChallenges.delete(player.name);
          renderOnlineList();
        });
      } else {
        btn.textContent = 'Challenge';
        if (!appState.currentDeckId) btn.disabled = true;
        btn.addEventListener('click', () => {
          appState.lobbyWs?.send(JSON.stringify({ type: 'challenge', opponentName: player.name }));
          appState.sentChallenges.add(player.name);
          renderOnlineList();
        });
      }
      item.appendChild(btn);
    }
    container.appendChild(item);
  }

  if (container.childElementCount === 0) {
    container.innerHTML = '<p class="lobby-empty">No other players online</p>';
  }
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
        const players = (msg.players as OnlinePlayerRow[]);
        const games = (msg.games as OnlineGameRow[] | undefined) ?? [];
        // Update own credits from the broadcast
        const self = players.find(p => p.name === appState.lobbyPlayerName);
        if (self) {
          appState.lobbyPlayerCredits = self.credits;
          updateCreditsBadge();
        }
        lastOnline = { players, games };
        renderOnlineList();
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
        appState.sentChallenges.delete(msg.by as string);
        renderOnlineList();
        renderLog(`${byDisplay} declined your challenge.`);
        break;
      }
      case 'challenge-cancelled': {
        // The challenger withdrew (or entered a game): dismiss the incoming
        // prompt if it is the one currently showing.
        if (appState.challengeFrom === (msg.from as string)) {
          document.getElementById('challenge-incoming')!.classList.add('hidden');
          appState.challengeFrom = null;
        }
        break;
      }
      case 'game-starting': {
        // Entering a game withdraws every challenge we sent (the server does the
        // same), so forget them rather than show stale "Cancel" buttons later.
        appState.sentChallenges.clear();
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
        // Load the game bundle lazily, then connect.
        void loadGameBundle().then(() => {
          window.__meccg!.connect!(appState.lobbyPlayerName!);
          if (appState.isPseudoAi && appState.opponentName) {
            window.__meccg!.connectPseudoAi!(appState.opponentName, appState.pendingAiDeck);
            appState.pendingAiDeck = null;
          }
        });
        break;
      }
      case 'game-watching': {
        appState.gamePort = msg.port as number;
        appState.gameToken = msg.token as string;
        // A spectator sees two players, not a single opponent; leaving null
        // keeps the rejoin-as-player path from ever running (see onclose).
        appState.opponentName = null;
        appState.spectating = true;
        appState.isPseudoAi = false;
        appState.pseudoAiToken = null;
        const p1 = (msg.player1DisplayName as string) ?? 'Player 1';
        const p2 = (msg.player2DisplayName as string) ?? 'Player 2';
        // Do not persist a spectator session: watching is ephemeral, so a page
        // refresh returns to the lobby rather than silently re-joining.
        // Close lobby WS during the game
        if (appState.lobbyWs) { appState.lobbyWs.close(); appState.lobbyWs = null; }
        showScreen('auth-screen'); // hide all screens
        document.getElementById('auth-screen')!.classList.add('hidden');
        document.getElementById('game')!.classList.remove('hidden');
        selectRandomBackground();
        appState.autoReconnect = true;
        renderLog(`Watching ${p1} vs. ${p2} on port ${appState.gamePort}...`);
        void loadGameBundle().then(() => {
          window.__meccg!.connect!(appState.lobbyPlayerName!);
        });
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
        const container = document.getElementById('game-log-system');
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
  // Register lobby callbacks on window.__meccg so game and deck-editor bundles can call back.
  window.__meccg!.showScreen = showScreen;
  window.__meccg!.connectLobbyWs = connectLobbyWs;

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
        void loadGameBundle().then(() => {
          window.__meccg!.connect!(appState.lobbyPlayerName!);
          if (appState.isPseudoAi && appState.opponentName) {
            window.__meccg!.connectPseudoAi!(appState.opponentName);
          }
        });
        return;
      }

      // Restore deck editor if we were editing before reload
      const editingDeck = sessionStorage.getItem(EDITING_DECK_KEY);
      if (editingDeck) {
        connectLobbyWs();
        void loadDeckEditorBundle().then(() => window.__meccg!.openDeckEditor!(editingDeck));
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

      // Restore scoreboard if we were viewing it before reload
      if (sessionStorage.getItem(VIEWING_SCOREBOARD_KEY)) {
        connectLobbyWs();
        void openScoreboardPage();
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
