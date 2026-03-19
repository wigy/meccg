/**
 * @module console-client
 *
 * Interactive text-based MECCG client that connects to the game server over
 * WebSocket and presents the game state in the terminal.
 *
 * Usage:
 * ```
 * node console-client.js [playerName]
 * ```
 *
 * Environment variables:
 * - `SERVER_URL` — WebSocket URL (default `ws://localhost:3000`).
 *
 * On startup the client automatically sends a "join" message with a
 * hard-coded default deck (useful for quick testing). The user then types
 * commands (parsed by {@link parseAction}) which are sent as game actions.
 *
 * Server messages are printed to stdout: game state summaries after each
 * action, draft status during the character draft, and error messages for
 * illegal actions.
 */

import WebSocket from 'ws';
import * as readline from 'readline';
import type { PlayerId, ServerMessage, ClientMessage, JoinMessage, CardDefinitionId } from '@meccg/shared';
import {
  ARAGORN, BILBO, FRODO,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM,
  loadCardPool,
  formatPlayerView,
  formatDefName,
} from '@meccg/shared';
import { parseAction } from './action-parser.js';

/** WebSocket server URL, configurable via the `SERVER_URL` env var. */
const SERVER_URL = process.env.SERVER_URL ?? 'ws://localhost:3000';
/** Player display name, taken from the first CLI argument or defaulting to "Player". */
const PLAYER_NAME = process.argv[2] ?? 'Player';

/**
 * Builds a simple test play deck by repeating a small set of resource and
 * hazard cards. The resulting deck is large enough to pass minimum deck size
 * requirements for testing, but is not competitively constructed.
 *
 * @returns An array of card definition IDs forming a minimal valid play deck.
 */
function buildDefaultPlayDeck(): CardDefinitionId[] {
  const resources = [GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING];
  const hazards = [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT];
  const deck: CardDefinitionId[] = [];
  for (let i = 0; i < 5; i++) {
    deck.push(...resources, ...hazards);
  }
  return deck;
}

/**
 * Default join message sent automatically on connection. Contains a small
 * draft pool (Aragorn, Bilbo, Frodo), a starter item, a repeating test
 * deck, and Rivendell as the starting haven.
 */
const defaultJoin: JoinMessage = {
  type: 'join',
  name: PLAYER_NAME,
  draftPool: [ARAGORN, BILBO, FRODO],
  startingMinorItems: [DAGGER_OF_WESTERNESSE],
  playDeck: buildDefaultPlayDeck(),
  siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
  startingHaven: RIVENDELL,
};

// ---- Connection ----

/** The card pool for resolving card names in the formatter. */
const cardPool = loadCardPool();

/** The player ID assigned by the server after the "join" handshake. */
let playerId: PlayerId | null = null;

const ws = new WebSocket(SERVER_URL);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

ws.on('open', () => {
  console.log(`Connected to ${SERVER_URL} as "${PLAYER_NAME}"`);
  ws.send(JSON.stringify(defaultJoin));
});

ws.on('message', (data) => {
  const msg: ServerMessage = JSON.parse(data.toString());

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

      // Show draft-specific info
      if (msg.view.phaseState.phase === 'character-draft') {
        const draft = msg.view.phaseState;
        const colorNames = (ids: readonly CardDefinitionId[]) =>
          ids.map(id => formatDefName(id, cardPool)).join(', ');
        console.log(`Draft round: ${draft.round}`);
        console.log(`Your pool: ${colorNames(draft.draftState[0].pool) || '(empty)'}`);
        console.log(`Your drafted: ${colorNames(draft.draftState[0].drafted) || '(none)'}`);
        if (draft.setAside.length > 0) {
          console.log(`Set aside: ${colorNames(draft.setAside)}`);
        }
      }

      console.log(`Legal actions: ${msg.view.legalActions.join(', ')}`);
      console.log('');
      rl.prompt();
      break;

    case 'error':
      console.log(`ERROR: ${msg.message}`);
      rl.prompt();
      break;
  }
});

ws.on('close', () => {
  console.log('Disconnected from server');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

// ---- Input handling ----
// Readline processes user commands, parses them via parseAction, and sends
// the resulting GameAction to the server as a JSON-encoded ClientMessage.

rl.on('line', (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }

  if (input === 'quit' || input === 'exit') {
    ws.close();
    process.exit(0);
  }

  if (!playerId) {
    console.log('Not yet assigned a player ID');
    rl.prompt();
    return;
  }

  const action = parseAction(input, playerId);
  if (!action) {
    console.log(`Unknown command: ${input}`);
    console.log('Commands: draft-pick <id>, draft-stop, pass, quit');
    rl.prompt();
    return;
  }

  const msg: ClientMessage = { type: 'action', action };
  ws.send(JSON.stringify(msg));
});

rl.on('close', () => {
  ws.close();
  process.exit(0);
});
