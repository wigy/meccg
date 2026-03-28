/**
 * @module app
 *
 * Browser entry point for the MECCG web client. Connects to the
 * client-web server via WebSocket (which proxies to the game server),
 * renders game state, and sends actions on button click.
 */

import type { ServerMessage, ClientMessage, GameAction, CardDefinitionId } from '@meccg/shared';
import { loadCardPool, describeAction, buildCompanyNames, cardImageProxyPath, SAMPLE_DECKS } from '@meccg/shared';
import { renderState, renderDraft, renderMHInfo, renderSiteInfo, renderFreeCouncilInfo, renderGameOverView, renderActions, renderLog, renderHand, renderOpponentHand, renderPlayerNames, renderInstructions, renderDrafted, renderPassButton, renderDeckPiles, resetDeckPiles, setupCardPreview, showNotification, prepareSiteSelection, clearSiteSelection, renderChainPanel, buildCardAttributes } from './render.js';
import { renderCompanyViews, resetCompanyViews } from './company-view.js';
import { rollDice, clearDice, restoreDice, waitForDice } from './dice.js';
import { snapshotPositions, animateFromSnapshot } from './flip-animate.js';
import { renderMarkdown } from './markdown.js';

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
let lobbyPlayerIsAdmin = false;
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

  // After acknowledging game result, return to lobby
  if (action.type === 'finished') {
    disconnect();
  }
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
        renderGameOverView(msg.view, cardPool);
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

type ScreenId = 'login-screen' | 'register-screen' | 'lobby-screen' | 'deck-editor-screen' | 'inbox-screen' | 'connect-form';
const ALL_SCREENS: ScreenId[] = ['login-screen', 'register-screen', 'lobby-screen', 'deck-editor-screen', 'inbox-screen', 'connect-form'];

/** Show one screen, hiding all others. */
function showScreen(id: ScreenId): void {
  for (const screenId of ALL_SCREENS) {
    const el = document.getElementById(screenId);
    if (el) el.classList.toggle('hidden', screenId !== id);
  }
  // Update player name on all screens
  for (const el of document.querySelectorAll('.screen-player-name')) {
    el.textContent = lobbyPlayerName ?? '';
  }
  // Reset lobby button state when showing the lobby
  if (id === 'lobby-screen') {
    const btn = document.getElementById('play-ai-btn') as HTMLButtonElement | null;
    if (btn) { btn.textContent = 'Play vs AI'; btn.disabled = false; }
    void loadDecks();
  }
}

// ---- Deck browser ----

/** IDs of decks the player already owns. */
let ownedDeckIds = new Set<string>();
/** Currently selected deck ID. */
let currentDeckId: string | null = null;

interface DeckSummary { id: string; name: string; alignment: string }
interface DeckListEntry { name: string; card: string | null; qty: number }
interface FullDeck extends DeckSummary {
  pool: DeckListEntry[];
  deck: { characters: DeckListEntry[]; hazards: DeckListEntry[]; resources: DeckListEntry[] };
  sites: DeckListEntry[];
}

/** Render a deck item row for "My Decks" — click to select as current. */
function renderMyDeckItem(deck: DeckSummary, isCurrent: boolean): HTMLElement {
  const item = document.createElement('div');
  item.className = 'lobby-deck-item lobby-deck-item--owned' + (isCurrent ? ' lobby-deck-item--current' : '');
  const info = document.createElement('div');
  info.className = 'lobby-deck-info';
  const nameEl = document.createElement('span');
  nameEl.className = 'lobby-deck-name';
  nameEl.textContent = deck.name;
  const meta = document.createElement('span');
  meta.className = 'lobby-deck-meta';
  meta.textContent = deck.alignment + (isCurrent ? ' — selected' : '');
  info.appendChild(nameEl);
  info.appendChild(meta);
  item.appendChild(info);
  const btns = document.createElement('div');
  btns.style.display = 'flex';
  btns.style.gap = '0.4rem';
  if (isCurrent) {
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      void openDeckEditor(deck.id);
    });
    btns.appendChild(editBtn);
  } else {
    const selectBtn = document.createElement('button');
    selectBtn.textContent = 'Select';
    selectBtn.addEventListener('click', () => {
      void selectDeck(deck.id);
    });
    btns.appendChild(selectBtn);
  }
  item.appendChild(btns);
  return item;
}

/** Render a deck item row for the catalog — "Add" or "Owned". */
function renderCatalogDeckItem(deck: DeckSummary, owned: boolean, onAdd: () => void): HTMLElement {
  const item = document.createElement('div');
  item.className = 'lobby-deck-item';
  const info = document.createElement('div');
  info.className = 'lobby-deck-info';
  const nameEl = document.createElement('span');
  nameEl.className = 'lobby-deck-name';
  nameEl.textContent = deck.name;
  const meta = document.createElement('span');
  meta.className = 'lobby-deck-meta';
  meta.textContent = deck.alignment;
  info.appendChild(nameEl);
  info.appendChild(meta);
  item.appendChild(info);
  const btn = document.createElement('button');
  if (owned) {
    btn.textContent = 'Owned';
    btn.disabled = true;
  } else {
    btn.textContent = 'Add';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Adding...';
      onAdd();
    });
  }
  item.appendChild(btn);
  return item;
}

/** Fetch deck catalog and player's decks, then render both lists. */
async function loadDecks(): Promise<void> {
  const [catalogResp, myResp] = await Promise.all([
    fetch('/api/decks'),
    fetch('/api/my-decks'),
  ]);
  type CatalogDeck = DeckSummary & Record<string, unknown>;
  const catalog = catalogResp.ok ? await catalogResp.json() as CatalogDeck[] : [];
  const myData = myResp.ok
    ? await myResp.json() as { decks: DeckSummary[]; currentDeck: string | null }
    : { decks: [], currentDeck: null };
  const myDecks = myData.decks;
  currentDeckId = myData.currentDeck;
  ownedDeckIds = new Set(myDecks.map(d => d.id));

  // Render my decks
  const myContainer = document.getElementById('my-decks')!;
  myContainer.innerHTML = '';
  if (myDecks.length === 0) {
    myContainer.innerHTML = '<p class="lobby-empty">No decks yet — add one from the catalog below</p>';
  } else {
    for (const deck of myDecks) {
      myContainer.appendChild(renderMyDeckItem(deck, deck.id === currentDeckId));
    }
  }

  // Render catalog
  const catContainer = document.getElementById('deck-catalog')!;
  catContainer.innerHTML = '';
  if (catalog.length === 0) {
    catContainer.innerHTML = '<p class="lobby-empty">No decks available</p>';
  } else {
    for (const deck of catalog) {
      catContainer.appendChild(renderCatalogDeckItem(deck, ownedDeckIds.has(deck.id), () => {
        void addDeckToCollection(deck);
      }));
    }
  }
}

/** Set a deck as the player's current deck, then refresh. */
async function selectDeck(deckId: string): Promise<void> {
  await fetch('/api/my-decks/current', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deckId }),
  });
  await loadDecks();
}

/** Add a catalog deck to the player's collection, then refresh. */
async function addDeckToCollection(deck: { id: string; [key: string]: unknown }): Promise<void> {
  const resp = await fetch('/api/my-decks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deck),
  });
  if (resp.ok) {
    await loadDecks();
  }
}

// ---- Deck editor ----

/** CSS colors matching the debug view ANSI color scheme, keyed by card type. */
const CARD_TYPE_COLORS: Record<string, string> = {
  'hero-character': 'color:#6090e0;font-weight:bold',
  'hero-resource-item': 'color:#d0a040',
  'hero-resource-faction': 'color:#50b0b0',
  'hero-resource-ally': 'color:#60c060',
  'hero-resource-event': 'color:#60c060',
  'hazard-creature': 'color:#e06060',
  'hazard-event': 'color:#c070c0',
  'hazard-corruption': 'color:#c070c0;opacity:0.6',
  'hero-site': 'color:#d0d0d0',
  'minion-character': 'color:#c070c0;font-weight:bold',
  'minion-resource-item': 'color:#666',
  'minion-resource-faction': 'color:#666',
  'minion-resource-ally': 'color:#666',
  'minion-site': 'color:#d0d0d0',
  'balrog-site': 'color:#c07020',
  'fallen-wizard-site': 'color:#d0d0d0',
};

/** Set of "deckId:cardName" keys for already-requested cards. */
let requestedCards = new Set<string>();

/** Render a list of card entries into a container element. */
function renderCardList(container: HTMLElement, entries: DeckListEntry[], deckId: string): void {
  container.innerHTML = '';
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'deck-editor-card';
    const qtyEl = document.createElement('span');
    qtyEl.className = 'deck-editor-card-qty';
    qtyEl.textContent = String(entry.qty);
    const nameEl = document.createElement('span');
    nameEl.className = 'deck-editor-card-name';
    // Use official name and color from card pool if mapped
    const def = entry.card ? cardPool[entry.card] : undefined;
    nameEl.textContent = def ? def.name : entry.name;
    const badge = document.createElement('span');
    badge.className = 'deck-editor-certified-badge';
    if (def) {
      const style = CARD_TYPE_COLORS[def.cardType] ?? '';
      if (style) nameEl.setAttribute('style', style);
      row.dataset.cardId = entry.card!;
      row.style.cursor = 'pointer';
      if ('certified' in def && (def as Record<string, unknown>).certified) {
        badge.textContent = '\u2605';
        badge.title = `Certified ${(def as Record<string, unknown>).certified as string}`;
      }
    } else {
      row.classList.add('deck-editor-card--unknown');
      const requestKey = `${deckId}:${entry.name}`;
      const btn = document.createElement('button');
      btn.className = 'deck-editor-request-btn';
      btn.title = 'Ask the server admin to add this card to the game data';
      if (requestedCards.has(requestKey)) {
        btn.textContent = 'Requested';
        btn.disabled = true;
      } else {
        btn.textContent = 'Request';
        btn.addEventListener('click', () => {
          btn.disabled = true;
          btn.textContent = 'Requested';
          requestedCards.add(requestKey);
          void fetch('/api/card-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deckId, cardName: entry.name }),
          });
        });
      }
      row.appendChild(qtyEl);
      row.appendChild(badge);
      row.appendChild(nameEl);
      row.appendChild(btn);
      container.appendChild(row);
      continue;
    }
    row.appendChild(qtyEl);
    row.appendChild(badge);
    row.appendChild(nameEl);
    container.appendChild(row);
  }
}

const EDITING_DECK_KEY = 'meccg-editing-deck';
const VIEWING_INBOX_KEY = 'meccg-viewing-inbox';

/** Set up hover preview for card rows in the deck editor. */
function setupDeckEditorPreview(): void {
  const screen = document.getElementById('deck-editor-screen')!;
  const preview = document.getElementById('deck-editor-preview')!;

  screen.addEventListener('mouseover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.deck-editor-card[data-card-id]');
    if (!row) return;
    const def = cardPool[row.dataset.cardId!];
    if (!def) return;

    // Position preview on the opposite side of the hovered card
    const rect = row.getBoundingClientRect();
    const midpoint = window.innerWidth / 2;
    const onRight = rect.left > midpoint;
    preview.classList.toggle('preview-left', onRight);
    preview.classList.toggle('preview-right', !onRight);

    preview.innerHTML = '';
    const info = document.createElement('div');
    info.className = 'card-preview-info';

    const name = document.createElement('div');
    name.className = 'card-preview-name';
    name.textContent = def.name;
    info.appendChild(name);

    // Card image
    const imgPath = cardImageProxyPath(def);
    if (imgPath) {
      const img = document.createElement('img');
      img.src = imgPath;
      img.alt = def.name;
      info.appendChild(img);
    }

    buildCardAttributes(info, def);
    preview.appendChild(info);
  });

  screen.addEventListener('mouseout', (e) => {
    const row = (e.target as HTMLElement).closest('.deck-editor-card[data-card-id]');
    if (!row) return;
    preview.innerHTML = '';
  });
}

/** Open the deck editor for a given deck ID. */
async function openDeckEditor(deckId: string): Promise<void> {
  const [decksResp, sentResp] = await Promise.all([
    fetch('/api/my-decks'),
    fetch('/api/mail/sent'),
  ]);
  if (!decksResp.ok) return;
  const data = await decksResp.json() as { decks: FullDeck[]; currentDeck: string | null };
  const deck = data.decks.find(d => d.id === deckId);
  if (!deck) return;

  // Load sent card-request mails to mark already-requested cards
  requestedCards = new Set<string>();
  if (sentResp.ok) {
    const sent = await sentResp.json() as { messages: { topic: string; keywords: Record<string, string> }[] };
    for (const msg of sent.messages) {
      if (msg.topic === 'card-request' && msg.keywords.deckId && msg.keywords.cardName) {
        requestedCards.add(`${msg.keywords.deckId}:${msg.keywords.cardName}`);
      }
    }
  }

  sessionStorage.setItem(EDITING_DECK_KEY, deckId);
  document.getElementById('deck-editor-title')!.textContent = deck.name;
  renderCardList(document.getElementById('deck-editor-pool')!, deck.pool, deckId);
  renderCardList(document.getElementById('deck-editor-characters')!, deck.deck.characters, deckId);
  renderCardList(document.getElementById('deck-editor-hazards')!, deck.deck.hazards, deckId);
  renderCardList(document.getElementById('deck-editor-resources')!, deck.deck.resources, deckId);
  renderCardList(document.getElementById('deck-editor-sites')!, deck.sites, deckId);
  showScreen('deck-editor-screen');
}

/** Close the deck editor and return to the lobby. */
function closeDeckEditor(): void {
  sessionStorage.removeItem(EDITING_DECK_KEY);
  showScreen('lobby-screen');
}

// ---- Inbox ----

/** Escape HTML special characters for safe insertion via innerHTML. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Render a full message into the message panel. */
function renderMessage(messageEl: HTMLElement, full: InboxMessage): void {
  messageEl.innerHTML = '';

  // Subject
  const h = document.createElement('h3');
  h.className = 'inbox-msg-subject';
  h.textContent = full.subject;
  messageEl.appendChild(h);

  // Title (summary)
  if (full.title && full.title !== full.subject) {
    const titleEl = document.createElement('p');
    titleEl.className = 'inbox-msg-title';
    titleEl.textContent = full.title;
    messageEl.appendChild(titleEl);
  }

  // Metadata table
  const meta = document.createElement('div');
  meta.className = 'inbox-msg-meta';
  const rows = [
    ['Message ID', `<span class="inbox-meta-id">${escapeHtml(full.id)}<span class="inbox-copy-btn" data-copy="${escapeHtml(full.id)}" title="Copy to clipboard">&#x2398;</span></span>`],
    ['From', escapeHtml(full.from)],
    ['Sender', `<span class="inbox-tag inbox-tag--${full.sender}">${escapeHtml(full.sender)}</span>`],
    ['Topic', `<span class="inbox-tag inbox-tag--topic">${escapeHtml(full.topic)}</span>`],
    ['Date', new Date(full.timestamp).toLocaleString()],
    ['Status', `<span class="inbox-status inbox-status--${full.status}">${escapeHtml(full.status)}</span>`],
    ...(full.replyTo ? [['Reply To', `<span class="inbox-meta-id">${escapeHtml(full.replyTo)}<span class="inbox-copy-btn" data-copy="${escapeHtml(full.replyTo)}" title="Copy to clipboard">&#x2398;</span></span>`]] : []),
  ];
  meta.innerHTML = rows.map(([label, value]) =>
    `<span><span class="inbox-meta-label">${label}:</span> <span class="inbox-meta-value">${value}</span></span>`,
  ).join('');
  messageEl.appendChild(meta);

  // Copy button handler
  for (const copyBtn of meta.querySelectorAll('.inbox-copy-btn')) {
    copyBtn.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLElement;
      void navigator.clipboard.writeText(target.dataset.copy ?? '');
      target.textContent = '\u2713';
      setTimeout(() => { target.textContent = '\u2398'; }, 1500);
    });
  }

  // Keywords
  const kwKeys = Object.keys(full.keywords);
  if (kwKeys.length > 0) {
    const kwSection = document.createElement('div');
    kwSection.className = 'inbox-msg-keywords';
    kwSection.innerHTML = kwKeys.map(key =>
      `<span><span class="inbox-meta-label">${escapeHtml(key)}:</span> <span class="inbox-meta-value">${escapeHtml(full.keywords[key])}</span></span>`,
    ).join('');
    messageEl.appendChild(kwSection);
  }

  // Body
  const body = document.createElement('div');
  body.className = 'inbox-message-body';
  body.innerHTML = renderMarkdown(full.body);
  messageEl.appendChild(body);

  // Approve button for messages awaiting review
  if (full.status === 'waiting' && lobbyPlayerIsAdmin) {
    const approveBtn = document.createElement('button');
    approveBtn.className = 'inbox-approve-btn';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => {
      void (async () => {
        const resp = await fetch(`/api/mail/inbox/${full.id}/approve`, { method: 'POST' });
        if (resp.ok) {
          approveBtn.textContent = 'Approved';
          approveBtn.disabled = true;
          // Update the status display in the message view
          const statusEl = messageEl.querySelector('.inbox-status');
          if (statusEl) {
            statusEl.className = 'inbox-status inbox-status--approved';
            statusEl.textContent = 'approved';
          }
        }
      })();
    });
    messageEl.appendChild(approveBtn);
  }
}

/** Render a list of messages into the list panel. */
function renderMailList(
  listEl: HTMLElement, messageEl: HTMLElement, messages: InboxMessage[],
  options: { fetchOnClick?: string },
): void {
  if (messages.length === 0) {
    listEl.innerHTML = '<p class="lobby-empty">No messages</p>';
    return;
  }

  listEl.innerHTML = '';
  for (const msg of messages) {
    const row = document.createElement('div');
    row.className = 'inbox-item' + (msg.status === 'new' ? ' inbox-item--unread' : '');

    const info = document.createElement('div');
    info.className = 'inbox-item-info';
    const subject = document.createElement('span');
    subject.className = 'inbox-item-subject';
    subject.textContent = msg.subject;
    const from = document.createElement('span');
    from.className = 'inbox-item-from';
    from.textContent = msg.from;
    const date = document.createElement('span');
    date.className = 'inbox-item-date';
    date.textContent = new Date(msg.timestamp).toLocaleDateString();
    info.appendChild(subject);
    info.appendChild(from);

    const actions = document.createElement('div');
    actions.className = 'inbox-item-actions';
    const statusEl = document.createElement('span');
    statusEl.className = `inbox-status inbox-status--${msg.status}`;
    statusEl.textContent = msg.status;
    actions.appendChild(statusEl);
    actions.appendChild(date);

    row.appendChild(info);
    row.appendChild(actions);

    row.addEventListener('click', () => {
      void (async () => {
        if (options.fetchOnClick) {
          const msgResp = await fetch(`${options.fetchOnClick}/${msg.id}`);
          if (!msgResp.ok) return;
          const full = await msgResp.json() as InboxMessage;
          row.classList.remove('inbox-item--unread');
          renderMessage(messageEl, full);
        } else {
          renderMessage(messageEl, msg);
        }
      })();
    });

    listEl.appendChild(row);
  }
}

/** Which mail tab is active. */
let activeMailTab: 'inbox' | 'sent' = 'inbox';

/** Update tab button styles. */
function updateMailTabs(): void {
  document.getElementById('inbox-tab-inbox')!.className = 'inbox-tab' + (activeMailTab === 'inbox' ? ' inbox-tab--active' : '');
  document.getElementById('inbox-tab-sent')!.className = 'inbox-tab' + (activeMailTab === 'sent' ? ' inbox-tab--active' : '');
  document.getElementById('mark-all-unread-btn')!.style.display = activeMailTab === 'inbox' ? '' : 'none';
}

/** Fetch and display inbox messages. */
async function openInbox(): Promise<void> {
  sessionStorage.setItem(VIEWING_INBOX_KEY, '1');
  showScreen('inbox-screen');
  activeMailTab = 'inbox';
  updateMailTabs();
  const listEl = document.getElementById('inbox-list')!;
  const messageEl = document.getElementById('inbox-message')!;
  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';
  messageEl.innerHTML = '<p class="lobby-empty">Select a message to read</p>';

  try {
    const resp = await fetch('/api/mail/inbox');
    if (!resp.ok) { listEl.innerHTML = '<p class="lobby-empty">Failed to load inbox</p>'; return; }
    const data = await resp.json() as { messages: InboxMessage[]; unreadCount: number };

    const badge = document.getElementById('inbox-unread')!;
    badge.textContent = data.unreadCount > 0 ? `${data.unreadCount} unread` : '';

    renderMailList(listEl, messageEl, data.messages, {
      fetchOnClick: '/api/mail/inbox',
    });
  } catch {
    listEl.innerHTML = '<p class="lobby-empty">Connection error</p>';
  }
}

/** Fetch and display sent messages. */
async function openSent(): Promise<void> {
  sessionStorage.setItem(VIEWING_INBOX_KEY, '1');
  showScreen('inbox-screen');
  activeMailTab = 'sent';
  updateMailTabs();
  const listEl = document.getElementById('inbox-list')!;
  const messageEl = document.getElementById('inbox-message')!;
  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';
  messageEl.innerHTML = '<p class="lobby-empty">Select a message to read</p>';

  try {
    const resp = await fetch('/api/mail/sent');
    if (!resp.ok) { listEl.innerHTML = '<p class="lobby-empty">Failed to load sent mail</p>'; return; }
    const data = await resp.json() as { messages: InboxMessage[] };

    const badge = document.getElementById('inbox-unread')!;
    badge.textContent = '';

    renderMailList(listEl, messageEl, data.messages, {});
  } catch {
    listEl.innerHTML = '<p class="lobby-empty">Connection error</p>';
  }
}

/** Shape of a mail message from the API. */
interface InboxMessage {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly from: string;
  readonly sender: string;
  readonly topic: string;
  readonly body: string;
  readonly timestamp: string;
  readonly subject: string;
  readonly keywords: Record<string, string>;
  readonly replyTo?: string;
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
        const players = (msg.players as { name: string; displayName: string }[]).filter(p => p.name !== lobbyPlayerName);
        const container = document.getElementById('online-players')!;
        if (players.length === 0) {
          container.innerHTML = '<p class="lobby-empty">No other players online</p>';
        } else {
          container.innerHTML = '';
          for (const player of players) {
            const item = document.createElement('div');
            item.className = 'lobby-player-item';
            const span = document.createElement('span');
            span.textContent = player.displayName;
            const btn = document.createElement('button');
            btn.textContent = 'Challenge';
            btn.addEventListener('click', () => {
              lobbyWs?.send(JSON.stringify({ type: 'challenge', opponentName: player.name }));
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
        const fromDisplay = (msg.fromDisplayName as string) ?? challengeFrom;
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
        gamePort = msg.port as number;
        gameToken = msg.token as string;
        const opponentDisplay = (msg.opponentDisplayName as string) ?? (msg.opponent as string);
        saveGameSession();
        // Close lobby WS during game
        if (lobbyWs) { lobbyWs.close(); lobbyWs = null; }
        // Hide lobby, show game
        showScreen('login-screen'); // hide all screens
        document.getElementById('login-screen')!.classList.add('hidden');
        document.getElementById('game')!.classList.remove('hidden');
        selectRandomBackground();
        autoReconnect = true;
        renderLog(`Game starting vs ${opponentDisplay} on port ${gamePort}...`);
        connect(lobbyPlayerName!);
        break;
      }
      case 'error': {
        renderLog(`Lobby: ${msg.message as string}`);
        break;
      }
      case 'mail-notification': {
        const unread = msg.unreadCount as number;
        const inboxBtn = document.getElementById('inbox-btn');
        if (inboxBtn) {
          inboxBtn.textContent = unread > 0 ? `Mail (${unread})` : 'Mail';
        }
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
      const data = await resp.json() as { name: string; isAdmin?: boolean };
      lobbyPlayerName = data.name;
      lobbyPlayerIsAdmin = data.isAdmin ?? false;

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
        void openInbox();
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
  setupDeckEditorPreview();
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
        const data = await resp.json() as { name?: string; error?: string };
        if (!resp.ok) { showAuthError('register-error', data.error ?? 'Registration failed'); return; }
        lobbyPlayerName = data.name!;
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
      lobbyPlayerName = null;
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      if (lobbyWs) { lobbyWs.close(); lobbyWs = null; }
      showScreen('login-screen');
    })(); };
    for (const btn of document.querySelectorAll('.screen-logout')) {
      btn.addEventListener('click', doLogout);
    }

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

    // Deck editor back button
    document.getElementById('deck-editor-back')!.addEventListener('click', () => {
      closeDeckEditor();
    });

    // Inbox button and back
    document.getElementById('inbox-btn')!.addEventListener('click', () => {
      void openInbox();
    });
    document.getElementById('inbox-back')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      showScreen('lobby-screen');
    });
    document.getElementById('mark-all-unread-btn')!.addEventListener('click', () => {
      void (async () => {
        await fetch('/api/mail/mark-all-unread', { method: 'POST' });
        void openInbox();
      })();
    });
    document.getElementById('inbox-tab-inbox')!.addEventListener('click', () => {
      void openInbox();
    });
    document.getElementById('inbox-tab-sent')!.addEventListener('click', () => {
      void openSent();
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
