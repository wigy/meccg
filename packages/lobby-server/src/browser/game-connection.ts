/**
 * @module game-connection
 *
 * Game server WebSocket connection management. Handles connecting to the
 * game server, processing incoming server messages (state updates, effects,
 * errors), reconnection logic, and the rejoin flow for when a game server
 * dies and the lobby relaunches it.
 */

import type { CardDefinitionId, CardInstanceId, ClientMessage, GameAction, ServerMessage } from '@meccg/shared';
import { buildCompanyNames, buildInstanceLookup, canonicalActionKey, describeAction } from '@meccg/shared';
import {
  appState, cardPool, LOBBY_MODE, buildJoinFromDeck,
  MAX_RECONNECT_ATTEMPTS, AUTO_PASS_KEY, type ScreenId,
} from './app-state.js';
import { clearGameSession, clearPlayerName, saveGameSession } from './session.js';
import { connectPseudoAi } from './pseudo-ai.js';
import { renderState, renderDraft, renderMHInfo, renderSiteInfo, renderFreeCouncilInfo, renderGameOverView, renderActions, renderLog, renderHand, renderOpponentHand, renderPlayerNames, renderInstructions, renderDrafted, renderPassButton, renderDeckPiles, resetDeckPiles, showNotification, prepareSiteSelection, prepareFetchFromPile, clearSelectionState, renderChainPanel } from './render.js';
import { renderCompanyViews, resetCompanyViews } from './company-view.js';
import { rollDice, clearDice, waitForDice } from './dice.js';
import { snapshotPositions, animateFromSnapshot } from './flip-animate.js';

// Forward-declared function references set by the lobby module to avoid
// circular imports. The lobby module calls setLobbyCallbacks() at startup.
let showScreenFn: ((id: ScreenId) => void) | null = null;
let connectLobbyWsFn: (() => void) | null = null;

/** Register lobby-side callbacks to break the circular dependency. */
export function setLobbyCallbacks(
  showScreen: (id: ScreenId) => void,
  connectLobbyWs: () => void,
): void {
  showScreenFn = showScreen;
  connectLobbyWsFn = connectLobbyWs;
}

/** Guard flag: true while waiting for the server to respond after sending an action. */
let awaitingResponse = false;

/** Clear the awaiting-response guard (called when new state arrives). */
export function clearAwaitingResponse(): void {
  awaitingResponse = false;
}

/** Send a game action to the server. */
export function sendAction(action: GameAction): void {
  if (!appState.ws || appState.ws.readyState !== WebSocket.OPEN) return;
  if (awaitingResponse) return; // Prevent double-sends before next state
  awaitingResponse = true;

  // Snapshot log entry count before adding action log line
  const logEl = document.getElementById('log');
  if (logEl) appState.logCountStack.push(logEl.childElementCount);
  const desc = describeAction(action, cardPool, appState.lastInstanceLookup, appState.lastCompanyNames);
  renderLog(`>> ${desc}`, cardPool);
  const msg: ClientMessage = { type: 'action', action, actionId: canonicalActionKey(action) };
  appState.ws.send(JSON.stringify(msg));

  // After acknowledging game result, return to lobby
  if (action.type === 'finished') {
    disconnect();
  }
}

/** Disconnect from the game server and return to the lobby or connect form. */
export function disconnect(): void {
  appState.autoReconnect = false;
  clearPlayerName();
  if (appState.ws) {
    appState.ws.close();
    appState.ws = null;
  }
  appState.playerId = null;
  appState.gamePort = null;
  appState.gameToken = null;
  appState.isPseudoAi = false;
  appState.pseudoAiToken = null;
  if (appState.pseudoAiWs) { appState.pseudoAiWs.close(); appState.pseudoAiWs = null; }
  clearGameSession();

  // Reset game state
  document.getElementById('state')!.textContent = '';
  document.getElementById('draft')!.textContent = '';
  document.getElementById('actions')!.innerHTML = '';
  document.getElementById('log')!.innerHTML = '';
  // Hide pseudo-AI panel
  const pseudoPanel = document.getElementById('pseudo-ai-panel');
  if (pseudoPanel) {
    pseudoPanel.classList.add('hidden');
    pseudoPanel.classList.remove('minimized');
    document.getElementById('pseudo-ai-actions')!.innerHTML = '';
  }
  clearDice();
  resetVisualBoard();
  resetCompanyViews();
  for (const id of ['self-deck-box', 'opponent-deck-box']) {
    document.getElementById(id)?.classList.add('hidden');
  }

  document.getElementById('game')!.classList.add('hidden');

  if (LOBBY_MODE && appState.lobbyPlayerName) {
    // Return to lobby
    showScreenFn?.('lobby-screen');
    connectLobbyWsFn?.();
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
export function resetVisualBoard(): void {
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

/**
 * Ask the lobby to relaunch the game server after it died. Opens a lobby
 * WebSocket, sends a `rejoin-game` message, and waits for `game-starting`.
 * Retries if the lobby itself is still restarting. Falls back to the lobby
 * screen after MAX_REJOIN_ATTEMPTS failures.
 */
const MAX_REJOIN_ATTEMPTS = 10;
const REJOIN_RETRY_DELAY = 2000;

function requestRejoin(): void {
  appState.autoReconnect = false;
  if (appState.ws) { appState.ws.close(); appState.ws = null; }

  const opponent = appState.opponentName;
  if (!opponent) {
    renderLog('Cannot rejoin -- opponent unknown. Returning to lobby.');
    disconnect();
    return;
  }

  let attempts = 0;

  function tryRejoin(): void {
    attempts++;
    if (attempts > MAX_REJOIN_ATTEMPTS) {
      renderLog('Lobby unreachable -- returning to lobby.');
      showNotification('Lobby unreachable -- returning to lobby.', true);
      disconnect();
      return;
    }
    renderLog(`Requesting game relaunch... (attempt ${attempts}/${MAX_REJOIN_ATTEMPTS})`);

    // Close any stale lobby WS
    if (appState.lobbyWs) { appState.lobbyWs.close(); appState.lobbyWs = null; }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const rejoinWs = new WebSocket(`${protocol}//${window.location.host}`);

    const cleanup = () => { rejoinWs.onopen = null; rejoinWs.onclose = null; rejoinWs.onmessage = null; };

    rejoinWs.onopen = () => {
      rejoinWs.send(JSON.stringify({ type: 'rejoin-game', opponent }));
    };

    rejoinWs.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as { type: string; [key: string]: unknown };
      if (msg.type === 'game-starting') {
        cleanup();
        // Hand off to the normal game-starting flow
        appState.gamePort = msg.port as number;
        appState.gameToken = msg.token as string;
        appState.opponentName = (msg.opponent as string) ?? opponent;
        appState.isPseudoAi = (msg.pseudoAi as boolean) ?? false;
        appState.pseudoAiToken = (msg.aiToken as string) ?? null;
        saveGameSession();
        // Keep this WS as the lobby WS (it's authenticated)
        appState.lobbyWs = rejoinWs;
        appState.lobbyWs.onclose = () => { appState.lobbyWs = null; };
        // Close lobby WS during game
        appState.lobbyWs.close();
        appState.lobbyWs = null;
        appState.autoReconnect = true;
        renderLog(`Game relaunched on port ${appState.gamePort}. Connecting...`);
        connect(appState.lobbyPlayerName!);
        if (appState.isPseudoAi && appState.opponentName) {
          connectPseudoAi(appState.opponentName);
        }
      } else if (msg.type === 'error') {
        renderLog(`Lobby: ${msg.message as string}`);
        cleanup();
        rejoinWs.close();
        showNotification(msg.message as string, true);
        disconnect();
      }
      // Ignore other lobby messages (online-players, etc.) during rejoin
    };

    rejoinWs.onclose = () => {
      cleanup();
      // Lobby not ready yet -- retry after delay
      setTimeout(tryRejoin, REJOIN_RETRY_DELAY);
    };
  }

  tryRejoin();
}

/** Connect to the game server via WebSocket. */
export function connect(name: string): void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let url: string;
  if (LOBBY_MODE && appState.gamePort) {
    // Proxied through the lobby at /game/<port> so a single-port TLS
    // terminator (e.g. nginx-proxy) can front the whole deployment.
    url = `${protocol}//${window.location.host}/game/${appState.gamePort}`;
  } else {
    // Proxy through the web-client server (standalone mode)
    url = `${protocol}//${window.location.host}`;
  }

  renderLog(`Connecting to ${url} as "${name}"...`);
  appState.ws = new WebSocket(url);

  appState.ws.onopen = () => {
    renderLog('Connected. Sending join...');
    if (!appState.currentFullDeck) {
      // Reconnecting to an existing game (e.g. page refresh) -- the server
      // already has the deck, so send a minimal join with just the name.
      const minimalJoin = {
        type: 'join' as const,
        name,
        alignment: 0,
        draftPool: [] as string[],
        playDeck: [] as string[],
        siteDeck: [] as string[],
        sideboard: [] as string[],
      };
      const msg = appState.gameToken ? { ...minimalJoin, token: appState.gameToken } : minimalJoin;
      appState.ws!.send(JSON.stringify(msg));
      return;
    }
    const joinMsg = buildJoinFromDeck(appState.currentFullDeck, name);
    // In lobby mode, attach the game token for authentication
    const msg = appState.gameToken ? { ...joinMsg, token: appState.gameToken } : joinMsg;
    appState.ws!.send(JSON.stringify(msg));
  };

  appState.ws.onmessage = async (event) => {
    const raw = event.data instanceof Blob ? await event.data.text() : event.data as string;
    const msg: ServerMessage = JSON.parse(raw) as ServerMessage;

    switch (msg.type) {
      case 'assigned':
        appState.reconnectAttempts = 0;
        appState.playerId = msg.playerId;
        appState.currentGameId = msg.gameId;
        renderLog(`Game ${msg.gameId} -- assigned player ID: ${appState.playerId}`);
        { const h = document.getElementById('state-heading');
          if (h) {
            // Set text without destroying the copy button child
            h.childNodes[0].textContent = `Game State \u2014 ${msg.gameId}`;
            const copyBtn = document.getElementById('copy-game-code-btn');
            if (copyBtn) {
              copyBtn.classList.remove('hidden');
              copyBtn.onclick = () => {
                void navigator.clipboard.writeText(`game ${msg.gameId} seq ${appState.currentStateSeq}`).then(() => showNotification('Copied!'));
              };
            }
          }
        }
        break;

      case 'waiting':
        renderLog('Waiting for opponent to connect...');
        showNotification('Waiting for opponent to connect...');
        break;

      case 'state': {
        // Wait for any dice animation to finish before rendering the new
        // state, so the outcome isn't spoiled while dice are still rolling.
        await waitForDice();
        clearAwaitingResponse();
        appState.currentStateSeq = msg.view.stateSeq;
        // Update heading to show game ID + seq
        const h = document.getElementById('state-heading');
        if (h && appState.currentGameId) {
          h.childNodes[0].textContent = `Game State \u2014 ${appState.currentGameId} seq ${appState.currentStateSeq}`;
        }
        // Capture previous lookup so opponent toast uses pre-action visibility
        const prevInstanceLookup = appState.lastInstanceLookup;
        const prevCompanyNames = appState.lastCompanyNames;
        appState.lastInstanceLookup = buildInstanceLookup(msg.view);
        appState.lastCompanyNames = {
          ...buildCompanyNames(msg.view.self.companies, msg.view.self.characters, cardPool),
          ...buildCompanyNames(msg.view.opponent.companies as never, msg.view.opponent.characters, cardPool),
        };
        // Merge in action-referenced card defs from the server. A played
        // card's identity is public via the action itself even when the
        // card now sits in a redacted pile (e.g. short event sent to the
        // opponent's face-down discard), so the prev/next view lookups
        // alone would render "a card" in the toast.
        const actionLookup = (id: CardInstanceId): CardDefinitionId | undefined =>
          msg.lastActionCardDefs?.[id as string] ?? prevInstanceLookup(id);
        renderLog(`State update: turn ${msg.view.turnNumber}, phase ${msg.view.phaseState.phase}`);
        // Log opponent actions so the text log captures what the other player did
        if (msg.lastAction && msg.lastAction.player !== msg.view.self.id) {
          const desc = describeAction(msg.lastAction, cardPool, actionLookup, prevCompanyNames);
          renderLog(`<< ${desc}`, cardPool);
        }
        // Snapshot card positions before clearing DOM for FLIP animation
        snapshotPositions();
        renderState(msg.view, cardPool);
        renderDraft(msg.view, cardPool);
        renderMHInfo(msg.view, cardPool, appState.lastCompanyNames);
        renderSiteInfo(msg.view, cardPool, appState.lastCompanyNames);
        renderFreeCouncilInfo(msg.view, cardPool);
        renderActions(msg.view.legalActions, cardPool, sendAction, appState.lastInstanceLookup, appState.lastCompanyNames);
        renderHand(msg.view, cardPool, sendAction);
        renderOpponentHand(msg.view, cardPool);
        renderPlayerNames(msg.view, cardPool);
        renderInstructions(msg.view, cardPool);
        renderDrafted(msg.view, cardPool, sendAction);
        renderPassButton(msg.view, sendAction);
        renderDeckPiles(msg.view, cardPool);
        renderCompanyViews(msg.view, cardPool, sendAction);
        renderGameOverView(msg.view, cardPool);
        renderChainPanel(msg.view, cardPool, sendAction);
        // Animate cards from old positions to new positions
        animateFromSnapshot();
        // Show turn notification when entering Untap phase
        if (msg.view.phaseState.phase === 'untap' && appState.lastPhase !== 'untap') {
          const isMine = msg.view.activePlayer === msg.view.self.id;
          showNotification(
            isMine ? 'Your turn' : `${msg.view.opponent.name}'s turn`,
            isMine ? undefined : { opponent: '' },
          );
        }
        // Show notification describing what the opponent just did
        if (msg.lastAction && msg.lastAction.player !== msg.view.self.id
          && msg.lastAction.type !== 'pass' && msg.lastAction.type !== 'pass-chain-priority') {
          const desc = describeAction(msg.lastAction, cardPool, actionLookup, prevCompanyNames);
          showNotification(desc, { cardPool, opponent: msg.view.opponent.name });
        }
        appState.lastPhase = msg.view.phaseState.phase;
        // Prepare/clear site selection or fetch-from-pile based on legal actions
        if (msg.view.legalActions.some(ea => ea.action.type === 'select-starting-site')) {
          prepareSiteSelection(msg.view, cardPool, sendAction);
        } else if (msg.view.legalActions.some(ea => ea.viable && ea.action.type === 'fetch-from-pile')) {
          prepareFetchFromPile(msg.view, cardPool, sendAction);
        } else {
          clearSelectionState();
        }
        // Auto-pass: if exactly one viable action, send it after a delay
        if (appState.autoPassTimer) { clearTimeout(appState.autoPassTimer); appState.autoPassTimer = null; }
        if (localStorage.getItem(AUTO_PASS_KEY) === 'true') {
          const viable = msg.view.legalActions.filter(a => a.viable);
          if (viable.length === 1) {
            appState.autoPassTimer = setTimeout(() => {
              appState.autoPassTimer = null;
              sendAction(viable[0].action);
            }, 1500);
          }
        }
        break;
      }

      case 'draft-reveal': {
        const p1 = msg.player1Pick ? (cardPool[msg.player1Pick as string]?.name ?? msg.player1Pick) : 'stopped';
        const p2 = msg.player2Pick ? (cardPool[msg.player2Pick as string]?.name ?? msg.player2Pick) : 'stopped';
        renderLog(`Draft reveal: ${msg.player1Name} \u2192 ${p1}, ${msg.player2Name} \u2192 ${p2}`, cardPool);
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
        clearAwaitingResponse();
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

  appState.ws.onclose = () => {
    if (appState.autoReconnect) {
      if (LOBBY_MODE && appState.opponentName) {
        // Ask the lobby to relaunch a fresh game server
        renderLog('Game server lost. Asking lobby to relaunch...');
        showNotification('Game server lost. Relaunching...');
        requestRejoin();
      } else {
        // Standalone mode: retry connecting to the same server
        appState.reconnectAttempts++;
        if (appState.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          renderLog('Game server unreachable -- returning to lobby.');
          showNotification('Game server unreachable -- returning to lobby.', true);
          disconnect();
          return;
        }
        renderLog(`Disconnected. Reconnecting in 2s... (attempt ${appState.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        setTimeout(() => connect(name), 2000);
      }
    }
  };

  appState.ws.onerror = () => {
    // Will trigger onclose
  };
}
