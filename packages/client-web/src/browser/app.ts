/**
 * @module app
 *
 * Browser entry point for the MECCG web client. Connects to the
 * client-web server via WebSocket (which proxies to the game server),
 * renders game state, and sends actions on button click.
 */

import type { ServerMessage, ClientMessage, JoinMessage, GameAction, CardDefinitionId } from '@meccg/shared';
import {
  loadCardPool, describeAction, Alignment,
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, SAM_GAMGEE, ELROND, CELEBORN, THEODEN, BEORN,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM,
} from '@meccg/shared';
import { renderState, renderDraft, renderActions, renderLog } from './render.js';

const cardPool = loadCardPool();

let ws: WebSocket | null = null;
let playerId: string | null = null;

function buildDefaultPlayDeck(): CardDefinitionId[] {
  const resources = [GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING];
  const hazards = [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT];
  const deck: CardDefinitionId[] = [];
  for (let i = 0; i < 5; i++) {
    deck.push(...resources, ...hazards);
  }
  return deck;
}

function buildJoinMessage(name: string): JoinMessage {
  return {
    type: 'join',
    name,
    alignment: Alignment.Hero,
    draftPool: [ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, SAM_GAMGEE, ELROND, CELEBORN, THEODEN, BEORN],
    startingMinorItems: [DAGGER_OF_WESTERNESSE],
    playDeck: buildDefaultPlayDeck(),
    siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
    startingHavens: [RIVENDELL],
  };
}

function sendAction(action: GameAction): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const desc = describeAction(action, cardPool);
  renderLog(`>> ${desc}`);
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
    ws!.send(JSON.stringify(buildJoinMessage(name)));
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
        renderLog(`State update: turn ${msg.view.turnNumber}, phase ${msg.view.phaseState.phase}`);
        renderState(msg.view, cardPool);
        renderDraft(msg.view, cardPool);
        renderActions(msg.view.legalActions, cardPool, sendAction);
        break;

      case 'draft-reveal': {
        const p1 = msg.player1Pick ? (cardPool[msg.player1Pick as string]?.name ?? msg.player1Pick) : 'stopped';
        const p2 = msg.player2Pick ? (cardPool[msg.player2Pick as string]?.name ?? msg.player2Pick) : 'stopped';
        renderLog(`Draft reveal: ${msg.player1Name} → ${p1}, ${msg.player2Name} → ${p2}`);
        if (msg.collision) {
          renderLog(`  Collision! ${p1} is set aside.`);
        }
        break;
      }

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
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
  const connectForm = document.getElementById('connect-form') as HTMLElement;
  const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;
  const viewToggleBtn = document.getElementById('view-toggle-btn') as HTMLButtonElement;
  const debugView = document.getElementById('debug-view') as HTMLElement;
  const visualView = document.getElementById('visual-view') as HTMLElement;

  function setViewMode(visual: boolean): void {
    debugView.classList.toggle('hidden', visual);
    visualView.classList.toggle('hidden', !visual);
    viewToggleBtn.textContent = visual ? 'Debug' : 'Visual';
    localStorage.setItem(VIEW_KEY, visual ? 'visual' : 'debug');
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

  disconnectBtn.addEventListener('click', () => {
    disconnect();
  });

  // Auto-connect if name is stored from a previous session
  const savedName = loadPlayerName();
  if (savedName) {
    startGame(savedName);
  }
});
