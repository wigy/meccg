/**
 * @module app
 *
 * Browser entry point for the MECCG web client. Connects to the
 * client-web server via WebSocket (which proxies to the game server),
 * renders game state, and sends actions on button click.
 */

import type { ServerMessage, ClientMessage, GameAction, CardDefinitionId } from '@meccg/shared';
import { loadCardPool, describeAction, SAMPLE_DECKS } from '@meccg/shared';
import { renderState, renderDraft, renderActions, renderLog, renderHand } from './render.js';
import { rollDice } from './dice.js';

const cardPool = loadCardPool();

let ws: WebSocket | null = null;
let playerId: string | null = null;
let lastVisibleInstances: Readonly<Record<string, CardDefinitionId>> = {};
let selectedDeckIndex = 0;

function sendAction(action: GameAction): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const desc = describeAction(action, cardPool, lastVisibleInstances);
  renderLog(`>> ${desc}`, cardPool);
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
    const deck = SAMPLE_DECKS[selectedDeckIndex];
    ws!.send(JSON.stringify(deck.buildJoinMessage(name)));
  };

  ws.onmessage = async (event) => {
    const raw = event.data instanceof Blob ? await event.data.text() : event.data as string;
    const msg: ServerMessage = JSON.parse(raw) as ServerMessage;

    switch (msg.type) {
      case 'assigned':
        playerId = msg.playerId;
        renderLog(`Assigned player ID: ${playerId}`);
        break;

      case 'waiting':
        renderLog('Waiting for opponent to connect...');
        break;

      case 'state':
        lastVisibleInstances = msg.view.visibleInstances;
        renderLog(`State update: turn ${msg.view.turnNumber}, phase ${msg.view.phaseState.phase}`);
        renderState(msg.view, cardPool);
        renderDraft(msg.view, cardPool);
        renderActions(msg.view.legalActions, cardPool, sendAction, msg.view.visibleInstances);
        renderHand(msg.view, cardPool);
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
        }
        break;

      case 'error':
        renderLog(`ERROR: ${msg.message}`);
        break;

      case 'disconnected':
        renderLog(msg.message);
        break;

      case 'restart':
        renderLog(msg.message);
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

  // Reset UI to connect form
  document.getElementById('connect-form')!.style.display = '';
  document.getElementById('game')!.classList.add('hidden');
  (document.getElementById('name-input') as HTMLInputElement).value = '';
  document.getElementById('state')!.textContent = '';
  document.getElementById('draft')!.textContent = '';
  document.getElementById('actions')!.innerHTML = '';
  document.getElementById('log')!.innerHTML = '';
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
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
  const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
  const viewToggleBtn = document.getElementById('view-toggle-btn') as HTMLButtonElement;
  const diceBtn = document.getElementById('dice-btn') as HTMLButtonElement;
  const debugView = document.getElementById('debug-view') as HTMLElement;
  const visualView = document.getElementById('visual-view') as HTMLElement;

  function setViewMode(visual: boolean): void {
    debugView.classList.toggle('hidden', visual);
    visualView.classList.toggle('hidden', !visual);
    diceBtn.classList.toggle('hidden', !visual);
    viewToggleBtn.textContent = visual ? 'Debug' : 'Visual';
    localStorage.setItem(VIEW_KEY, visual ? 'visual' : 'debug');
    saveBtn.classList.toggle('hidden', visual);
    loadBtn.classList.toggle('hidden', visual);
    resetBtn.classList.toggle('hidden', visual);
    if (!visual) {
      const log = document.getElementById('log')!;
      log.scrollTop = log.scrollHeight;
    }
  }

  viewToggleBtn.addEventListener('click', () => {
    setViewMode(!debugView.classList.contains('hidden'));
  });

  // Restore saved view mode
  if (localStorage.getItem(VIEW_KEY) === 'visual') {
    setViewMode(true);
  }

  function startGame(name: string): void {
    savePlayerName(name);
    autoReconnect = true;
    connectForm.style.display = 'none';
    document.getElementById('game')!.classList.remove('hidden');
    connect(name);
  }

  connectBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    startGame(name);
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectBtn.click();
  });

  diceBtn.addEventListener('click', () => {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    renderLog(`Dice roll: ${d1} + ${d2} = ${d1 + d2}`);
    rollDice(d1, d2);
  });

  disconnectBtn.addEventListener('click', () => {
    disconnect();
  });

  saveBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'save' };
      ws.send(JSON.stringify(msg));
      renderLog('Game saved.');
    }
  });

  loadBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'load' };
      ws.send(JSON.stringify(msg));
    }
  });

  resetBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'reset' };
      ws.send(JSON.stringify(msg));
    }
  });

  // Auto-connect if name is stored from a previous session
  const savedName = loadPlayerName();
  if (savedName) {
    startGame(savedName);
  }
});
