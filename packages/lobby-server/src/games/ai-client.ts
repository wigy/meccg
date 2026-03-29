/**
 * @module games/ai-client
 *
 * Headless AI player that connects to a game server via WebSocket
 * and makes random legal moves. Spawned as a child process by the
 * game launcher when a player starts a game against AI.
 *
 * Usage: npx tsx ai-client.ts <port> <playerName> <token> --deck <deckId>
 */

import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import type { ServerMessage, ClientMessage, GameAction, EvaluatedAction, CardDefinitionId } from '@meccg/shared';
import { Alignment } from '@meccg/shared';
import type { JoinMessage } from '@meccg/shared';

const args = process.argv.filter(a => !a.startsWith('--'));
const PORT = parseInt(args[2], 10);
const PLAYER_NAME = args[3];
const TOKEN = args[4];
const DECK_FLAG_IDX = process.argv.indexOf('--deck');
const DECK_ID = DECK_FLAG_IDX >= 0 ? process.argv[DECK_FLAG_IDX + 1] : undefined;

if (!PORT || !PLAYER_NAME || !TOKEN || !DECK_ID) {
  console.error('Usage: ai-client <port> <playerName> <token> --deck <deckId>');
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
  };
}

/** Action types that represent "doing nothing". */
const PASS_ACTIONS = new Set(['pass', 'draft-stop']);
/** Action types that are optional. */
const OPTIONAL_ACTIONS = new Set(['place-character', 'add-character-to-deck', 'select-starting-site']);
/** Phases where pass is equally weighted. */
const PASS_OK_PHASES = new Set(['organization']);

/** Pick a random action from the list, preferring non-pass actions. */
function pickAction(actions: readonly GameAction[], phase: string): GameAction {
  const nonRegress = actions.filter(a => !('regress' in a && a.regress));
  const pool = nonRegress.length > 0 ? nonRegress : [...actions];
  const passOk = PASS_OK_PHASES.has(phase);
  const allOptional = pool.every(a => PASS_ACTIONS.has(a.type) || OPTIONAL_ACTIONS.has(a.type));
  const hasSubstantive = pool.some(a => !PASS_ACTIONS.has(a.type));

  const candidates = pool.filter(a => {
    if (PASS_ACTIONS.has(a.type) && hasSubstantive && !allOptional && !passOk) return false;
    return true;
  });

  const list = candidates.length > 0 ? candidates : pool;
  return list[Math.floor(Math.random() * list.length)];
}

function connect(): void {
  const url = `ws://localhost:${PORT}`;
  console.log(`AI connecting to ${url} as "${PLAYER_NAME}"...`);
  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log(`AI connected, sending join with deck "${DECK_ID}"...`);
    const joinMsg = loadDeckFile(DECK_ID!);
    const msg: ClientMessage = { ...joinMsg, token: TOKEN } as ClientMessage;
    ws.send(JSON.stringify(msg));
  });

  ws.on('message', (raw: Buffer) => {
    const msg = JSON.parse(raw.toString()) as ServerMessage;

    switch (msg.type) {
      case 'assigned':
        console.log(`AI assigned player ID: ${msg.playerId}`);
        break;

      case 'state': {
        const evaluated: readonly EvaluatedAction[] = msg.view.legalActions;
        if (!evaluated || evaluated.length === 0) break;
        // Extract only viable actions
        const actions = evaluated.filter(e => e.viable).map(e => e.action);
        if (actions.length === 0) break;
        const phase = msg.view.phaseState.phase;

        // Small delay to look more natural and avoid flooding
        setTimeout(() => {
          const action = pickAction(actions, phase);
          console.log(`AI action: ${action.type}`);
          const actionMsg: ClientMessage = { type: 'action', action };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(actionMsg));
          }
        }, 200);
        break;
      }

      case 'error':
        console.log(`AI received error: ${msg.message}`);
        break;

      case 'waiting':
        console.log('AI waiting for opponent...');
        break;

      case 'restart':
        console.log('AI: server restarting, will reconnect...');
        break;

      case 'disconnected':
        console.log('AI: opponent disconnected');
        break;
    }
  });

  ws.on('close', () => {
    console.log('AI disconnected, reconnecting in 2s...');
    setTimeout(() => connect(), 2000);
  });

  ws.on('error', (err) => {
    console.error('AI connection error:', err.message);
    setTimeout(() => {
      console.log('AI retrying connection...');
      connect();
    }, 1000);
  });
}

connect();
