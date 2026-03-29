/**
 * @module app
 *
 * Browser entry point for the MECCG web client. Connects to the
 * client-web server via WebSocket (which proxies to the game server),
 * renders game state, and sends actions on button click.
 */

import type { ServerMessage, ClientMessage, GameAction, CardDefinitionId, JoinMessage } from '@meccg/shared';
import { loadCardPool, describeAction, buildCompanyNames, cardImageProxyPath, Alignment } from '@meccg/shared';
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
let lobbyPlayerIsReviewer = false;
/** Name of the player who sent us a challenge (lobby mode). */
let challengeFrom: string | null = null;
let lastVisibleInstances: Readonly<Record<string, CardDefinitionId>> = {};
let lastCompanyNames: Readonly<Record<string, string>> = {};
let lastPhase: string | null = null;
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
    if (!currentFullDeck) {
      renderLog('Error: no deck selected');
      ws!.close();
      return;
    }
    const joinMsg = buildJoinFromDeck(currentFullDeck, name);
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

type ScreenId = 'login-screen' | 'register-screen' | 'lobby-screen' | 'decks-screen' | 'deck-editor-screen' | 'inbox-screen' | 'connect-form';
const ALL_SCREENS: ScreenId[] = ['login-screen', 'register-screen', 'lobby-screen', 'decks-screen', 'deck-editor-screen', 'inbox-screen', 'connect-form'];

/** Screens that should show the persistent nav bar. */
const NAV_SCREENS: ScreenId[] = ['lobby-screen', 'decks-screen', 'deck-editor-screen', 'inbox-screen'];

/** Show one screen, hiding all others. */
function showScreen(id: ScreenId): void {
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
  // Update player name on all screens
  for (const el of document.querySelectorAll('.screen-player-name')) {
    el.textContent = lobbyPlayerName ?? '';
  }
  // Reset lobby button state when showing the lobby
  if (id === 'lobby-screen') {
    const btn = document.getElementById('play-ai-btn') as HTMLButtonElement | null;
    if (btn) { btn.textContent = 'Play vs AI'; btn.classList.remove('hidden'); }
    document.getElementById('save-prompt')?.classList.add('hidden');
    void loadDecks();
  }
  // Load decks when showing the decks screen
  if (id === 'decks-screen') {
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

/** The current player's selected deck, loaded from the lobby API. */
let currentFullDeck: FullDeck | null = null;

/** Return names of cards that have no card ID (not yet created). */
function missingCards(deck: FullDeck): string[] {
  const allEntries = [
    ...deck.pool,
    ...deck.deck.characters, ...deck.deck.hazards, ...deck.deck.resources,
    ...deck.sites,
  ];
  return allEntries.filter(e => e.card === null).map(e => e.name);
}

/** Map deck file alignment strings to the Alignment enum used in JoinMessage. */
const ALIGNMENT_MAP: Record<string, Alignment> = {
  hero: Alignment.Wizard,
  minion: Alignment.Ringwraith,
  'fallen-wizard': Alignment.FallenWizard,
  balrog: Alignment.Balrog,
};

/** Expand deck list entries into repeated card IDs, filtering out unimplemented cards. */
function expandEntries(entries: DeckListEntry[]): CardDefinitionId[] {
  const ids: CardDefinitionId[] = [];
  for (const e of entries) {
    if (e.card !== null) {
      for (let i = 0; i < e.qty; i++) ids.push(e.card as CardDefinitionId);
    }
  }
  return ids;
}

/** Build a JoinMessage from a player deck, filtering out unimplemented cards. */
function buildJoinFromDeck(deck: FullDeck, playerName: string): JoinMessage {
  return {
    type: 'join',
    name: playerName,
    alignment: ALIGNMENT_MAP[deck.alignment] ?? Alignment.Wizard,
    draftPool: expandEntries(deck.pool),
    playDeck: [
      ...expandEntries(deck.deck.characters),
      ...expandEntries(deck.deck.resources),
      ...expandEntries(deck.deck.hazards),
    ],
    siteDeck: expandEntries(deck.sites),
  };
}

/** Render a deck item row for "My Decks" — click to select as current. */
function renderMyDeckItem(deck: FullDeck, isCurrent: boolean): HTMLElement {
  const missing = missingCards(deck);
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
  if (missing.length > 0) {
    const warn = document.createElement('span');
    warn.className = 'lobby-deck-warning';
    warn.textContent = `\u26A0 ${missing.length} missing card${missing.length > 1 ? 's' : ''}`;
    warn.title = missing.join(', ');
    info.appendChild(warn);
  }
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
function renderCatalogDeckItem(deck: FullDeck, owned: boolean, onAdd: () => void): HTMLElement {
  const missing = missingCards(deck);
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
  if (missing.length > 0) {
    const warn = document.createElement('span');
    warn.className = 'lobby-deck-warning';
    warn.textContent = `\u26A0 ${missing.length} missing card${missing.length > 1 ? 's' : ''}`;
    warn.title = missing.join(', ');
    info.appendChild(warn);
  }
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

/** Show or hide play controls depending on whether a deck is selected. */
function updatePlayControls(): void {
  const hasDeck = currentDeckId !== null;
  const notice = document.getElementById('no-deck-notice');
  if (notice) notice.classList.toggle('hidden', hasDeck);
  const playAiBtn = document.getElementById('play-ai-btn') as HTMLButtonElement | null;
  if (playAiBtn) playAiBtn.disabled = !hasDeck;
  const aiDeckSelect = document.getElementById('ai-deck-select') as HTMLSelectElement | null;
  if (aiDeckSelect) aiDeckSelect.disabled = !hasDeck;
  // Disable challenge buttons on online player list
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.lobby-player-item button')) {
    btn.disabled = !hasDeck;
  }
  const acceptBtn = document.getElementById('accept-challenge-btn') as HTMLButtonElement | null;
  if (acceptBtn) acceptBtn.disabled = !hasDeck;
}

/** Fetch deck catalog and player's decks, then render both lists. */
async function loadDecks(): Promise<void> {
  const [catalogResp, myResp] = await Promise.all([
    fetch('/api/decks'),
    fetch('/api/my-decks'),
  ]);
  const catalog = catalogResp.ok ? await catalogResp.json() as FullDeck[] : [];
  const myData = myResp.ok
    ? await myResp.json() as { decks: FullDeck[]; currentDeck: string | null }
    : { decks: [] as FullDeck[], currentDeck: null };
  const myDecks = myData.decks;
  currentDeckId = myData.currentDeck;
  currentFullDeck = myDecks.find(d => d.id === currentDeckId) ?? null;
  ownedDeckIds = new Set(myDecks.map(d => d.id));
  updatePlayControls();

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
      catContainer.appendChild(renderCatalogDeckItem(deck, ownedDeckIds.has(`${lobbyPlayerName}-${deck.id}`), () => {
        void addDeckToCollection(deck);
      }));
    }
  }

  // Render current deck compact preview
  const previewContainer = document.getElementById('current-deck-preview');
  if (previewContainer) {
    previewContainer.innerHTML = '';
    if (currentFullDeck) {
      renderCompactDeck(previewContainer, currentFullDeck);
    } else {
      previewContainer.innerHTML = '<p class="lobby-empty">No deck selected</p>';
    }
  }

  // Populate AI deck dropdown
  const aiSelect = document.getElementById('ai-deck-select') as HTMLSelectElement | null;
  if (aiSelect) {
    aiSelect.innerHTML = '';
    for (const deck of catalog) {
      const opt = document.createElement('option');
      opt.value = deck.id;
      const missing = missingCards(deck);
      opt.textContent = missing.length > 0 ? `\u26A0 ${deck.name}` : deck.name;
      aiSelect.appendChild(opt);
    }
  }
}

/** Render a compact, read-only listing of a deck in a 3-column grid. */
function renderCompactDeck(container: HTMLElement, deck: FullDeck): void {
  const sections: { label: string; entries: DeckListEntry[] }[][] = [
    [
      { label: 'Pool', entries: deck.pool },
      { label: 'Characters', entries: deck.deck.characters },
    ],
    [{ label: 'Resources', entries: deck.deck.resources }],
    [{ label: 'Hazards', entries: deck.deck.hazards }],
    [{ label: 'Sites', entries: deck.sites }],
  ];
  const nameEl = document.createElement('div');
  nameEl.className = 'compact-deck-name';
  nameEl.textContent = deck.name;
  container.appendChild(nameEl);
  const alignEl = document.createElement('div');
  alignEl.className = 'compact-deck-alignment';
  alignEl.textContent = deck.alignment;
  container.appendChild(alignEl);
  const grid = document.createElement('div');
  grid.className = 'compact-deck-grid';
  for (const group of sections) {
    const col = document.createElement('div');
    col.className = 'compact-deck-section';
    for (const section of group) {
      if (section.entries.length === 0) continue;
      const heading = document.createElement('div');
      heading.className = 'compact-deck-heading';
      heading.textContent = section.label;
      col.appendChild(heading);
      for (const entry of section.entries) {
        const row = document.createElement('div');
        row.className = 'compact-deck-entry' + (entry.card === null ? ' compact-deck-entry--missing' : '');
        row.textContent = entry.qty > 1 ? `${entry.qty}\u00d7 ${entry.name}` : entry.name;
        col.appendChild(row);
      }
    }
    if (col.children.length > 0) grid.appendChild(col);
  }
  container.appendChild(grid);
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
async function addDeckToCollection(deck: FullDeck): Promise<void> {
  const personalDeck = { ...deck, id: `${lobbyPlayerName}-${deck.id}` };
  const resp = await fetch('/api/my-decks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(personalDeck),
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

/** Render a list of card entries into a container element, sorted by card type then name. */
function renderCardList(container: HTMLElement, entries: DeckListEntry[], deckId: string): void {
  container.innerHTML = '';
  const sorted = [...entries].sort((a, b) => {
    const defA = a.card ? cardPool[a.card] : undefined;
    const defB = b.card ? cardPool[b.card] : undefined;
    if (!defA !== !defB) return defA ? -1 : 1;
    const typeA = defA?.cardType ?? '';
    const typeB = defB?.cardType ?? '';
    if (typeA !== typeB) return typeA.localeCompare(typeB);
    const nameA = defA?.name ?? a.name;
    const nameB = defB?.name ?? b.name;
    return nameA.localeCompare(nameB);
  });
  for (const entry of sorted) {
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
      if ('certified' in def && (def as unknown as Record<string, unknown>).certified) {
        badge.textContent = '\u2605';
        badge.title = `Certified ${(def as unknown as Record<string, unknown>).certified as string}`;
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
const VIEWING_DECKS_KEY = 'meccg-viewing-decks';
const MAIL_TAB_KEY = 'meccg-mail-tab';
const MAIL_MSG_KEY = 'meccg-mail-msg';

/** Set up hover preview for card rows in the deck editor. */
function setupDeckEditorPreview(): void {
  const screen = document.getElementById('deck-editor-screen')!;
  const preview = document.getElementById('deck-editor-preview')!;

  screen.addEventListener('mouseover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.deck-editor-card[data-card-id]');
    if (!row) return;
    const def = cardPool[row.dataset.cardId!];
    if (!def) return;

    // Position preview on a specific column based on card type:
    // Characters → col 2, Resources → col 1, Hazards → col 4, Sites → col 3
    const section = row.closest('.deck-editor-section');
    const sections = [...screen.querySelectorAll('.deck-editor-section')];
    const sectionIdx = section ? sections.indexOf(section) : -1;
    // Section indices: 0=Pool/Characters, 1=Resources, 2=Hazards, 3=Sites
    // Target columns:  0→1 (col 2),       1→0 (col 1),  2→3 (col 4), 3→2 (col 3)
    const targetCol = [1, 0, 3, 2][sectionIdx] ?? 0;
    const targetSection = sections[targetCol] as HTMLElement | undefined;
    preview.className = 'deck-editor-preview';
    if (targetSection) {
      const targetRect = targetSection.getBoundingClientRect();
      preview.style.left = `${targetRect.left}px`;
      preview.style.right = '';
    }

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
    preview.style.left = '';
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

  // Approve / Decline buttons for review-request and feature-request messages
  const reviewable = full.topic === 'review-request'
    || (full.topic === 'feature-request' && lobbyPlayerName === 'admin');
  const actionable = full.status === 'waiting' || full.status === 'new' || full.status === 'read';
  if (actionable && reviewable && lobbyPlayerIsReviewer) {
    const btnContainer = document.createElement('div');
    btnContainer.className = 'inbox-review-actions';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'inbox-approve-btn';
    approveBtn.textContent = 'Approve';

    const declineBtn = document.createElement('button');
    declineBtn.className = 'inbox-decline-btn';
    declineBtn.textContent = 'Decline';

    const handleReview = (action: 'approve' | 'decline', btn: HTMLButtonElement) => {
      void (async () => {
        const resp = await fetch(`/api/mail/inbox/${full.id}/${action}`, { method: 'POST' });
        if (resp.ok) {
          const newStatus = action === 'approve' ? 'approved' : 'declined';
          btn.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
          approveBtn.disabled = true;
          declineBtn.disabled = true;
          const statusEl = messageEl.querySelector('.inbox-status');
          if (statusEl) {
            statusEl.className = `inbox-status inbox-status--${newStatus}`;
            statusEl.textContent = newStatus;
          }
        }
      })();
    };

    approveBtn.addEventListener('click', () => handleReview('approve', approveBtn));
    declineBtn.addEventListener('click', () => handleReview('decline', declineBtn));

    btnContainer.appendChild(approveBtn);
    btnContainer.appendChild(declineBtn);
    messageEl.appendChild(btnContainer);
  }

  // Implement button for feature-planning-reply messages
  if (full.topic === 'feature-planning-reply' && lobbyPlayerName === 'admin' && lobbyPlayerIsReviewer) {
    const btnContainer = document.createElement('div');
    btnContainer.className = 'inbox-review-actions';

    const implementBtn = document.createElement('button');
    implementBtn.className = 'inbox-approve-btn';
    implementBtn.textContent = 'Implement';

    implementBtn.addEventListener('click', () => {
      void (async () => {
        implementBtn.disabled = true;
        implementBtn.textContent = 'Sending...';
        const resp = await fetch(`/api/mail/inbox/${full.id}/implement`, { method: 'POST' });
        if (resp.ok) {
          implementBtn.textContent = 'Sent to AI';
        } else {
          implementBtn.textContent = 'Failed';
          implementBtn.disabled = false;
        }
      })();
    });

    btnContainer.appendChild(implementBtn);
    messageEl.appendChild(btnContainer);
  }
}

/** Render a list of messages into the list panel. */
function renderMailList(
  listEl: HTMLElement, messageEl: HTMLElement, messages: InboxMessage[],
  options: { fetchOnClick?: string; showMarkAllUnread?: boolean },
): void {
  listEl.innerHTML = '';

  // Render Inbox/Sent tabs at the top of the list panel
  const tabsDiv = document.createElement('div');
  tabsDiv.className = 'inbox-tabs';
  const inboxTab = document.createElement('button');
  inboxTab.className = 'inbox-tab' + (activeMailTab === 'inbox' ? ' inbox-tab--active' : '');
  inboxTab.textContent = 'Inbox';
  inboxTab.addEventListener('click', () => { void openInbox(); });
  const sentTab = document.createElement('button');
  sentTab.className = 'inbox-tab' + (activeMailTab === 'sent' ? ' inbox-tab--active' : '');
  sentTab.textContent = 'Sent';
  sentTab.addEventListener('click', () => { void openSent(); });
  tabsDiv.appendChild(inboxTab);
  tabsDiv.appendChild(sentTab);
  listEl.appendChild(tabsDiv);

  // Feature request button
  const featureBtn = document.createElement('button');
  featureBtn.className = 'inbox-action-btn';
  featureBtn.textContent = 'Feature Request';
  featureBtn.addEventListener('click', () => {
    const modal = document.getElementById('feature-request-modal')!;
    const subjectEl = document.getElementById('feature-request-subject') as HTMLInputElement;
    const bodyEl = document.getElementById('feature-request-body') as HTMLTextAreaElement;
    subjectEl.value = '';
    bodyEl.value = '';
    modal.classList.remove('hidden');
    subjectEl.focus();
  });
  listEl.appendChild(featureBtn);

  if (options.showMarkAllUnread) {
    const btn = document.createElement('button');
    btn.className = 'inbox-action-btn mark-all-unread-btn';
    btn.textContent = 'Mark all unread';
    btn.addEventListener('click', () => {
      void (async () => {
        await fetch('/api/mail/mark-all-unread', { method: 'POST' });
        void openInbox();
      })();
    });
    listEl.appendChild(btn);
  }
  if (messages.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lobby-empty';
    empty.textContent = 'No messages';
    listEl.appendChild(empty);
    return;
  }
  for (const msg of messages) {
    const row = document.createElement('div');
    row.className = 'inbox-item' + (msg.status === 'new' ? ' inbox-item--unread' : '');
    row.dataset.msgId = msg.id;

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
        sessionStorage.setItem(MAIL_MSG_KEY, msg.id);
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

/** Update the mail unread badge in the nav bar. */
function updateMailBadge(count: number): void {
  const badge = document.getElementById('nav-mail-badge');
  if (badge) badge.textContent = count > 0 ? `(${count})` : '';
}

/** Click the inbox row matching the given message ID to restore selection after reload. */
function autoSelectMessage(msgId: string): void {
  const listEl = document.getElementById('inbox-list');
  if (!listEl) return;
  const row = listEl.querySelector(`.inbox-item[data-msg-id="${msgId}"]`);
  if (row) (row as HTMLElement).click();
}

/** Fetch and display inbox messages. */
async function openInbox(): Promise<void> {
  sessionStorage.setItem(VIEWING_INBOX_KEY, '1');
  sessionStorage.setItem(MAIL_TAB_KEY, 'inbox');
  sessionStorage.removeItem(MAIL_MSG_KEY);
  showScreen('inbox-screen');
  activeMailTab = 'inbox';
  const listEl = document.getElementById('inbox-list')!;
  const messageEl = document.getElementById('inbox-message')!;
  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';
  messageEl.innerHTML = '<p class="lobby-empty">Select a message to read</p>';

  try {
    const resp = await fetch('/api/mail/inbox');
    if (!resp.ok) { listEl.innerHTML = '<p class="lobby-empty">Failed to load inbox</p>'; return; }
    const data = await resp.json() as { messages: InboxMessage[]; unreadCount: number };

    updateMailBadge(data.unreadCount);

    renderMailList(listEl, messageEl, data.messages, {
      fetchOnClick: '/api/mail/inbox',
      showMarkAllUnread: true,
    });
  } catch {
    listEl.innerHTML = '<p class="lobby-empty">Connection error</p>';
  }
}

/** Fetch and display sent messages. */
async function openSent(): Promise<void> {
  sessionStorage.setItem(VIEWING_INBOX_KEY, '1');
  sessionStorage.setItem(MAIL_TAB_KEY, 'sent');
  sessionStorage.removeItem(MAIL_MSG_KEY);
  showScreen('inbox-screen');
  activeMailTab = 'sent';
  const listEl = document.getElementById('inbox-list')!;
  const messageEl = document.getElementById('inbox-message')!;
  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';
  messageEl.innerHTML = '<p class="lobby-empty">Select a message to read</p>';

  try {
    const resp = await fetch('/api/mail/sent');
    if (!resp.ok) { listEl.innerHTML = '<p class="lobby-empty">Failed to load sent mail</p>'; return; }
    const data = await resp.json() as { messages: InboxMessage[] };

    updateMailBadge(0);

    renderMailList(listEl, messageEl, data.messages, {});
  } catch {
    listEl.innerHTML = '<p class="lobby-empty">Connection error</p>';
  }
}

/** Shape of a mail message from the API. */
interface InboxMessage {
  readonly id: string;
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
            if (!currentDeckId) btn.disabled = true;
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
      const data = await resp.json() as { name: string; isReviewer?: boolean };
      lobbyPlayerName = data.name;
      lobbyPlayerIsReviewer = data.isReviewer ?? false;

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
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
  const connectForm = document.getElementById('connect-form') as HTMLElement;
  const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;

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

  // Restore saved view mode (default to visual when no preference stored)
  if (localStorage.getItem(VIEW_KEY) !== 'debug') {
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
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      if (lobbyWs) { lobbyWs.close(); lobbyWs = null; }
      showScreen('login-screen');
    })(); };
    document.getElementById('logout-btn')!.addEventListener('click', doLogout);

    const savePrompt = document.getElementById('save-prompt')!;
    const continueGameBtn = document.getElementById('continue-game-btn') as HTMLButtonElement;
    const newGameBtn = document.getElementById('new-game-btn') as HTMLButtonElement;

    /** Send the play-ai message and disable the UI. */
    function launchAiGame(): void {
      if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
        const aiDeckSelect = document.getElementById('ai-deck-select') as HTMLSelectElement;
        lobbyWs.send(JSON.stringify({ type: 'play-ai', deckId: aiDeckSelect.value }));
        playAiBtn.textContent = 'Starting...';
        playAiBtn.disabled = true;
        savePrompt.classList.add('hidden');
      }
    }

    playAiBtn.addEventListener('click', () => { void (async () => {
      const resp = await fetch('/api/saves/check?opponent=AI-Random');
      if (resp.ok) {
        const data = await resp.json() as { hasSave: boolean };
        if (data.hasSave) {
          playAiBtn.classList.add('hidden');
          savePrompt.classList.remove('hidden');
          return;
        }
      }
      launchAiGame();
    })(); });

    continueGameBtn.addEventListener('click', () => {
      launchAiGame();
    });

    newGameBtn.addEventListener('click', () => { void (async () => {
      await fetch('/api/saves/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opponent: 'AI-Random' }),
      });
      launchAiGame();
    })(); });

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

    // "Choose a deck" link in the no-deck notice
    document.getElementById('no-deck-link')!.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('nav-decks')!.click();
    });

    // Nav bar buttons
    document.getElementById('nav-lobby')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      showScreen('lobby-screen');
    });
    document.getElementById('nav-decks')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_INBOX_KEY);
      sessionStorage.removeItem(MAIL_TAB_KEY);
      sessionStorage.removeItem(MAIL_MSG_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      sessionStorage.setItem(VIEWING_DECKS_KEY, '1');
      showScreen('decks-screen');
    });
    document.getElementById('nav-mail')!.addEventListener('click', () => {
      sessionStorage.removeItem(VIEWING_DECKS_KEY);
      sessionStorage.removeItem(EDITING_DECK_KEY);
      void openInbox();
    });

    // Feature request modal handlers
    const frModal = document.getElementById('feature-request-modal')!;
    const frSubject = document.getElementById('feature-request-subject') as HTMLInputElement;
    const frBody = document.getElementById('feature-request-body') as HTMLTextAreaElement;
    const closeFeatureModal = () => { frModal.classList.add('hidden'); };
    document.getElementById('feature-request-backdrop')!.addEventListener('click', closeFeatureModal);
    document.getElementById('feature-request-cancel')!.addEventListener('click', closeFeatureModal);
    document.getElementById('feature-request-send')!.addEventListener('click', () => {
      const brief = frSubject.value.trim();
      const text = frBody.value.trim();
      if (!brief || !text) return;
      void (async () => {
        const resp = await fetch('/api/mail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipients: ['admin'],
            subject: `Feature Request: ${brief}`,
            topic: 'feature-request',
            body: text,
          }),
        });
        if (resp.ok) {
          closeFeatureModal();
          void openSent();
        }
      })();
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
