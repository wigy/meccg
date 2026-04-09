/**
 * @module console-client
 *
 * Interactive text-based MECCG client that connects to the game server over
 * WebSocket and presents the game state in the terminal.
 *
 * Usage:
 * ```
 * npx tsx src/console-client.ts [playerName] [--deck <id>]
 * ```
 *
 * If `--deck` is omitted, the first sample deck (hero) is used.
 * Pass an invalid deck name to see the list of available decks.
 *
 * Environment variables:
 * - `SERVER_URL` — WebSocket URL (default `ws://localhost:3000`).
 *
 * Supports auto-reconnect: when the server sends a "restart" message
 * (e.g. due to code reload), the client waits briefly and reconnects
 * with the same player name and deck config.
 */

import WebSocket from 'ws';
import * as readline from 'readline';
import type { PlayerId, ServerMessage, ClientMessage, CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadCardPool,
  formatPlayerView,
  formatCardName,
  formatCardList,
  describeAction,
  buildCompanyNames,
  buildInstanceLookup,
  stripCardMarkers,
  STATE_DIVIDER,
  Alignment,
} from '@meccg/shared';
import type { JoinMessage } from '@meccg/shared';
import { loadAiStrategy, sampleWeighted } from '@meccg/shared';
import type { AiStrategy } from '@meccg/shared';
import { ClientLog } from './client-log.js';

const SERVER_URL = process.env.SERVER_URL ?? 'ws://localhost:3000';
const AI_MODE = process.argv.includes('--ai') ? (process.argv[process.argv.indexOf('--ai') + 1] ?? 'heuristic') : null;
const DECK_ARG = process.argv.includes('--deck') ? (process.argv[process.argv.indexOf('--deck') + 1] ?? null) : null;
/** Extract the player name: skip flags and flag values (--ai X, --deck X). */
const PLAYER_NAME = (() => {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ai' || args[i] === '--deck') { i++; continue; }
    if (args[i].startsWith('--')) continue;
    positional.push(args[i]);
  }
  return positional[0] ?? 'Player';
})();
const RECONNECT_DELAY_MS = 2000;
/** Delay before AI submits an action (ms), so humans can read the output. */
const AI_ACTION_DELAY_MS = 1000;

const cardPool = loadCardPool();

// Strip STX card-ID markers from all console output (used by web client only)
const originalLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  originalLog(...args.map(a => typeof a === 'string' ? stripCardMarkers(a) : a));
};

let aiStrategy: AiStrategy | null = null;
if (AI_MODE) {
  aiStrategy = loadAiStrategy(AI_MODE);
  if (!aiStrategy) {
    console.error(`Unknown AI strategy: ${AI_MODE}`);
    console.error('Available: heuristic');
    process.exit(1);
  }
}

// ---- Catalog deck loading ----

interface DeckEntry { name: string; card: string | null; qty: number }
interface DeckFile {
  id: string; name: string; alignment: string;
  pool: DeckEntry[];
  deck: { characters: DeckEntry[]; hazards: DeckEntry[]; resources: DeckEntry[] };
  sites: DeckEntry[];
  sideboard?: DeckEntry[];
}

const DECK_CATALOG_DIR = path.join(__dirname, '../../../../data/decks');
const ALIGNMENT_MAP: Record<string, Alignment> = {
  hero: Alignment.Wizard,
  minion: Alignment.Ringwraith,
  'fallen-wizard': Alignment.FallenWizard,
  balrog: Alignment.Balrog,
};

function expandEntries(entries: DeckEntry[]): CardDefinitionId[] {
  const ids: CardDefinitionId[] = [];
  for (const e of entries) {
    if (e.card !== null) {
      for (let i = 0; i < e.qty; i++) ids.push(e.card as CardDefinitionId);
    }
  }
  return ids;
}

function loadCatalogDeck(deckId: string): JoinMessage {
  const filePath = path.join(DECK_CATALOG_DIR, `${deckId}.json`);
  const deck = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DeckFile;
  return {
    type: 'join',
    name: PLAYER_NAME,
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

function listCatalogDecks(): { id: string; name: string }[] {
  const files = fs.readdirSync(DECK_CATALOG_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const d = JSON.parse(fs.readFileSync(path.join(DECK_CATALOG_DIR, f), 'utf-8')) as DeckFile;
    return { id: d.id, name: d.name };
  });
}

// Resolve the catalog deck (--deck <id>, or default to first available)
const catalogDecks = listCatalogDecks();
if (DECK_ARG !== null && !catalogDecks.some(d => d.id === DECK_ARG)) {
  console.error(`Unknown deck: ${DECK_ARG}`);
  console.error('Available decks:');
  for (const d of catalogDecks) {
    console.error(`  ${d.id}  — ${d.name}`);
  }
  process.exit(1);
}

const selectedDeckId = DECK_ARG ?? catalogDecks[0]?.id;
if (!selectedDeckId) {
  console.error('No decks found in catalog');
  process.exit(1);
}
const defaultJoin = loadCatalogDeck(selectedDeckId);

const clientLog = new ClientLog();
clientLog.log('boot', { player: PLAYER_NAME, deck: selectedDeckId, ai: AI_MODE });

// ---- Readline (shared across connections) ----

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

// ---- Connection state ----

let playerId: PlayerId | null = null;
let ws: WebSocket | null = null;
// TODO: gate auto-reconnect on whether the server sent 'restart'
/** Last received viable legal actions, indexed for quick selection by number. */
let lastLegalActions: GameAction[] = [];

// ---- Connect / Reconnect ----

function connect(): void {
  playerId = null;
  // shouldReconnect = false;

  const socket = new WebSocket(SERVER_URL);
  ws = socket;

  socket.on('open', () => {
    console.log(`Connected to ${SERVER_URL} as "${PLAYER_NAME}" [${selectedDeckId}]${AI_MODE ? ` (AI: ${AI_MODE})` : ''}`);
    clientLog.log('connect', { server: SERVER_URL });
    clientLog.log('msg-out', { msgType: 'join', msg: defaultJoin });
    socket.send(JSON.stringify(defaultJoin));
  });

  socket.on('message', (raw: Buffer) => {
    const data = raw.toString();
    const msg: ServerMessage = JSON.parse(data) as ServerMessage;
    clientLog.log('msg-in', { msgType: msg.type, msg: msg.type === 'state' ? { type: 'state', turn: msg.view.turnNumber, phase: msg.view.phaseState.phase } : msg });
    switch (msg.type) {
      case 'assigned':
        playerId = msg.playerId;
        console.log(`Game ${msg.gameId} — assigned player ID: ${playerId}`);
        break;

      case 'waiting':
        console.log('Waiting for opponent to connect...');
        break;

      case 'state': {
        console.log(`\n${STATE_DIVIDER}\n${formatPlayerView(msg.view, cardPool)}\n${STATE_DIVIDER}`);

        if (msg.view.phaseState.phase === 'setup' && msg.view.phaseState.setupStep.step === 'character-draft') {
          const draft = msg.view.phaseState.setupStep;
          const instanceLookup = buildInstanceLookup(msg.view);
          const resolve = (ids: readonly CardInstanceId[]) =>
            ids.map(id => instanceLookup(id) ?? id as unknown as CardDefinitionId);
          const list = (ids: readonly CardInstanceId[]) => formatCardList(resolve(ids), cardPool);
          const ids = (cards: readonly { readonly instanceId: CardInstanceId }[]) =>
            cards.map(c => c.instanceId);
          console.log(`Draft round: ${draft.round}`);

          const isSpectator = playerId === 'spectator';
          if (isSpectator) {
            console.log(`${msg.view.self.name} pool: ${list(ids(draft.draftState[0].pool))}`);
            console.log(`${msg.view.self.name} drafted: ${list(ids(draft.draftState[0].drafted))}`);
            console.log(`${msg.view.opponent.name} pool: ${list(ids(draft.draftState[1].pool))}`);
            console.log(`${msg.view.opponent.name} drafted: ${list(ids(draft.draftState[1].drafted))}`);
          } else {
            // Self pool has real instance IDs; opponent pool has 'unknown-instance' placeholders
            const hasRealCards = (pool: readonly { readonly instanceId: CardInstanceId }[]) =>
              pool.length > 0 && (pool[0].instanceId as string) !== 'unknown-instance';
            const selfIdx = hasRealCards(draft.draftState[0].pool) ? 0
              : hasRealCards(draft.draftState[1].pool) ? 1
              : 0;
            const oppIdx = 1 - selfIdx;
            console.log(`Your pool: ${list(ids(draft.draftState[selfIdx].pool))}`);
            console.log(`Your drafted: ${list(ids(draft.draftState[selfIdx].drafted))}`);
            console.log(`Opponent pool: ${list(ids(draft.draftState[oppIdx].pool))}`);
            console.log(`Opponent drafted: ${list(ids(draft.draftState[oppIdx].drafted))}`);
          }

          if (draft.setAside.length > 0) {
            console.log(`Set aside: ${list(ids(draft.setAside))}`);
          }
        }

        const allEvaluated = msg.view.legalActions;
        lastLegalActions = allEvaluated.filter(e => e.viable).map(e => e.action);
        const nonViable = allEvaluated.filter(e => !e.viable);
        const instances = buildInstanceLookup(msg.view);
        const compNames = buildCompanyNames(msg.view.self.companies, msg.view.self.characters, cardPool);

        // AI mode: compute weights, display probabilities, sample and send
        if (aiStrategy && lastLegalActions.length > 0) {
          const weighted = aiStrategy.weighActions({ view: msg.view, cardPool, legalActions: lastLegalActions });
          const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

          // Display probabilities
          console.log(`AI (${aiStrategy.name}) thinking:`);
          for (let i = 0; i < weighted.length; i++) {
            const pct = totalWeight > 0 ? (weighted[i].weight / totalWeight * 100).toFixed(0) : '0';
            const desc = describeAction(weighted[i].action, cardPool, instances, compNames);
            console.log(`  [${i + 1}] ${pct}% ${desc}`);
          }

          setTimeout(() => {
            if (!ws || ws.readyState !== WebSocket.OPEN || !aiStrategy || lastLegalActions.length === 0) return;
            const action = sampleWeighted(weighted);
            const desc = describeAction(action, cardPool, instances, compNames);
            console.log(`AI (${aiStrategy.name}) picks: ${desc}`);
            clientLog.log('msg-out', { msgType: 'action', action });
            const outMsg: ClientMessage = { type: 'action', action };
            ws.send(JSON.stringify(outMsg));
          }, AI_ACTION_DELAY_MS);
        } else {
          // Human mode: display numbered legal actions for quick selection
          if (lastLegalActions.length > 0) {
            console.log('Legal actions:');
            for (let i = 0; i < lastLegalActions.length; i++) {
              const desc = describeAction(lastLegalActions[i], cardPool, instances, compNames);
              console.log(`  [${i + 1}] ${desc}`);
            }
          }
          if (nonViable.length > 0) {
            console.log('Not available:');
            for (const ea of nonViable) {
              const desc = describeAction(ea.action, cardPool, instances, compNames);
              console.log(`  ${desc} — ${ea.reason ?? '?'}`);
            }
          }
          console.log('');
          rl.prompt();
        }
        break;
      }

      case 'draft-reveal': {
        const pick1 = msg.player1Pick ? formatCardName(cardPool[msg.player1Pick as string]) : 'stopped';
        const pick2 = msg.player2Pick ? formatCardName(cardPool[msg.player2Pick as string]) : 'stopped';
        console.log('');
        console.log(`  ${msg.player1Name} reveals: ${pick1}`);
        console.log(`  ${msg.player2Name} reveals: ${pick2}`);
        if (msg.collision) {
          const collisionName = msg.player1Pick ? formatCardName(cardPool[msg.player1Pick as string]) : '???';
          console.log(`  Collision! ${collisionName} is set aside — neither player gets it.`);
        }
        break;
      }

      case 'info':
        console.log(msg.message);
        rl.prompt();
        break;

      case 'error':
        console.log(`ERROR: ${msg.message}`);
        rl.prompt();
        break;

      case 'disconnected':
        console.log(`\n${msg.message}`);
        console.log('Reconnect to resume the game.');
        break;

      case 'effect':
        if (msg.effect.effect === 'dice-roll') {
          const { playerName, die1, die2, label } = msg.effect;
          console.log(`  ${label}: ${playerName} rolled ${die1} + ${die2} = ${die1 + die2}`);
        }
        break;

      case 'restart':
        console.log(`\n${msg.message}`);
        // shouldReconnect = true;
        break;
    }
  });

  socket.on('close', () => {
    ws = null;
    clientLog.log('disconnect');
    console.log(`Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  socket.on('error', () => {
    // Connection refused or dropped — will retry on 'close' event
  });
}

// ---- Input handling ----

rl.on('line', (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }

  if (input === 'quit' || input === 'exit') {
    ws?.close();
    process.exit(0);
  }

  if (input === 'reset') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'reset' };
      ws.send(JSON.stringify(msg));
    }
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('Not connected to server');
    rl.prompt();
    return;
  }

  if (!playerId) {
    console.log('Not yet assigned a player ID');
    rl.prompt();
    return;
  }

  const num = parseInt(input, 10);
  if (isNaN(num) || num < 1 || num > lastLegalActions.length) {
    console.log(`Type a number (1-${lastLegalActions.length}) to pick a legal action, or quit`);
    rl.prompt();
    return;
  }
  const action = lastLegalActions[num - 1];

  clientLog.log('msg-out', { msgType: 'action', action });
  const msg: ClientMessage = { type: 'action', action };
  ws.send(JSON.stringify(msg));
});

rl.on('close', () => {
  ws?.close();
  process.exit(0);
});

// ---- Start ----

connect();
