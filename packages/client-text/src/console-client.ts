/**
 * @module console-client
 *
 * Interactive text-based MECCG client that connects to the game server over
 * WebSocket and presents the game state in the terminal.
 *
 * Usage:
 * ```
 * npx tsx src/console-client.ts [playerName]
 * ```
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
import type { PlayerId, ServerMessage, ClientMessage, JoinMessage, CardDefinitionId, GameAction } from '@meccg/shared';
import {
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, SAM_GAMGEE, ELROND, CELEBORN, THEODEN, BEORN,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM,
  loadCardPool,
  formatPlayerView,
  formatCardName,
  formatCardList,
  describeAction,
  colorDebug,
  setShowDebugIds,
} from '@meccg/shared';
import { parseAction } from './action-parser.js';
import { loadAiStrategy, sampleWeighted } from './ai/index.js';
import type { AiStrategy } from './ai/index.js';

const SERVER_URL = process.env.SERVER_URL ?? 'ws://localhost:3000';
const DEBUG = process.argv.includes('--debug') || process.env.DEBUG === '1';
const AI_MODE = process.argv.includes('--ai') ? (process.argv[process.argv.indexOf('--ai') + 1] ?? 'random') : null;
const PLAYER_NAME = process.argv.filter(a => !a.startsWith('--') && a !== 'random')[2] ?? 'Player';
const RECONNECT_DELAY_MS = 2000;
/** Delay before AI submits an action (ms), so humans can read the output. */
const AI_ACTION_DELAY_MS = 1000;

const cardPool = loadCardPool();
setShowDebugIds(DEBUG);

let aiStrategy: AiStrategy | null = null;
if (AI_MODE) {
  aiStrategy = loadAiStrategy(AI_MODE);
  if (!aiStrategy) {
    console.error(`Unknown AI strategy: ${AI_MODE}`);
    console.error('Available: random');
    process.exit(1);
  }
}

function buildDefaultPlayDeck(): CardDefinitionId[] {
  const resources = [GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING];
  const hazards = [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT];
  const deck: CardDefinitionId[] = [];
  for (let i = 0; i < 5; i++) {
    deck.push(...resources, ...hazards);
  }
  return deck;
}

const defaultJoin: JoinMessage = {
  type: 'join',
  name: PLAYER_NAME,
  draftPool: [ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, SAM_GAMGEE, ELROND, CELEBORN, THEODEN, BEORN],
  startingMinorItems: [DAGGER_OF_WESTERNESSE],
  playDeck: buildDefaultPlayDeck(),
  siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
  startingHavens: [RIVENDELL],
};

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
/** Last received legal actions, indexed for quick selection by number. */
let lastLegalActions: GameAction[] = [];

// ---- Connect / Reconnect ----

function connect(): void {
  playerId = null;
  // shouldReconnect = false;

  const socket = new WebSocket(SERVER_URL);
  ws = socket;

  socket.on('open', () => {
    console.log(`Connected to ${SERVER_URL} as "${PLAYER_NAME}"${AI_MODE ? ` (AI: ${AI_MODE})` : ''}`);
    socket.send(JSON.stringify(defaultJoin));
  });

  socket.on('message', (raw: Buffer) => {
    const data = raw.toString();
    if (DEBUG) {
      console.log(colorDebug(`<< ${data}`));
    }
    const msg: ServerMessage = JSON.parse(data) as ServerMessage;

    switch (msg.type) {
      case 'assigned':
        playerId = msg.playerId;
        console.log(`Assigned player ID: ${playerId}`);
        break;

      case 'waiting':
        console.log('Waiting for opponent to connect...');
        break;

      case 'state':
        console.log('\n' + formatPlayerView(msg.view, cardPool));

        if (msg.view.phaseState.phase === 'character-draft') {
          const draft = msg.view.phaseState;
          const list = (ids: readonly CardDefinitionId[]) => formatCardList(ids, cardPool);
          console.log(`Draft round: ${draft.round}`);

          const isSpectator = playerId === 'spectator';
          if (isSpectator) {
            console.log(`${msg.view.self.name} pool: ${list(draft.draftState[0].pool)}`);
            console.log(`${msg.view.self.name} drafted: ${list(draft.draftState[0].drafted)}`);
            console.log(`${msg.view.opponent.name} pool: ${list(draft.draftState[1].pool)}`);
            console.log(`${msg.view.opponent.name} drafted: ${list(draft.draftState[1].drafted)}`);
          } else {
            // Self pool has real card IDs; opponent pool has 'unknown-card' placeholders
            const hasRealCards = (pool: readonly CardDefinitionId[]) =>
              pool.length > 0 && (pool[0] as string) !== 'unknown-card';
            const selfIdx = hasRealCards(draft.draftState[0].pool) ? 0
              : hasRealCards(draft.draftState[1].pool) ? 1
              : 0;
            const oppIdx = 1 - selfIdx;
            console.log(`Your pool: ${list(draft.draftState[selfIdx].pool)}`);
            console.log(`Your drafted: ${list(draft.draftState[selfIdx].drafted)}`);
            console.log(`Opponent pool: ${list(draft.draftState[oppIdx].pool)}`);
            console.log(`Opponent drafted: ${list(draft.draftState[oppIdx].drafted)}`);
          }

          if (draft.setAside.length > 0) {
            console.log(`Set aside: ${list(draft.setAside)}`);
          }
        }

        lastLegalActions = [...msg.view.legalActions];

        // AI mode: compute weights, display probabilities, sample and send
        if (aiStrategy && lastLegalActions.length > 0) {
          const weighted = aiStrategy.weighActions({ view: msg.view, cardPool, legalActions: lastLegalActions });
          const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

          // Display probabilities
          console.log(`AI (${aiStrategy.name}) thinking:`);
          for (let i = 0; i < weighted.length; i++) {
            const pct = totalWeight > 0 ? (weighted[i].weight / totalWeight * 100).toFixed(0) : '0';
            const desc = describeAction(weighted[i].action, cardPool);
            console.log(`  [${i + 1}] ${pct}% ${desc}`);
          }

          setTimeout(() => {
            if (!ws || ws.readyState !== WebSocket.OPEN || !aiStrategy || lastLegalActions.length === 0) return;
            const action = sampleWeighted(weighted);
            const desc = describeAction(action, cardPool);
            console.log(`AI (${aiStrategy.name}) picks: ${desc}`);
            if (DEBUG) {
              console.log(colorDebug(`>> ${JSON.stringify(action)}`));
            }
            const outMsg: ClientMessage = { type: 'action', action };
            ws.send(JSON.stringify(outMsg));
          }, AI_ACTION_DELAY_MS);
        } else {
          // Human mode: display numbered legal actions for quick selection
          if (lastLegalActions.length > 0) {
            console.log('Legal actions:');
            for (let i = 0; i < lastLegalActions.length; i++) {
              const desc = describeAction(lastLegalActions[i], cardPool);
              if (DEBUG) {
                const { player: _p, ...payload } = lastLegalActions[i];
                console.log(`  [${i + 1}] ${desc}  ${colorDebug(JSON.stringify(payload))}`);
              } else {
                console.log(`  [${i + 1}] ${desc}`);
              }
            }
          }
          console.log('');
          rl.prompt();
        }
        break;

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

      case 'error':
        console.log(`ERROR: ${msg.message}`);
        rl.prompt();
        break;

      case 'disconnected':
        console.log(`\n${msg.message}`);
        console.log('Reconnect to resume the game.');
        break;

      case 'restart':
        console.log(`\n${msg.message}`);
        // shouldReconnect = true;
        break;
    }
  });

  socket.on('close', () => {
    ws = null;
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

  // Try number shortcut first
  const num = parseInt(input, 10);
  const action: GameAction | null = (!isNaN(num) && num >= 1 && num <= lastLegalActions.length)
    ? lastLegalActions[num - 1]
    : parseAction(input, playerId);

  if (!action) {
    console.log(`Unknown command: ${input}`);
    console.log('Type a number to pick a legal action, or: draft-pick <id>, draft-stop, pass, quit');
    rl.prompt();
    return;
  }

  if (DEBUG) {
    console.log(colorDebug(`>> ${JSON.stringify(action)}`));
  }
  const msg: ClientMessage = { type: 'action', action };
  ws.send(JSON.stringify(msg));
});

rl.on('close', () => {
  ws?.close();
  process.exit(0);
});

// ---- Start ----

connect();
