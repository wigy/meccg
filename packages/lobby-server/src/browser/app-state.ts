/**
 * @module app-state
 *
 * Shared mutable state for the browser application. All modules that need
 * to read or modify global app state import from here rather than keeping
 * their own top-level variables. This avoids circular dependencies by
 * making state a leaf dependency.
 */

import type { CardDefinitionId, CardInstanceId, CardDefinition, GameAction, JoinMessage } from '@meccg/shared';
import { loadCardPool, Alignment } from '@meccg/shared';

// ---- Deck types ----

/** Summary info for a deck. */
export interface DeckSummary { id: string; name: string; alignment: string }

/** A single entry in a deck list section (pool, characters, etc.). */
export interface DeckListEntry { name: string; card: string | null; qty: number; favourite?: boolean }

/** Full deck definition including all sections. */
export interface FullDeck extends DeckSummary {
  pool: DeckListEntry[];
  deck: { characters: DeckListEntry[]; hazards: DeckListEntry[]; resources: DeckListEntry[] };
  sites: DeckListEntry[];
  sideboard: DeckListEntry[];
}

// ---- Card pool (immutable after load) ----

/** The full card pool loaded at startup. */
export const cardPool: Readonly<Record<string, CardDefinition>> = loadCardPool();

// ---- Screen type ----

/** All screen IDs used in the lobby UI. */
export type ScreenId = 'login-screen' | 'register-screen' | 'lobby-screen' | 'decks-screen' | 'deck-editor-screen' | 'inbox-screen' | 'connect-form';

// ---- Global mutable state ----

/**
 * Shared mutable application state. Every field is directly readable and
 * writable by any module that imports `appState`.
 */
export const appState = {
  /** Active game WebSocket connection. */
  ws: null as WebSocket | null,
  /** Assigned player ID from the game server. */
  playerId: null as string | null,

  /** Lobby WebSocket connection (only in lobby mode). */
  lobbyWs: null as WebSocket | null,
  /** Current game server port (lobby mode -- direct connection). */
  gamePort: null as number | null,
  /** Current game token (lobby mode). */
  gameToken: null as string | null,

  /** Current logged-in player name (lobby mode). */
  lobbyPlayerName: null as string | null,
  /** Whether the current player has reviewer privileges. */
  lobbyPlayerIsReviewer: false,
  /** Current player's credit balance. */
  lobbyPlayerCredits: 0,
  /** Name of the player who sent us a challenge (lobby mode). */
  challengeFrom: null as string | null,

  /** Instance ID to definition ID lookup for the current game state. */
  lastInstanceLookup: (() => undefined) as (instId: CardInstanceId) => CardDefinitionId | undefined,
  /** Company name lookup for the current game state. */
  lastCompanyNames: {} as Readonly<Record<string, string>>,
  /** Phase from the last state update, for detecting phase transitions. */
  lastPhase: null as string | null,
  /** Current game ID (set on 'assigned' message). */
  currentGameId: null as string | null,
  /** Latest state sequence number (updated on each 'state' message). */
  currentStateSeq: 0,
  /** Opponent player name (lobby mode, set on 'game-starting'). */
  opponentName: null as string | null,

  /** Whether the current game is a pseudo-AI game (human controls both sides). */
  isPseudoAi: false,
  /** Second WebSocket for pseudo-AI: connects as the AI player. */
  pseudoAiWs: null as WebSocket | null,
  /** AI player's game token (pseudo-AI mode). */
  pseudoAiToken: null as string | null,
  /** The AI's selected deck, captured when the user clicks Play vs Pseudo-AI. */
  pendingAiDeck: null as FullDeck | null,

  /** Timer handle for auto-pass feature. */
  autoPassTimer: null as ReturnType<typeof setTimeout> | null,
  /** Stack of log entry counts, pushed before each action for undo support. */
  logCountStack: [] as number[],

  /** Whether to auto-reconnect on WebSocket close. */
  autoReconnect: true,
  /** Number of consecutive failed reconnect attempts. */
  reconnectAttempts: 0,

  // ---- Deck browser state ----

  /** IDs of decks the player already owns. */
  ownedDeckIds: new Set<string>(),
  /** Cached deck catalog for looking up AI decks. */
  cachedCatalog: [] as FullDeck[],
  /** Whether the my-deck-select change handler has been installed. */
  myDeckSelectInstalled: false,
  /** Currently selected deck ID. */
  currentDeckId: null as string | null,
  /** The current player's selected deck, loaded from the lobby API. */
  currentFullDeck: null as FullDeck | null,

  // ---- Deck editor state ----

  /** Set of "deckId:cardName" keys for already-requested cards. */
  requestedCards: new Set<string>(),
  /** Set of card definition IDs for already-requested certifications. */
  requestedCertifications: new Set<string>(),

  // ---- Inbox state ----

  /** Which mail tab is active. */
  activeMailTab: 'inbox' as 'inbox' | 'sent',
};

// ---- Constants ----

/** Whether the server was started in dev mode. Controls dev UI availability. */
export const SERVER_DEV = window.__MECCG_DEV === true;

/** Whether we are running under the lobby server (auth + matchmaking). */
export const LOBBY_MODE = window.__LOBBY === true;

// ---- Session storage keys ----

export const GAME_PORT_KEY = 'meccg-game-port';
export const GAME_TOKEN_KEY = 'meccg-game-token';
export const GAME_OPPONENT_KEY = 'meccg-game-opponent';
export const PSEUDO_AI_KEY = 'meccg-pseudo-ai';
export const PSEUDO_AI_TOKEN_KEY = 'meccg-pseudo-ai-token';
export const STORAGE_KEY = 'meccg-player-name';
export const VIEW_KEY = 'meccg-view-mode';
export const DEV_MODE_KEY = 'meccg-dev-mode';
export const AUTO_PASS_KEY = 'meccg-auto-pass';
export const BG_KEY = 'meccg-bg';
export const EDITING_DECK_KEY = 'meccg-editing-deck';
export const VIEWING_INBOX_KEY = 'meccg-viewing-inbox';
export const VIEWING_DECKS_KEY = 'meccg-viewing-decks';
export const MAIL_TAB_KEY = 'meccg-mail-tab';
export const MAIL_MSG_KEY = 'meccg-mail-msg';

/** Maximum reconnect attempts before giving up and returning to the lobby. */
export const MAX_RECONNECT_ATTEMPTS = 5;

/** Map deck file alignment strings to the Alignment enum used in JoinMessage. */
export const ALIGNMENT_MAP: Record<string, Alignment> = {
  hero: Alignment.Wizard,
  minion: Alignment.Ringwraith,
  'fallen-wizard': Alignment.FallenWizard,
  balrog: Alignment.Balrog,
};

// ---- Background images ----

export const BACKGROUNDS = [
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

// ---- Utility functions ----

/** Expand deck list entries into repeated card IDs, filtering out unimplemented cards. */
export function expandEntries(entries: DeckListEntry[]): CardDefinitionId[] {
  const ids: CardDefinitionId[] = [];
  for (const e of entries) {
    if (e.card !== null) {
      for (let i = 0; i < e.qty; i++) ids.push(e.card as CardDefinitionId);
    }
  }
  return ids;
}

/** Build a JoinMessage from a player deck, filtering out unimplemented cards. */
export function buildJoinFromDeck(deck: FullDeck, playerName: string): JoinMessage {
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
    sideboard: expandEntries(deck.sideboard ?? []),
  };
}

/** Return names of cards that have no card ID (not yet created). */
export function missingCards(deck: FullDeck): string[] {
  const allEntries = [
    ...deck.pool,
    ...deck.deck.characters, ...deck.deck.hazards, ...deck.deck.resources,
    ...deck.sites,
    ...(deck.sideboard ?? []),
  ];
  return allEntries.filter(e => e.card === null).map(e => e.name);
}

/** Return names of cards that exist but are not yet certified. */
export function uncertifiedCards(deck: FullDeck): string[] {
  const allEntries = [
    ...deck.pool,
    ...deck.deck.characters, ...deck.deck.hazards, ...deck.deck.resources,
    ...deck.sites,
    ...(deck.sideboard ?? []),
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const e of allEntries) {
    if (e.card === null || seen.has(e.card)) continue;
    seen.add(e.card);
    const def = cardPool[e.card];
    if (def && !('certified' in def && (def as unknown as Record<string, unknown>).certified)) {
      result.push(e.name);
    }
  }
  return result;
}

/** Sort deck entries: favourites first, then known cards, then by card type, then by name. */
export function sortDeckEntries(entries: DeckListEntry[]): DeckListEntry[] {
  return [...entries].sort((a, b) => {
    if (a.favourite !== b.favourite) return a.favourite ? -1 : 1;
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
}
