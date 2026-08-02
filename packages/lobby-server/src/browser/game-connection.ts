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
import { renderState, renderDraft, renderMHInfo, renderSiteInfo, renderFreeCouncilInfo, renderGameOverView, renderActions, renderLog, renderHand, renderOpponentHand, renderPlayerNames, renderPhaseMeter, renderDrafted, renderPassButton, renderDeckPiles, resetDeckPiles, showNotification, prepareSiteSelection, prepareFetchFromPile, prepareRevealRemoveFromDiscard, clearSelectionState, setTargetingInstruction, getTargetingInstruction, renderChainPanel, clearGameMessageLog } from './render.js';
import { renderCompanyViews, resetCompanyViews } from './company-view.js';
import { clearTutorialPanel, renderTutorialPanel } from './tutorial-panel.js';
import { rollDice, clearDice, waitForDice } from './dice.js';
import { snapshotPositions, animateFromSnapshot } from './flip-animate.js';
import { setSpectators } from './spectators.js';
import { queueEffectLog, flushEffectLog, clearEffectLog } from './effect-log-buffer.js';
import { diceRollLogLine, diceRollNotification } from './dice-roll-log.js';

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

/**
 * Toggle the full-screen "Loading..." cover over the game area. Shown from
 * connect() until the first complete state has been rendered, so the player
 * never sees intermediate renders (debug view, a previous game's board).
 */
function setLoadingCover(visible: boolean, text = 'Loading...'): void {
  document.getElementById('game-loading')?.classList.toggle('hidden', !visible);
  const textEl = document.getElementById('game-loading-text');
  if (textEl) textEl.textContent = text;
  // The tutorial panel and its pointer bubbles are fixed overlays on
  // document.body — the cover cannot hide them, so clear them explicitly or
  // stale instructions float above the loading screen. They re-render from
  // the first state broadcast after the cover drops.
  if (visible) clearTutorialPanel();
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
  const desc = describeAction(action, cardPool, appState.lastInstanceLookup, appState.lastCompanyNames, appState.lastPlayerNames);
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
  appState.spectating = false;
  document.body.classList.remove('spectating');
  appState.pseudoAiToken = null;
  if (appState.pseudoAiWs) { appState.pseudoAiWs.close(); appState.pseudoAiWs = null; }
  clearGameSession();

  // Pre-arm the loading cover for the next game: `#game` is about to be
  // hidden, and when it is next shown the cover must already be up.
  setLoadingCover(true);

  // Reset game state
  document.getElementById('state')!.textContent = '';
  document.getElementById('draft')!.textContent = '';
  document.getElementById('actions')!.innerHTML = '';
  document.getElementById('log')!.innerHTML = '';
  clearEffectLog();
  clearGameMessageLog();
  // Hide pseudo-AI panel
  const pseudoPanel = document.getElementById('pseudo-ai-panel');
  if (pseudoPanel) {
    pseudoPanel.classList.add('hidden');
    pseudoPanel.classList.remove('minimized');
    document.getElementById('pseudo-ai-actions')!.innerHTML = '';
  }
  clearDice();
  clearTutorialPanel();
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
 * (drafted rows, set-aside) so that subsequent renderDrafted() calls
 * can find them.
 */
export function resetVisualBoard(): void {
  const board = document.getElementById('visual-board')!;
  board.innerHTML = '';
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

/**
 * Describe an opponent action for the game log, masking information that
 * should not be visible to the player at this point in the game.
 *
 * For `plan-movement`, the destination site is secret until the M/H phase
 * reveals it. Even if the site instance happens to be resolvable via the
 * instance lookup (e.g. because it is another company's current site), we
 * must not expose the destination during the organization phase.
 */
/** Describe the outcome of a dice-roll action. Returns labelled log lines with isSelf flag. */
function describeRollOutcome(
  action: GameAction,
  view: import('@meccg/shared').PlayerView,
  prevSelfDice: import('@meccg/shared').TwoDiceSix | null,
  prevOppDice: import('@meccg/shared').TwoDiceSix | null,
  prevResolvedCount: number,
  prevCombatAttackingPlayerId: import('@meccg/shared').PlayerId | null,
  instanceToName: (id: import('@meccg/shared').CardInstanceId) => string,
): { line: string; isSelf: boolean }[] {
  const isSelf = action.player === view.self.id;
  const newSelfDice = view.self.lastDiceRoll;
  const newOppDice = view.opponent.lastDiceRoll;
  const fmtDice = (d: import('@meccg/shared').TwoDiceSix) => `[${d.die1},${d.die2}]=${d.die1 + d.die2}`;
  const diceChanged = (a: import('@meccg/shared').TwoDiceSix | null, b: import('@meccg/shared').TwoDiceSix | null) =>
    !a || !b || a.die1 !== b.die1 || a.die2 !== b.die2;

  // Body-check outcomes are no longer derived here: the engine emits a
  // `text-notification` effect describing the result (see handleBodyCheckRoll).
  // Deriving it client-side failed when the body check finalized combat —
  // `view.combat` becomes null, so the resolved strike assignment is gone and
  // the outcome line was silently dropped from the text log.
  if (action.type !== 'resolve-strike' && action.type !== 'agent-strike-roll') {
    return [];
  }

  // Skip CvCC sub-step 1 (tap declaration — no dice rolled, only attacker's side fires)
  const combat = view.combat;
  if (combat?.isCvCC && action.type === 'resolve-strike' && isSelf && view.self.id === combat.attackingPlayerId) {
    return []; // attacker's tap declaration, no roll yet
  }

  // Detect whether any new dice were rolled (either player)
  const selfChanged = diceChanged(newSelfDice, prevSelfDice);
  const oppChanged = diceChanged(newOppDice, prevOppDice);
  if (!selfChanged && !oppChanged) return [];

  const newResolved = combat?.strikeAssignments.filter(sa => sa.resolved).length ?? 0;
  const just = (combat && newResolved > prevResolvedCount)
    ? combat.strikeAssignments.filter(sa => sa.resolved).at(-1)
    : undefined;

  // CvCC resolve-strike: both dice changed — produce only the result line.
  // The roll lines already came from the effect notifications.
  // When combat ends on a tie (view.combat null), result is always Tie.
  // When body check is pending, result/attackerResult are already set on the current
  // strike assignment even though resolved=false — read them directly.
  const isCvCCResolve = combat?.isCvCC
    || (!combat && selfChanged && oppChanged && prevCombatAttackingPlayerId !== null);
  if (isCvCCResolve && (selfChanged || oppChanged)) {
    let resultLine: string;
    if (!combat) {
      resultLine = 'Tie';
    } else {
      const sa = combat.strikeAssignments[combat.currentStrikeIndex];
      if (!sa) return [];
      if (sa.result === 'wounded' || sa.result === 'eliminated') {
        resultLine = `${instanceToName(sa.characterId)} ${sa.result}`;
      } else if (sa.attackerResult === 'wounded' || sa.attackerResult === 'eliminated') {
        resultLine = `${instanceToName(sa.attackingCharacterId!)} ${sa.attackerResult}`;
      } else {
        resultLine = 'Tie';
      }
    }
    return [{ line: resultLine, isSelf: false }];
  }

  // Regular combat
  const actorDice = isSelf ? newSelfDice : newOppDice;
  if (!actorDice) return [];
  const need = (action as { need?: number }).need;
  const needStr = need !== undefined ? ` (needed ${need})` : '';
  const resultStr = just ? ` → ${just.result ?? '?'}` : '';
  return [{ line: `Rolled ${fmtDice(actorDice)}${needStr}${resultStr}`, isSelf }];
}

function describeOpponentAction(
  action: GameAction,
  pool: Readonly<Record<string, import('@meccg/shared').CardDefinition>>,
  lookup: (id: CardInstanceId) => CardDefinitionId | undefined,
  companyNames: Readonly<Record<string, string>>,
  playerNames: Readonly<Record<string, string>>,
): string {
  if (action.type === 'plan-movement') {
    const name = companyNames[action.companyId as string] ?? 'a company';
    return `Move ${name} to a site`;
  }
  return describeAction(action, pool, lookup, companyNames, playerNames);
}

/** Connect to the game server via WebSocket. */
export function connect(name: string): void {
  // Cover the game area until the first full state renders. In the
  // second-and-later games of a browser session this also hides the previous
  // game's still-rendered board (nothing clears it while `#game` is hidden).
  setLoadingCover(true);
  // A fresh connection starts clean; a restored cheated game re-flags via
  // the first 'state' message.
  appState.gameCheated = false;
  // Re-apply dev-mode UI: a spectator connection forces the debug menu and
  // debug-view toggle off; a player connection restores them per setting.
  window.__meccg?.refreshDevMode?.();
  // Mark spectator mode on the body so spectator-only CSS applies (e.g. the
  // hand arc must not lift on hover).
  document.body.classList.toggle('spectating', appState.spectating);
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
    if (!appState.currentFullDeck || appState.spectating) {
      // Reconnecting to an existing game (e.g. page refresh) -- the server
      // already has the deck, so send a minimal join with just the name.
      // A spectator never has a deck in the game either way, so the same
      // minimal join seats them (their name is not one of the two players).
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
        clearEffectLog();
        clearGameMessageLog();
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
        setLoadingCover(true, 'Waiting for opponent to connect...');
        break;

      case 'state': {
        // Wait for any dice animation to finish before rendering the new
        // state, so the outcome isn't spoiled while dice are still rolling.
        await waitForDice();
        clearAwaitingResponse();
        appState.currentStateSeq = msg.view.stateSeq;
        appState.currentTutorialStep = msg.view.tutorial
          ? `step ${msg.view.tutorial.stepIndex + 1}/${msg.view.tutorial.stepCount} (${msg.view.tutorial.stepId})`
          : null;
        // Body marker for tutorial games (mirrors the 'spectating' class):
        // e.g. keyboard-shortcut hint overlays are suppressed in the tutorial.
        document.body.classList.toggle('in-tutorial', msg.view.tutorial !== undefined);
        // Sticky: an undo can briefly broadcast a pre-cheat state, but a
        // game once marked cheated never becomes clean again.
        if (msg.view.cheated) appState.gameCheated = true;
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
        appState.lastPlayerNames = {
          [msg.view.self.id as string]: msg.view.self.name,
          [msg.view.opponent.id as string]: msg.view.opponent.name,
        };
        // Merge in action-referenced card defs from the server. A played
        // card's identity is public via the action itself even when the
        // card now sits in a redacted pile (e.g. short event sent to the
        // opponent's face-down discard), so the prev/next view lookups
        // alone would render "a card" in the toast.
        const actionLookup = (id: CardInstanceId): CardDefinitionId | undefined =>
          msg.lastActionCardDefs?.[id] ?? prevInstanceLookup(id);
        renderLog(`State update: turn ${msg.view.turnNumber}, phase ${msg.view.phaseState.phase}`);
        // Announce what a player just did *before* replaying the effects that
        // action produced — a roll result must never precede the line telling
        // about the roll.
        if (msg.lastAction) {
          const desc = describeOpponentAction(msg.lastAction, cardPool, actionLookup, prevCompanyNames, appState.lastPlayerNames);
          const isSelf = msg.lastAction.player === msg.view.self.id;
          // Log opponent actions so the text log captures what the other player did
          if (!isSelf) renderLog(`<< ${desc}`, cardPool);
          if (msg.lastAction.type !== 'pass' && msg.lastAction.type !== 'pass-chain-priority') {
            if (isSelf) {
              showNotification(desc, { cardPool, self: msg.view.self.name });
            } else {
              showNotification(desc, { cardPool, opponent: msg.view.opponent.name });
            }
          }
          // A dedicated entry when a player picks a creature race (e.g. Two or
          // Three Tribes Present), so the opponent can see the choice clearly.
          if (msg.lastAction.type === 'play-hazard' && msg.lastAction.chosenCreatureRace) {
            showNotification(`Chosen creature race: ${msg.lastAction.chosenCreatureRace}`,
              isSelf ? { self: msg.view.self.name } : { opponent: msg.view.opponent.name });
          }
        }
        // Now the deferred dice rolls and text notifications of that action.
        flushEffectLog();
        // Log roll outcomes (dice result + strike/body-check result) for both players
        if (msg.lastAction) {
          const instanceToName = (id: import('@meccg/shared').CardInstanceId): string => {
            const defId = appState.lastInstanceLookup(id);
            const def = defId ? cardPool[defId as string] : undefined;
            return (def as { name?: string } | undefined)?.name ?? (id as string);
          };
          const rollLines = describeRollOutcome(msg.lastAction, msg.view, appState.prevSelfDice, appState.prevOpponentDice, appState.prevResolvedCount, appState.prevCombatAttackingPlayerId, instanceToName);
          for (const { line, isSelf } of rollLines) {
            renderLog(`${isSelf ? '>>' : '<<'} ${line}`, cardPool);
            showNotification(line);
          }
        }
        appState.prevSelfDice = msg.view.self.lastDiceRoll;
        appState.prevOpponentDice = msg.view.opponent.lastDiceRoll;
        appState.prevResolvedCount = msg.view.combat?.strikeAssignments.filter(sa => sa.resolved).length ?? 0;
        // Keep the last CvCC attacker ID so the final-strike roll log can show
        // both rolls even after view.combat becomes null (combat ended).
        if (msg.view.combat?.isCvCC) {
          appState.prevCombatAttackingPlayerId = msg.view.combat.attackingPlayerId;
        }
        // Snapshot card positions before clearing DOM for FLIP animation
        snapshotPositions();
        // The tutorial panel renders FIRST: it depends only on the view, and
        // rendering it before the board keeps the instructions current even
        // if a later renderer throws mid-pass (its bubbles position in a rAF
        // after the pass, so anchor elements are final by then).
        renderTutorialPanel(msg.view, cardPool);
        renderState(msg.view, cardPool);
        renderDraft(msg.view, cardPool);
        renderMHInfo(msg.view, cardPool, appState.lastCompanyNames);
        renderSiteInfo(msg.view, cardPool, appState.lastCompanyNames);
        renderFreeCouncilInfo(msg.view, cardPool);
        renderActions(msg.view.legalActions, cardPool, sendAction, appState.lastInstanceLookup, appState.lastCompanyNames, appState.lastPlayerNames);
        renderHand(msg.view, cardPool, sendAction);
        renderOpponentHand(msg.view, cardPool);
        renderPlayerNames(msg.view, cardPool);
        renderPhaseMeter(msg.view, appState.lastCompanyNames);
        renderDrafted(msg.view, cardPool, sendAction);
        renderPassButton(msg.view, sendAction);
        renderDeckPiles(msg.view, cardPool);
        renderCompanyViews(msg.view, cardPool, sendAction);
        renderGameOverView(msg.view, cardPool);
        renderChainPanel(msg.view, cardPool, sendAction);
        // Animate cards from old positions to new positions
        animateFromSnapshot();
        // The full state is now rendered — reveal the board.
        setLoadingCover(false);
        // Show turn notification when entering Untap phase
        if (msg.view.phaseState.phase === 'untap' && appState.lastPhase !== 'untap') {
          const isMine = msg.view.activePlayer === msg.view.self.id;
          showNotification(
            isMine ? 'Your turn' : `${msg.view.opponent.name}'s turn`,
            isMine ? undefined : { opponent: '' },
          );
        }
        appState.lastPhase = msg.view.phaseState.phase;
        // Prepare/clear site selection or fetch-from-pile based on legal actions
        const HIDDEN_HAVEN_PAIR_HINT = 'Click a Ruins & Lairs in your site deck to pair with Hidden Haven';
        const hiddenHavenPairing = msg.view.legalActions.some(ea => ea.viable && ea.action.type === 'select-stage-resource-site');
        // The Hidden Haven pairing hint must not outlive the pairing state (e.g.
        // once paired or after the draft ends) — clear it when no longer offered.
        if (!hiddenHavenPairing && getTargetingInstruction() === HIDDEN_HAVEN_PAIR_HINT) {
          setTargetingInstruction(null);
        }
        if (msg.view.legalActions.some(ea => ea.action.type === 'select-starting-site')) {
          prepareSiteSelection(msg.view, cardPool, sendAction);
        } else if (hiddenHavenPairing) {
          // Character-draft: a Fallen-wizard who drafted Hidden Haven (wh-75)
          // must pair it with a Ruins & Lairs site from their own site deck.
          // Reuses the same site-deck picker as starting-site-selection.
          prepareSiteSelection(msg.view, cardPool, sendAction);
          setTargetingInstruction(HIDDEN_HAVEN_PAIR_HINT);
        } else if (msg.view.legalActions.some(ea => ea.viable && ea.action.type === 'fetch-from-pile')) {
          prepareFetchFromPile(msg.view, cardPool, sendAction);
        } else if (msg.view.legalActions.some(ea => ea.viable && ea.action.type === 'remove-revealed-card')) {
          prepareRevealRemoveFromDiscard(msg.view, cardPool, sendAction);
        } else {
          clearSelectionState();
        }
        // Auto-pass: if exactly one viable action, send it after a delay.
        // Roll actions are excluded — the player must press Roll themselves
        // so the dice-roll moment is a deliberate choice.
        if (appState.autoPassTimer) { clearTimeout(appState.autoPassTimer); appState.autoPassTimer = null; }
        if (localStorage.getItem(AUTO_PASS_KEY) === 'true') {
          const viable = msg.view.legalActions.filter(a => a.viable);
          const isRoll = (t: string) => t === 'roll-initiative' || t.endsWith('-roll');
          if (viable.length === 1 && !isRoll(viable[0].action.type)) {
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
        // Effects arrive before the state message of the action that caused
        // them, so their log lines are deferred until that action has been
        // announced (see effect-log-buffer). The dice animation is not.
        if (msg.effect.effect === 'dice-roll') {
          const rollEffect = msg.effect;
          queueEffectLog(() => {
            renderLog(diceRollLogLine(rollEffect));
            // CvCC strikes carry a prowess total — the matching result line is
            // shown later via describeRollOutcome once the state arrives.
            const notification = diceRollNotification(rollEffect, name, appState.opponentName);
            if (notification) showNotification(notification.message, notification.opts);
          });
          const visualView = document.getElementById('visual-view');
          if (visualView && !visualView.classList.contains('hidden')) {
            const variant = rollEffect.playerName === name ? 'black' : 'red';
            rollDice(rollEffect.die1, rollEffect.die2, variant);
          }
        } else if (msg.effect.effect === 'text-notification') {
          const { message } = msg.effect;
          queueEffectLog(() => {
            renderLog(message, cardPool);
            showNotification(message, { cardPool });
          });
        }
        break;

      case 'info':
        renderLog(msg.message);
        // An empty `self` renders the success tone green without a name prefix.
        showNotification(msg.message,
          msg.tone === 'error' ? { error: true } : msg.tone === 'success' ? { self: '' } : undefined);
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

      case 'spectators':
        setSpectators(msg.names);
        break;

      case 'restart':
        clearEffectLog();
        renderLog(msg.message);
        showNotification(msg.message);
        setLoadingCover(true);
        resetVisualBoard();
        resetCompanyViews();
        resetDeckPiles();
        clearDice();
        break;
    }
  };

  appState.ws.onclose = () => {
    if (appState.autoReconnect) {
      if (appState.spectating) {
        // A spectator has no player slot to rejoin: the game ended (server
        // exited) or the connection dropped. Either way, return to the lobby.
        renderLog('Stopped watching -- returning to lobby.');
        showNotification('Stopped watching.');
        disconnect();
        return;
      }
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
