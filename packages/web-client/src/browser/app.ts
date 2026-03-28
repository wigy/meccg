/**
 * @module app
 *
 * Browser entry point for the MECCG web client. Connects to the
 * client-web server via WebSocket (which proxies to the game server),
 * renders game state, and sends actions on button click.
 */

import type { ServerMessage, ClientMessage, GameAction, CardDefinitionId } from '@meccg/shared';
import { loadCardPool, describeAction, buildCompanyNames, cardImageProxyPath, SAMPLE_DECKS } from '@meccg/shared';
import { renderState, renderDraft, renderMHInfo, renderSiteInfo, renderFreeCouncilInfo, renderActions, renderLog, renderHand, renderOpponentHand, renderPlayerNames, renderInstructions, renderDrafted, renderPassButton, renderDeckPiles, resetDeckPiles, setupCardPreview, showNotification, prepareSiteSelection, clearSiteSelection, renderChainPanel } from './render.js';
import { renderCompanyViews, resetCompanyViews } from './company-view.js';
import { rollDice, clearDice, restoreDice, waitForDice } from './dice.js';
import { snapshotPositions, animateFromSnapshot } from './flip-animate.js';

declare global {
  interface Window {
    /** Set by the server — true when the web proxy is started with --dev. */
    __MECCG_DEV?: boolean;
    /** Set by the lobby server — true when running in lobby mode. */
    __LOBBY?: boolean;
  }
}

/** Whether the server was started in dev mode. Controls dev UI availability. */
const SERVER_DEV = window.__MECCG_DEV === true;

/** Whether we are running under the lobby server (auth + matchmaking). */
const LOBBY_MODE = window.__LOBBY === true;

const cardPool = loadCardPool();

let ws: WebSocket | null = null;
let playerId: string | null = null;

/** Lobby WebSocket connection (only in lobby mode). */
let lobbyWs: WebSocket | null = null;
/** Current game server port (lobby mode — direct connection). */
let gamePort: number | null = null;
/** Current game token (lobby mode). */
let gameToken: string | null = null;

const GAME_PORT_KEY = 'meccg-game-port';
const GAME_TOKEN_KEY = 'meccg-game-token';

/** Persist game connection info in sessionStorage so a page refresh can rejoin. */
function saveGameSession(): void {
  if (gamePort !== null && gameToken !== null) {
    sessionStorage.setItem(GAME_PORT_KEY, String(gamePort));
    sessionStorage.setItem(GAME_TOKEN_KEY, gameToken);
  }
}

/** Clear persisted game session on disconnect. */
function clearGameSession(): void {
  sessionStorage.removeItem(GAME_PORT_KEY);
  sessionStorage.removeItem(GAME_TOKEN_KEY);
}

/** Restore game connection info from sessionStorage (returns true if found). */
function restoreGameSession(): boolean {
  const port = sessionStorage.getItem(GAME_PORT_KEY);
  const token = sessionStorage.getItem(GAME_TOKEN_KEY);
  if (port && token) {
    gamePort = Number(port);
    gameToken = token;
    return true;
  }
  return false;
}
/** Current logged-in player name (lobby mode). */
let lobbyPlayerName: string | null = null;
/** Name of the player who sent us a challenge (lobby mode). */
let challengeFrom: string | null = null;
let lastVisibleInstances: Readonly<Record<string, CardDefinitionId>> = {};
let lastCompanyNames: Readonly<Record<string, string>> = {};
let lastPhase: string | null = null;
let selectedDeckIndex = 0;
let autoPassTimer: ReturnType<typeof setTimeout> | null = null;
/** Stack of log entry counts, pushed before each action for undo support. */
const logCountStack: number[] = [];

function sendAction(action: GameAction): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  // Snapshot log entry count before adding action log line
  const logEl = document.getElementById('log');
  if (logEl) logCountStack.push(logEl.childElementCount);
  const desc = describeAction(action, cardPool, lastVisibleInstances, lastCompanyNames);
  renderLog(`>> ${desc}`, cardPool);
  const msg: ClientMessage = { type: 'action', action };
  ws.send(JSON.stringify(msg));
}

function connect(name: string): void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let url: string;
  if (LOBBY_MODE && gamePort) {
    // Direct connection to spawned game server
    url = `${protocol}//${window.location.hostname}:${gamePort}`;
  } else {
    // Proxy through the web-client server (standalone mode)
    url = `${protocol}//${window.location.host}`;
  }

  renderLog(`Connecting to ${url} as "${name}"...`);
  ws = new WebSocket(url);

  ws.onopen = () => {
    renderLog('Connected. Sending join...');
    const deck = SAMPLE_DECKS[selectedDeckIndex];
    const joinMsg = deck.buildJoinMessage(name);
    // In lobby mode, attach the game token for authentication
    const msg = gameToken ? { ...joinMsg, token: gameToken } : joinMsg;
    ws!.send(JSON.stringify(msg));
  };

  ws.onmessage = async (event) => {
    const raw = event.data instanceof Blob ? await event.data.text() : event.data as string;
    const msg: ServerMessage = JSON.parse(raw) as ServerMessage;

    switch (msg.type) {
      case 'assigned':
        playerId = msg.playerId;
        renderLog(`Game ${msg.gameId} — assigned player ID: ${playerId}`);
        { const h = document.getElementById('state-heading');
          if (h) {
            // Set text without destroying the copy button child
            h.childNodes[0].textContent = `Game State — ${msg.gameId}`;
            const copyBtn = document.getElementById('copy-game-code-btn');
            if (copyBtn) {
              copyBtn.classList.remove('hidden');
              copyBtn.onclick = () => {
                void navigator.clipboard.writeText(msg.gameId).then(() => showNotification('Game code copied!'));
              };
            }
          }
        }
        break;

      case 'waiting':
        renderLog('Waiting for opponent to connect...');
        showNotification('Waiting for opponent to connect...');
        break;

      case 'state':
        // Wait for any dice animation to finish before rendering the new
        // state, so the outcome isn't spoiled while dice are still rolling.
        await waitForDice();
        lastVisibleInstances = msg.view.visibleInstances;
        lastCompanyNames = {
          ...buildCompanyNames(msg.view.self.companies, msg.view.self.characters, cardPool),
          ...buildCompanyNames(msg.view.opponent.companies as never, msg.view.opponent.characters, cardPool),
        };
        renderLog(`State update: turn ${msg.view.turnNumber}, phase ${msg.view.phaseState.phase}`);
        // Snapshot card positions before clearing DOM for FLIP animation
        snapshotPositions();
        renderState(msg.view, cardPool);
        renderDraft(msg.view, cardPool);
        renderMHInfo(msg.view, cardPool, lastCompanyNames);
        renderSiteInfo(msg.view, cardPool, lastCompanyNames);
        renderFreeCouncilInfo(msg.view, cardPool);
        renderActions(msg.view.legalActions, cardPool, sendAction, msg.view.visibleInstances, lastCompanyNames);
        renderHand(msg.view, cardPool, sendAction);
        renderOpponentHand(msg.view, cardPool);
        renderPlayerNames(msg.view, cardPool);
        renderInstructions(msg.view, cardPool);
        renderDrafted(msg.view, cardPool, sendAction);
        renderPassButton(msg.view, sendAction);
        renderDeckPiles(msg.view, cardPool);
        renderCompanyViews(msg.view, cardPool, sendAction);
        renderChainPanel(msg.view, cardPool, sendAction);
        // Animate cards from old positions to new positions
        animateFromSnapshot();
        // Show turn notification when entering Untap phase
        if (msg.view.phaseState.phase === 'untap' && lastPhase !== 'untap') {
          const isMine = msg.view.activePlayer === msg.view.self.id;
          showNotification(isMine ? 'Your turn' : "Opponent's turn");
        }
        lastPhase = msg.view.phaseState.phase;
        // Prepare/clear site selection based on phase
        if (msg.view.phaseState.phase === 'setup'
          && msg.view.phaseState.setupStep.step === 'starting-site-selection') {
          prepareSiteSelection(msg.view, cardPool, sendAction);
        } else {
          clearSiteSelection();
        }
        // Auto-pass: if exactly one viable action, send it after a delay
        if (autoPassTimer) { clearTimeout(autoPassTimer); autoPassTimer = null; }
        if (localStorage.getItem(AUTO_PASS_KEY) === 'true') {
          const viable = msg.view.legalActions.filter(a => a.viable);
          if (viable.length === 1) {
            autoPassTimer = setTimeout(() => {
              autoPassTimer = null;
              sendAction(viable[0].action);
            }, 1500);
          }
        }
        break;

      case 'draft-reveal': {
        const p1 = msg.player1Pick ? (cardPool[msg.player1Pick as string]?.name ?? msg.player1Pick) : 'stopped';
        const p2 = msg.player2Pick ? (cardPool[msg.player2Pick as string]?.name ?? msg.player2Pick) : 'stopped';
        renderLog(`Draft reveal: ${msg.player1Name} → ${p1}, ${msg.player2Name} → ${p2}`, cardPool);
        if (msg.collision) {
          renderLog(`  Collision! ${p1} is set aside.`, cardPool);
        }
        break;
      }

      case 'effect':
        if (msg.effect.effect === 'dice-roll') {
          const { playerName, die1, die2, label } = msg.effect;
          renderLog(`${label}: ${playerName} rolled ${die1} + ${die2} = ${die1 + die2}`);
          const visualView = document.getElementById('visual-view');
          if (visualView && !visualView.classList.contains('hidden')) {
            const variant = playerName === name ? 'black' : 'red';
            rollDice(die1, die2, variant);
          }
        }
        break;

      case 'info':
        renderLog(msg.message);
        showNotification(msg.message);
        break;

      case 'error':
        renderLog(`ERROR: ${msg.message}`);
        showNotification(msg.message, true);
        break;

      case 'disconnected':
        renderLog(msg.message);
        showNotification(msg.message);
        break;

      case 'log':
        for (const line of msg.lines) {
          renderLog(line);
        }
        break;

      case 'restart':
        renderLog(msg.message);
        showNotification(msg.message);
        resetVisualBoard();
        resetCompanyViews();
        resetDeckPiles();
        clearDice();
        break;
    }
  };

  ws.onclose = () => {
    if (autoReconnect) {
      renderLog('Disconnected. Reconnecting in 2s...');
      setTimeout(() => connect(name), 2000);
    }
  };

  ws.onerror = () => {
    // Will trigger onclose
  };
}

// ---- LocalStorage ----

const STORAGE_KEY = 'meccg-player-name';
const VIEW_KEY = 'meccg-view-mode';
const DECK_KEY = 'meccg-deck-index';

function savePlayerName(name: string): void {
  localStorage.setItem(STORAGE_KEY, name);
}

function loadPlayerName(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

function clearPlayerName(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ---- Disconnect ----

let autoReconnect = true;

function disconnect(): void {
  autoReconnect = false;
  clearPlayerName();
  if (ws) {
    ws.close();
    ws = null;
  }
  playerId = null;
  gamePort = null;
  gameToken = null;
  clearGameSession();

  // Reset game state
  document.getElementById('state')!.textContent = '';
  document.getElementById('draft')!.textContent = '';
  document.getElementById('actions')!.innerHTML = '';
  document.getElementById('log')!.innerHTML = '';
  clearDice();
  resetVisualBoard();
  resetCompanyViews();
  for (const id of ['self-deck-box', 'opponent-deck-box']) {
    document.getElementById(id)?.classList.add('hidden');
  }

  document.getElementById('game')!.classList.add('hidden');

  if (LOBBY_MODE && lobbyPlayerName) {
    // Return to lobby
    showScreen('lobby-screen');
    connectLobbyWs();
  } else {
    // Return to connect form
    document.getElementById('connect-form')!.style.display = '';
    (document.getElementById('name-input') as HTMLInputElement).value = '';
  }
}

/**
 * Clear the visual board and restore its skeleton child elements
 * (instruction text, drafted rows, set-aside) so that subsequent
 * renderDrafted() calls can find them.
 */
function resetVisualBoard(): void {
  const board = document.getElementById('visual-board')!;
  board.innerHTML = '';
  // Clear instruction text (lives outside visual-board now)
  const instrEl = document.getElementById('instruction-text');
  if (instrEl) instrEl.textContent = '';
  for (const [id, cls] of [
    ['drafted-opponent', 'drafted-row'],
    ['set-aside', ''],
    ['drafted-self', 'drafted-row'],
  ] as const) {
    const el = document.createElement('div');
    el.id = id;
    if (cls) el.className = cls;
    board.appendChild(el);
  }
}

// ---- Background ----

const BACKGROUNDS = [
  'images/visual-bg.png',
  'images/visual-bg-2.png',
  'images/visual-bg-3.png',
  'images/visual-bg-4.png',
  'images/visual-bg-5.png',
  'images/visual-bg-6.png',
  'images/visual-bg-7.png',
  'images/visual-bg-8.png',
  'images/visual-bg-9.png',
  'images/visual-bg-10.png',
  'images/visual-bg-11.png',
  'images/visual-bg-12.png',
  'images/visual-bg-13.png',
  'images/visual-bg-14.png',
  'images/visual-bg-15.png',
  'images/visual-bg-16.png',
  'images/visual-bg-17.png',
  'images/visual-bg-18.png',
  'images/visual-bg-19.png',
  'images/visual-bg-20.png',
];
const DEV_MODE_KEY = 'meccg-dev-mode';
const AUTO_PASS_KEY = 'meccg-auto-pass';
const BG_KEY = 'meccg-bg';

function applyBackground(): void {
  const saved = localStorage.getItem(BG_KEY);
  const bg = saved && BACKGROUNDS.includes(saved) ? saved : BACKGROUNDS[0];
  document.documentElement.style.setProperty('--visual-bg', `url('${bg}')`);
}

function selectRandomBackground(): void {
  const bg = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
  localStorage.setItem(BG_KEY, bg);
  document.documentElement.style.setProperty('--visual-bg', `url('${bg}')`);
}

// ---- Lobby mode helpers ----

/** Show one screen, hiding all others. */
function showScreen(id: 'login-screen' | 'register-screen' | 'lobby-screen' | 'connect-form'): void {
  for (const screenId of ['login-screen', 'register-screen', 'lobby-screen', 'connect-form']) {
    const el = document.getElementById(screenId);
    if (el) el.classList.toggle('hidden', screenId !== id);
  }
  // Reset lobby button state when showing the lobby
  if (id === 'lobby-screen') {
    const btn = document.getElementById('play-ai-btn') as HTMLButtonElement | null;
    if (btn) { btn.textContent = 'Play vs AI'; btn.disabled = false; }
  }
}

/** Show an error message on an auth form. */
function showAuthError(id: string, msg: string): void {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
}

/** Connect the lobby WebSocket for online presence and challenges. */
function connectLobbyWs(): void {
  if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  lobbyWs = new WebSocket(`${protocol}//${window.location.host}`);

  lobbyWs.onmessage = (event) => {
    const msg = JSON.parse(event.data as string) as { type: string; [key: string]: unknown };
    switch (msg.type) {
      case 'online-players': {
        const players = (msg.players as string[]).filter(n => n !== lobbyPlayerName);
        const container = document.getElementById('online-players')!;
        if (players.length === 0) {
          container.innerHTML = '<p class="lobby-empty">No other players online</p>';
        } else {
          container.innerHTML = '';
          for (const name of players) {
            const item = document.createElement('div');
            item.className = 'lobby-player-item';
            const span = document.createElement('span');
            span.textContent = name;
            const btn = document.createElement('button');
            btn.textContent = 'Challenge';
            btn.addEventListener('click', () => {
              lobbyWs?.send(JSON.stringify({ type: 'challenge', opponentName: name }));
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
        challengeFrom = msg.from as string;
        const incoming = document.getElementById('challenge-incoming')!;
        document.getElementById('challenge-text')!.textContent = `${challengeFrom} wants to play!`;
        incoming.classList.remove('hidden');
        break;
      }
      case 'challenge-declined': {
        renderLog(`${msg.by as string} declined your challenge.`);
        break;
      }
      case 'game-starting': {
        gamePort = msg.port as number;
        gameToken = msg.token as string;
        const opponent = msg.opponent as string;
        saveGameSession();
        // Close lobby WS during game
        if (lobbyWs) { lobbyWs.close(); lobbyWs = null; }
        // Hide lobby, show game
        showScreen('login-screen'); // hide all screens
        document.getElementById('login-screen')!.classList.add('hidden');
        document.getElementById('game')!.classList.remove('hidden');
        selectRandomBackground();
        autoReconnect = true;
        renderLog(`Game starting vs ${opponent} on port ${gamePort}...`);
        connect(lobbyPlayerName!);
        break;
      }
      case 'error': {
        renderLog(`Lobby: ${msg.message as string}`);
        break;
      }
    }
  };

  lobbyWs.onclose = () => {
    lobbyWs = null;
  };
}

/** Initialize lobby mode on page load. */
async function initLobby(): Promise<void> {
  try {
    const resp = await fetch('/api/me');
    if (resp.ok) {
      const data = await resp.json() as { name: string };
      lobbyPlayerName = data.name;
      document.getElementById('lobby-player-name')!.textContent = data.name;

      // Rejoin active game if session was saved (e.g. page refresh)
      if (restoreGameSession()) {
        showScreen('login-screen');
        document.getElementById('login-screen')!.classList.add('hidden');
        document.getElementById('game')!.classList.remove('hidden');
        selectRandomBackground();
        autoReconnect = true;
        renderLog(`Reconnecting to game on port ${gamePort}...`);
        connect(lobbyPlayerName);
        return;
      }

      showScreen('lobby-screen');
      connectLobbyWs();
    } else {
      showScreen('login-screen');
    }
  } catch {
    showScreen('login-screen');
  }
}

// ---- UI Setup ----

document.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('name-input') as HTMLInputElement;
  const deckSelect = document.getElementById('deck-select') as HTMLSelectElement;
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
  const connectForm = document.getElementById('connect-form') as HTMLElement;
  const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;

  // Populate deck selector
  for (let i = 0; i < SAMPLE_DECKS.length; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = SAMPLE_DECKS[i].label;
    deckSelect.appendChild(opt);
  }

  // Restore saved deck selection
  const savedDeck = localStorage.getItem(DECK_KEY);
  if (savedDeck !== null) {
    const idx = parseInt(savedDeck, 10);
    if (idx >= 0 && idx < SAMPLE_DECKS.length) {
      selectedDeckIndex = idx;
      deckSelect.value = String(idx);
    }
  }

  deckSelect.addEventListener('change', () => {
    selectedDeckIndex = parseInt(deckSelect.value, 10);
    localStorage.setItem(DECK_KEY, String(selectedDeckIndex));
  });

  applyBackground();
  setupCardPreview(cardPool);
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
    viewToggleBtn.textContent = visual ? 'Debug' : 'Visual';
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

  /** Flash a button to confirm the action was triggered. */
  function flashBtn(btn: HTMLElement): void {
    btn.classList.remove('btn-flash');
    void btn.offsetWidth;
    btn.classList.add('btn-flash');
  }

  // Restore saved view mode
  if (localStorage.getItem(VIEW_KEY) === 'visual') {
    setViewMode(true);
  }

  function startGame(name: string, newBackground = false): void {
    if (newBackground) selectRandomBackground();
    savePlayerName(name);
    autoReconnect = true;
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
    const showRegisterLink = document.getElementById('show-register') as HTMLAnchorElement;
    const showLoginLink = document.getElementById('show-login') as HTMLAnchorElement;
    const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
    const playAiBtn = document.getElementById('play-ai-btn') as HTMLButtonElement;
    const acceptChallengeBtn = document.getElementById('accept-challenge-btn') as HTMLButtonElement;
    const declineChallengeBtn = document.getElementById('decline-challenge-btn') as HTMLButtonElement;

    showRegisterLink.addEventListener('click', (e) => { e.preventDefault(); showScreen('register-screen'); });
    showLoginLink.addEventListener('click', (e) => { e.preventDefault(); showScreen('login-screen'); });

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
        const data = await resp.json() as { name?: string; error?: string };
        if (!resp.ok) { showAuthError('login-error', data.error ?? 'Login failed'); return; }
        lobbyPlayerName = data.name!;
        document.getElementById('lobby-player-name')!.textContent = lobbyPlayerName;
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
      const email = (document.getElementById('register-email') as HTMLInputElement).value.trim();
      const password = (document.getElementById('register-password') as HTMLInputElement).value;
      if (!name || !email || !password) { showAuthError('register-error', 'All fields are required'); return; }
      try {
        const resp = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await resp.json() as { name?: string; error?: string };
        if (!resp.ok) { showAuthError('register-error', data.error ?? 'Registration failed'); return; }
        lobbyPlayerName = data.name!;
        document.getElementById('lobby-player-name')!.textContent = lobbyPlayerName;
        showScreen('lobby-screen');
        connectLobbyWs();
      } catch { showAuthError('register-error', 'Connection error'); }
    })(); });

    // Enter key on register form
    for (const id of ['register-name', 'register-email', 'register-password']) {
      document.getElementById(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') registerBtn.click(); });
    }

    logoutBtn.addEventListener('click', () => { void (async () => {
      await fetch('/api/logout', { method: 'POST' });
      lobbyPlayerName = null;
      if (lobbyWs) { lobbyWs.close(); lobbyWs = null; }
      showScreen('login-screen');
    })(); });

    playAiBtn.addEventListener('click', () => {
      if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
        lobbyWs.send(JSON.stringify({ type: 'play-ai' }));
        playAiBtn.textContent = 'Starting...';
        playAiBtn.disabled = true;
      }
    });

    acceptChallengeBtn.addEventListener('click', () => {
      if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN && challengeFrom) {
        lobbyWs.send(JSON.stringify({ type: 'accept-challenge', from: challengeFrom }));
        document.getElementById('challenge-incoming')!.classList.add('hidden');
        challengeFrom = null;
      }
    });

    declineChallengeBtn.addEventListener('click', () => {
      if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN && challengeFrom) {
        lobbyWs.send(JSON.stringify({ type: 'decline-challenge', from: challengeFrom }));
        document.getElementById('challenge-incoming')!.classList.add('hidden');
        challengeFrom = null;
      }
    });
  }

  // ---- Enter key: activate single action button in the action list ----
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // Don't trigger if an input/textarea/button is focused or a modal is open
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'button' || tag === 'select') return;
    const actionsEl = document.getElementById('actions');
    if (!actionsEl) return;
    const buttons = actionsEl.querySelectorAll('button:not([disabled])');
    if (buttons.length === 1) {
      const btn = buttons[0] as HTMLButtonElement;
      btn.classList.add('btn--flash');
      setTimeout(() => btn.classList.remove('btn--flash'), 300);
      btn.click();
    }
  });

  // ---- Settings modal ----
  const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
  const settingsModal = document.getElementById('settings-modal') as HTMLElement;
  const settingsBackdrop = document.getElementById('settings-backdrop') as HTMLElement;
  const settingsCloseBtn = document.getElementById('settings-close-btn') as HTMLButtonElement;
  const devModeToggle = document.getElementById('dev-mode-toggle') as HTMLInputElement;

  const cheatRollSelect = document.getElementById('cheat-roll-select') as HTMLSelectElement;
  const summonBtn = document.getElementById('summon-btn') as HTMLButtonElement;
  const toolbarDev = document.getElementById('toolbar-dev') as HTMLElement;

  function applyDevMode(on: boolean): void {
    toolbarDev.style.display = on ? '' : 'none';
  }

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
    if (!autoPassToggle.checked && autoPassTimer) {
      clearTimeout(autoPassTimer);
      autoPassTimer = null;
    }
  });

  disconnectBtn.addEventListener('click', () => {
    disconnect();
  });

  undoBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'undo' };
      ws.send(JSON.stringify(msg));
      // Revert game log to the snapshot before the last action
      const logEl = document.getElementById('log');
      if (logEl && logCountStack.length > 0) {
        const target = logCountStack.pop()!;
        while (logEl.childElementCount > target) {
          logEl.removeChild(logEl.lastChild!);
        }
      }
      flashBtn(undoBtn);
    }
  });

  saveBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'save' };
      ws.send(JSON.stringify(msg));
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
    resetCompanyViews();
    clearDice();
  }

  reseedBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'reseed' };
      ws.send(JSON.stringify(msg));
      flashBtn(reseedBtn);
    }
  });

  cheatRollSelect.addEventListener('change', () => {
    const total = parseInt(cheatRollSelect.value, 10);
    if (ws && ws.readyState === WebSocket.OPEN && total >= 2 && total <= 12) {
      const msg: ClientMessage = { type: 'cheat-roll', total };
      ws.send(JSON.stringify(msg));
      renderLog(`>> Cheat: next roll will be ${total}`, cardPool);
    }
    cheatRollSelect.value = '';  // Reset to "Roll" label
  });

  summonBtn.addEventListener('click', () => {
    const cardName = prompt('Enter card name to summon:');
    if (cardName && ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'summon-card', cardName };
      ws.send(JSON.stringify(msg));
      renderLog(`>> Cheat: summoning "${cardName}"`, cardPool);
      flashBtn(summonBtn);
    }
  });

  loadBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'load' };
      ws.send(JSON.stringify(msg));
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
            if (ws && ws.readyState === WebSocket.OPEN) {
              const msg: ClientMessage = { type: 'load-snapshot', file: snap.file };
              ws.send(JSON.stringify(msg));
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
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'reset' };
      ws.send(JSON.stringify(msg));
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
