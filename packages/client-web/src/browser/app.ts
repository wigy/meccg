/**
 * @module app
 *
 * Browser entry point for the MECCG web client. Connects to the
 * client-web server via WebSocket (which proxies to the game server),
 * renders game state, and sends actions on button click.
 */

import type { ServerMessage, ClientMessage, JoinMessage, GameAction, CardDefinitionId } from '@meccg/shared';
import {
  loadCardPool, describeAction,
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

  ws.onmessage = (event) => {
    const msg: ServerMessage = JSON.parse(event.data as string) as ServerMessage;

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
    renderLog('Disconnected. Reconnecting in 2s...');
    setTimeout(() => connect(name), 2000);
  };

  ws.onerror = () => {
    // Will trigger onclose
  };
}

// ---- UI Setup ----

document.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('name-input') as HTMLInputElement;
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
  const connectForm = document.getElementById('connect-form') as HTMLElement;

  connectBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    connectForm.style.display = 'none';
    document.getElementById('game')!.classList.remove('hidden');
    connect(name);
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectBtn.click();
  });
});
