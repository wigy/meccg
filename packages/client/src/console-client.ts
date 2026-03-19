import WebSocket from 'ws';
import * as readline from 'readline';
import type { PlayerId, ServerMessage, ClientMessage, JoinMessage, CardDefinitionId } from '@meccg/shared';
import { parseAction } from './action-parser.js';

const SERVER_URL = process.env.SERVER_URL ?? 'ws://localhost:3000';
const PLAYER_NAME = process.argv[2] ?? 'Player';

// Default test deck config
const defaultJoin: JoinMessage = {
  type: 'join',
  name: PLAYER_NAME,
  draftPool: [
    'tw-120' as CardDefinitionId, // Aragorn
    'tw-131' as CardDefinitionId, // Bilbo
    'tw-152' as CardDefinitionId, // Frodo
  ],
  startingMinorItems: [
    'tw-206' as CardDefinitionId, // Dagger of Westernesse
  ],
  playDeck: buildDefaultPlayDeck(),
  siteDeck: [
    'tw-413' as CardDefinitionId, // Moria
    'tw-412' as CardDefinitionId, // Minas Tirith
    'tw-414' as CardDefinitionId, // Mount Doom
  ],
  startingHaven: 'tw-421' as CardDefinitionId, // Rivendell
};

function buildDefaultPlayDeck(): CardDefinitionId[] {
  const resources = ['tw-244', 'tw-333', 'tw-345', 'tw-347'] as CardDefinitionId[];
  const hazards = ['tw-020', 'tw-074', 'tw-015'] as CardDefinitionId[];
  const deck: CardDefinitionId[] = [];
  for (let i = 0; i < 5; i++) {
    deck.push(...resources, ...hazards);
  }
  return deck;
}

// ---- Connection ----

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
      console.log('\n--- Game State ---');
      console.log(`Phase: ${msg.view.phaseState.phase} | Turn: ${msg.view.turnNumber}`);
      console.log(`You: ${msg.view.self.name} | Hand: ${msg.view.self.hand.length} cards`);
      console.log(`Opponent: ${msg.view.opponent.name} | Hand: ${msg.view.opponent.handSize} cards`);

      // Show draft state if in draft phase
      if (msg.view.phaseState.phase === 'character-draft') {
        const draft = msg.view.phaseState;
        console.log(`Draft round: ${draft.round}`);
        console.log(`Your pool: ${draft.draftState[0].pool.join(', ') || '(empty)'}`);
        console.log(`Your drafted: ${draft.draftState[0].drafted.join(', ') || '(none)'}`);
        if (draft.setAside.length > 0) {
          console.log(`Set aside: ${draft.setAside.join(', ')}`);
        }
      }

      // Show companies
      for (const company of msg.view.self.companies) {
        console.log(`  Company @ ${company.currentSite}: ${company.characters.join(', ')}`);
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
