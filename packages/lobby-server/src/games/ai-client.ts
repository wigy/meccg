/**
 * @module games/ai-client
 *
 * Headless AI player that connects to a game server via WebSocket
 * and makes random legal moves. Spawned as a child process by the
 * game launcher when a player starts a game against AI.
 *
 * Usage: npx tsx ai-client.ts <port> <playerName> <token>
 */

import { WebSocket } from 'ws';
import type { ServerMessage, ClientMessage, GameAction, EvaluatedAction } from '@meccg/shared';
import { SAMPLE_DECKS } from '@meccg/shared';

const PORT = parseInt(process.argv[2], 10);
const PLAYER_NAME = process.argv[3];
const TOKEN = process.argv[4];

let shouldReconnect = false;

if (!PORT || !PLAYER_NAME || !TOKEN) {
  console.error('Usage: ai-client <port> <playerName> <token>');
  process.exit(1);
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
    console.log('AI connected, sending join...');
    // Use the hero sample deck
    const deck = SAMPLE_DECKS[0];
    const joinMsg = deck.buildJoinMessage(PLAYER_NAME);
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
        shouldReconnect = true;
        break;

      case 'disconnected':
        console.log('AI: opponent disconnected');
        break;
    }
  });

  ws.on('close', () => {
    if (shouldReconnect) {
      shouldReconnect = false;
      console.log('AI reconnecting in 2s...');
      setTimeout(() => connect(), 2000);
    } else {
      console.log('AI disconnected');
      process.exit(0);
    }
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
