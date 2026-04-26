/**
 * @module ai-client
 *
 * Headless AI player that connects to a game server via WebSocket
 * and submits legal moves chosen by the heuristic ("Smart") strategy.
 * Card definitions are loaded once at start so the strategy can score
 * actions against the static card pool.
 *
 * Usage: npx tsx ai-client.ts <port> <playerName> <token> --deck <deckId>
 */

import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import type { ServerMessage, ClientMessage, GameAction, EvaluatedAction, CardDefinitionId, PlayerView } from '@meccg/shared';
import type { AiContext, WeightedAction } from './ai/index.js';
import { Alignment, loadCardPool, describeAction, buildInstanceLookup, buildCompanyNames, stripCardMarkers } from '@meccg/shared';
import { loadAiStrategy, sampleWeighted } from './ai/index.js';
import type { JoinMessage } from '@meccg/shared';

const args = process.argv.filter(a => !a.startsWith('--'));
const PORT = parseInt(args[2], 10);
const PLAYER_NAME = args[3];
const TOKEN = args[4];
const DECK_FLAG_IDX = process.argv.indexOf('--deck');
const DECK_ID = DECK_FLAG_IDX >= 0 ? process.argv[DECK_FLAG_IDX + 1] : undefined;

if (!PORT || !PLAYER_NAME || !TOKEN) {
  console.error('Usage: ai-client <port> <playerName> <token> [--deck <deckId>]');
  process.exit(1);
}

const strategy = loadAiStrategy('heuristic');
if (!strategy) {
  console.error('Heuristic AI strategy is not available — this should never happen.');
  process.exit(1);
}
console.log(`AI using strategy: ${strategy.name}`);

/** Static card pool — loaded once and reused for every decision. */
const cardPool = loadCardPool();

/** Random integer in [min, max] inclusive. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick the per-decision delay (ms). Body checks against the human take longer. */
function decisionDelayMs(action: GameAction, view: import('@meccg/shared').PlayerView): number {
  // Body check against an opponent character: 3-4 seconds.
  if (action.type === 'body-check-roll') {
    const combat = view.combat;
    if (combat && combat.bodyCheckTarget === 'character' && combat.defendingPlayerId !== view.self.id) {
      return randInt(3000, 4000);
    }
  }
  // Default: 0.5-1.5 seconds for natural pacing.
  return randInt(500, 1500);
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

/** Maximum number of weighted candidates to print per decision. */
const LOG_TOP_N = 6;

/** Render a single weighted action as a one-line summary for the log. */
function describeWeighted(weighted: WeightedAction, view: PlayerView): string {
  const lookup = buildInstanceLookup(view);
  const companies = buildCompanyNames(view.self.companies, view.self.characters, cardPool);
  const desc = stripCardMarkers(describeAction(weighted.action, cardPool, lookup, companies));
  return `${desc}  [w=${weighted.weight}]`;
}

/**
 * Pick the next action by delegating to the active strategy and emit a
 * decision summary to stdout. The summary lists the top weighted candidates
 * with their score so a tail of the lobby log shows what the AI is thinking.
 */
function pickAction(view: PlayerView, actions: readonly GameAction[]): GameAction {
  const context: AiContext = { view, cardPool, legalActions: actions };
  const weighted = strategy!.weighActions(context);
  if (weighted.length === 0) {
    console.log(`AI [${view.phaseState.phase}] no weighted actions, defaulting to first legal action`);
    return actions[0];
  }

  const picked = sampleWeighted(weighted);
  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  const top = [...weighted]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, LOG_TOP_N);

  console.log(`AI [${view.phaseState.phase}] weighing ${weighted.length} actions (total weight ${totalWeight}):`);
  for (const cand of top) {
    const marker = cand.action === picked ? '→' : ' ';
    console.log(`  ${marker} ${describeWeighted(cand, view)}`);
  }
  if (weighted.length > LOG_TOP_N) {
    console.log(`    … and ${weighted.length - LOG_TOP_N} more`);
  }
  return picked;
}

function connect(): void {
  const url = `ws://localhost:${PORT}`;
  console.log(`AI connecting to ${url} as "${PLAYER_NAME}"...`);
  const ws = new WebSocket(url);

  ws.on('open', () => {
    let joinMsg: JoinMessage;
    if (DECK_ID) {
      console.log(`AI connected, sending join with deck "${DECK_ID}"...`);
      joinMsg = loadDeckFile(DECK_ID);
    } else {
      // Rejoin: server already has game state from autosave, send minimal join
      console.log('AI connected, sending minimal join (rejoin)...');
      joinMsg = { type: 'join', name: PLAYER_NAME, alignment: Alignment.Wizard, draftPool: [], playDeck: [], siteDeck: [], sideboard: [] };
    }
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

        // Pick now so we can compute the right delay (body-check rolls
        // against the human player get a longer pause for tension).
        const action = pickAction(msg.view, actions);
        const delayMs = decisionDelayMs(action, msg.view);
        const lookup = buildInstanceLookup(msg.view);
        const companies = buildCompanyNames(msg.view.self.companies, msg.view.self.characters, cardPool);
        const summary = stripCardMarkers(describeAction(action, cardPool, lookup, companies));
        setTimeout(() => {
          console.log(`AI action: ${summary} (delay ${delayMs}ms)`);
          const actionMsg: ClientMessage = { type: 'action', action };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(actionMsg));
          }
        }, delayMs);
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
