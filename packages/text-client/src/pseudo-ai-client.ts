/**
 * @module pseudo-ai-client
 *
 * Headless pseudo-AI player that connects to a game server via WebSocket
 * and relays legal actions to the lobby server via IPC. The human player
 * makes all decisions for this AI — it is a dumb message relay.
 *
 * Spawned as a child process by the game launcher with IPC enabled.
 *
 * Usage: npx tsx pseudo-ai-client.ts <port> <playerName> <token> --deck <deckId>
 */

import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import type { ServerMessage, ClientMessage, EvaluatedAction, CardDefinitionId } from '@meccg/shared';
import { Alignment } from '@meccg/shared';
import type { JoinMessage } from '@meccg/shared';

const args = process.argv.filter(a => !a.startsWith('--'));
const PORT = parseInt(args[2], 10);
const PLAYER_NAME = args[3];
const TOKEN = args[4];
const DECK_FLAG_IDX = process.argv.indexOf('--deck');
const DECK_ID = DECK_FLAG_IDX >= 0 ? process.argv[DECK_FLAG_IDX + 1] : undefined;

if (!PORT || !PLAYER_NAME || !TOKEN) {
  console.error('Usage: pseudo-ai-client <port> <playerName> <token> [--deck <deckId>]');
  process.exit(1);
}

/** Deck file entry with optional card ID. */
interface DeckEntry { name: string; card: string | null; qty: number }
/** On-disk deck structure. */
interface DeckFile {
  id: string; name: string; alignment: string;
  pool: DeckEntry[];
  deck: { characters: DeckEntry[]; hazards: DeckEntry[]; resources: DeckEntry[] };
  sites: DeckEntry[];
  sideboard: DeckEntry[];
}

const DECK_CATALOG_DIR = path.join(__dirname, '../../../data/decks');
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

function loadDeckFile(deckId: string): JoinMessage {
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

/** IPC message from lobby to pseudo-AI: the human's chosen action. */
interface PseudoAiPickIpc {
  readonly type: 'pseudo-ai-pick';
  readonly action: import('@meccg/shared').GameAction;
}

let gameWs: WebSocket | null = null;

/** Listen for action picks from the lobby (relayed from the human player). */
process.on('message', (msg: PseudoAiPickIpc) => {
  if (msg.type === 'pseudo-ai-pick' && gameWs && gameWs.readyState === WebSocket.OPEN) {
    const actionMsg: ClientMessage = { type: 'action', action: msg.action };
    console.log(`Pseudo-AI relaying action: ${msg.action.type}`);
    gameWs.send(JSON.stringify(actionMsg));
  }
});

function connect(): void {
  const url = `ws://localhost:${PORT}`;
  console.log(`Pseudo-AI connecting to ${url} as "${PLAYER_NAME}"...`);
  const ws = new WebSocket(url);
  gameWs = ws;

  ws.on('open', () => {
    let joinMsg: JoinMessage;
    if (DECK_ID) {
      console.log(`Pseudo-AI connected, sending join with deck "${DECK_ID}"...`);
      joinMsg = loadDeckFile(DECK_ID);
    } else {
      // Rejoin: server already has game state from autosave, send minimal join
      console.log('Pseudo-AI connected, sending minimal join (rejoin)...');
      joinMsg = { type: 'join', name: PLAYER_NAME, alignment: Alignment.Wizard, draftPool: [], playDeck: [], siteDeck: [], sideboard: [] };
    }
    const msg: ClientMessage = { ...joinMsg, token: TOKEN } as ClientMessage;
    ws.send(JSON.stringify(msg));
  });

  ws.on('message', (raw: Buffer) => {
    const msg = JSON.parse(raw.toString()) as ServerMessage;

    switch (msg.type) {
      case 'assigned':
        console.log(`Pseudo-AI assigned player ID: ${msg.playerId}`);
        break;

      case 'state': {
        const evaluated: readonly EvaluatedAction[] = msg.view.legalActions;
        if (!evaluated || evaluated.length === 0) break;
        const phase = msg.view.phaseState.phase;
        // Relay legal actions to the lobby via IPC for the human to decide
        console.log(`Pseudo-AI relaying ${evaluated.length} actions (phase: ${phase})`);
        process.send!({ type: 'pseudo-ai-actions', actions: evaluated, phase });
        break;
      }

      case 'error':
        console.log(`Pseudo-AI received error: ${msg.message}`);
        break;

      case 'waiting':
        console.log('Pseudo-AI waiting for opponent...');
        break;

      case 'restart':
        console.log('Pseudo-AI: server restarting, will reconnect...');
        break;

      case 'disconnected':
        console.log('Pseudo-AI: opponent disconnected');
        break;
    }
  });

  ws.on('close', () => {
    gameWs = null;
    console.log('Pseudo-AI disconnected, reconnecting in 2s...');
    setTimeout(() => connect(), 2000);
  });

  ws.on('error', (err) => {
    console.error('Pseudo-AI connection error:', err.message);
    setTimeout(() => {
      console.log('Pseudo-AI retrying connection...');
      connect();
    }, 1000);
  });
}

connect();
