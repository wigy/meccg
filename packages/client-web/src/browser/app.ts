/**
 * @module app
 *
 * Browser entry point for the MECCG web client. Connects to the
 * client-web server via WebSocket (which proxies to the game server),
 * renders game state, and sends actions on button click.
 */

import type { ServerMessage, ClientMessage, GameAction, CardDefinitionId } from '@meccg/shared';
import { loadCardPool, describeAction, buildCompanyNames, SAMPLE_DECKS } from '@meccg/shared';
import { renderState, renderDraft, renderActions, renderLog, renderHand, renderOpponentHand, renderPlayerNames, renderInstructions, renderDrafted, renderPassButton, renderDeckPiles, resetDeckPiles, setupCardPreview, showNotification, openSiteSelectionViewer, closeSiteSelectionViewer } from './render.js';
import { renderCompanyViews, resetCompanyViews } from './company-view.js';
import { rollDice, clearDice, restoreDice } from './dice.js';
import { clientLog } from './client-log.js';

const cardPool = loadCardPool();

let ws: WebSocket | null = null;
let playerId: string | null = null;
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
  clientLog('msg-out', { msgType: 'action', action });
  const msg: ClientMessage = { type: 'action', action };
  ws.send(JSON.stringify(msg));
}

function connect(name: string): void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}`;

  renderLog(`Connecting to ${url} as "${name}"...`);
  ws = new WebSocket(url);

  ws.onopen = () => {
    renderLog('Connected. Sending join...');
    clientLog('connect', { server: url });
    const deck = SAMPLE_DECKS[selectedDeckIndex];
    clientLog('msg-out', { msgType: 'join', deck: deck.id });
    ws!.send(JSON.stringify(deck.buildJoinMessage(name)));
  };

  ws.onmessage = async (event) => {
    const raw = event.data instanceof Blob ? await event.data.text() : event.data as string;
    const msg: ServerMessage = JSON.parse(raw) as ServerMessage;

    switch (msg.type) {
      case 'assigned':
        playerId = msg.playerId;
        clientLog('msg-in', { msgType: 'assigned', gameId: msg.gameId, playerId });
        renderLog(`Game ${msg.gameId} — assigned player ID: ${playerId}`);
        { const h = document.getElementById('state-heading');
          if (h) h.textContent = `Game State — ${msg.gameId}`; }
        break;

      case 'waiting':
        renderLog('Waiting for opponent to connect...');
        showNotification('Waiting for opponent to connect...');
        break;

      case 'state':
        lastVisibleInstances = msg.view.visibleInstances;
        lastCompanyNames = buildCompanyNames(msg.view.self.companies, msg.view.self.characters, cardPool);
        clientLog('msg-in', { msgType: 'state', turn: msg.view.turnNumber, phase: msg.view.phaseState.phase });
        renderLog(`State update: turn ${msg.view.turnNumber}, phase ${msg.view.phaseState.phase}`);
        renderState(msg.view, cardPool);
        renderDraft(msg.view, cardPool);
        renderActions(msg.view.legalActions, cardPool, sendAction, msg.view.visibleInstances, lastCompanyNames);
        renderHand(msg.view, cardPool, sendAction);
        renderOpponentHand(msg.view, cardPool);
        renderPlayerNames(msg.view);
        renderInstructions(msg.view);
        renderDrafted(msg.view, cardPool, sendAction);
        renderPassButton(msg.view, sendAction);
        renderDeckPiles(msg.view, cardPool);
        renderCompanyViews(msg.view, cardPool, sendAction);
        // Show turn notification when entering Untap phase
        if (msg.view.phaseState.phase === 'untap' && lastPhase !== 'untap') {
          const isMine = msg.view.activePlayer === msg.view.self.id;
          showNotification(isMine ? 'Your turn' : "Opponent's turn");
        }
        lastPhase = msg.view.phaseState.phase;
        // Open/close site selection viewer based on phase
        if (msg.view.phaseState.phase === 'setup'
          && msg.view.phaseState.setupStep.step === 'starting-site-selection') {
          openSiteSelectionViewer(msg.view, cardPool, sendAction);
        } else {
          closeSiteSelectionViewer();
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

      case 'error':
        renderLog(`ERROR: ${msg.message}`);
        showNotification(msg.message, true);
        break;

      case 'disconnected':
        renderLog(msg.message);
        showNotification(msg.message);
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
    clientLog('disconnect');
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

  // Reset UI to connect form
  document.getElementById('connect-form')!.style.display = '';
  document.getElementById('game')!.classList.add('hidden');
  (document.getElementById('name-input') as HTMLInputElement).value = '';
  document.getElementById('state')!.textContent = '';
  document.getElementById('draft')!.textContent = '';
  document.getElementById('actions')!.innerHTML = '';
  document.getElementById('log')!.innerHTML = '';
  resetVisualBoard();
  resetCompanyViews();
}

/**
 * Clear the visual board and restore its skeleton child elements
 * (instruction text, drafted rows, set-aside) so that subsequent
 * renderDrafted() calls can find them.
 */
function resetVisualBoard(): void {
  const board = document.getElementById('visual-board')!;
  board.innerHTML = '';
  for (const [id, cls] of [
    ['instruction-text', ''],
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

  // ---- Settings modal ----
  const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
  const settingsModal = document.getElementById('settings-modal') as HTMLElement;
  const settingsBackdrop = document.getElementById('settings-backdrop') as HTMLElement;
  const settingsCloseBtn = document.getElementById('settings-close-btn') as HTMLButtonElement;
  const devModeToggle = document.getElementById('dev-mode-toggle') as HTMLInputElement;

  const devButtons = [undoBtn, saveBtn, loadBtn, reseedBtn, resetBtn, viewToggleBtn];

  function applyDevMode(on: boolean): void {
    for (const btn of devButtons) {
      btn.style.display = on ? '' : 'none';
    }
  }

  devModeToggle.checked = localStorage.getItem(DEV_MODE_KEY) === 'true';
  applyDevMode(devModeToggle.checked);

  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  function closeSettings(): void {
    settingsModal.classList.add('hidden');
  }

  settingsBackdrop.addEventListener('click', closeSettings);
  settingsCloseBtn.addEventListener('click', closeSettings);

  devModeToggle.addEventListener('change', () => {
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
      renderLog('Undo.');
      flashBtn(undoBtn);
    }
  });

  saveBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'save' };
      ws.send(JSON.stringify(msg));
      renderLog('Game saved.');
      showNotification('Game saved.');
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
    for (const id of ['self-name', 'opponent-name']) {
      const el = document.getElementById(id);
      const score = el?.querySelector('.score');
      if (score) score.textContent = '0';
    }
    resetCompanyViews();
    resetDeckPiles();
    clearDice();
  }

  reseedBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'reseed' };
      ws.send(JSON.stringify(msg));
      renderLog('RNG re-seeded.');
      showNotification('RNG re-seeded.');
      flashBtn(reseedBtn);
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

  resetBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'reset' };
      ws.send(JSON.stringify(msg));
      flashBtn(resetBtn);
      clearGameBoard();
    }
  });

  // Auto-connect if name is stored from a previous session
  const savedName = loadPlayerName();
  if (savedName) {
    startGame(savedName);
  }
});
