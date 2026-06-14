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
import type { ClientMessage, EvaluatedAction } from '@meccg/shared';
import { parseSpawnedClientArgs, spawnedJoinPayload, logCommonServerMessage, installReconnect, parseServerMessage } from './client-common.js';

const clientArgs = parseSpawnedClientArgs('pseudo-ai-client');

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
  const url = `ws://localhost:${clientArgs.port}`;
  console.log(`Pseudo-AI connecting to ${url} as "${clientArgs.playerName}"...`);
  const ws = new WebSocket(url);
  gameWs = ws;

  ws.on('open', () => {
    ws.send(spawnedJoinPayload(clientArgs, 'Pseudo-AI'));
  });

  ws.on('message', (raw: Buffer) => {
    const msg = parseServerMessage(raw);
    if (msg.type !== 'state') {
      logCommonServerMessage('Pseudo-AI', msg);
      return;
    }

    const evaluated: readonly EvaluatedAction[] = msg.view.legalActions;
    if (!evaluated || evaluated.length === 0) return;
    const phase = msg.view.phaseState.phase;
    // Relay legal actions to the lobby via IPC for the human to decide
    console.log(`Pseudo-AI relaying ${evaluated.length} actions (phase: ${phase})`);
    process.send!({ type: 'pseudo-ai-actions', actions: evaluated, phase });
  });

  installReconnect(ws, 'Pseudo-AI', connect, () => { gameWs = null; });
}

connect();
