/**
 * @module games/launcher
 *
 * Spawns game-server child processes for each new game. Each game gets
 * its own port (incrementing from GAME_PORT_BASE) and receives the
 * JWT_SECRET via environment variable so it can verify player tokens.
 * The launcher waits for the game server to print its "listening" message
 * before returning, ensuring clients don't connect before it's ready.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import type { GameAction, EvaluatedAction } from '@meccg/shared';
import { GAME_PORT_BASE, JWT_SECRET, DEV } from '../config.js';
import { signGameToken } from '../auth/jwt.js';
import { lobbyLog } from '../lobby-log.js';

const GAME_SERVER_ENTRY = path.join(__dirname, '../../../game-server/src/ws/server.ts');

/** Next available port for game servers. */
let nextPort = GAME_PORT_BASE;

/** Active game processes keyed by port. */
const activeGames = new Map<number, ChildProcess>();

/** IPC relay for pseudo-AI games, allowing the lobby to forward actions. */
export interface PseudoAiRelay {
  /** Register callback for when the AI receives legal actions from the game server. */
  onActions(callback: (actions: readonly EvaluatedAction[], phase: string) => void): void;
  /** Send the human's chosen action to the pseudo-AI client. */
  sendPick(action: GameAction): void;
}

/** Result of launching a game. */
export interface LaunchResult {
  /** Port the game server is listening on. */
  readonly port: number;
  /** JWT tokens for [player1, player2]. */
  readonly tokens: [string, string];
  /** Register a callback for when the game ends (child process exits). */
  onEnd(callback: () => void): void;
  /** IPC relay for pseudo-AI games. Null for regular and random-AI games. */
  readonly pseudoAiRelay: PseudoAiRelay | null;
}

/** Options for launching a game. */
export interface LaunchOptions {
  /** Whether player2 is an AI (spawn a headless AI client). */
  ai?: boolean;
  /** Catalog deck ID for the AI opponent to use. */
  aiDeckId?: string;
  /** Whether the AI is a pseudo-AI (human controls both sides via IPC relay). */
  pseudoAi?: boolean;
}

/**
 * Launch a new game-server process for the given players.
 * Waits for the server to be ready before resolving.
 * Returns the port, game tokens, and an onEnd hook.
 */
/** Check if a port is available by attempting to listen on it briefly. */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(() => resolve(true)); });
    server.listen(port);
  });
}

export async function launchGame(player1: string, player2: string, options?: LaunchOptions): Promise<LaunchResult> {
  // Skip ports that are still in use (e.g. orphaned game servers from a previous lobby instance)
  while (!await isPortFree(nextPort)) {
    lobbyLog.log('port-in-use', { port: nextPort });
    nextPort++;
  }
  const port = nextPort++;
  const gameId = `${player1}-vs-${player2}-${Date.now()}`;
  const tokens: [string, string] = [
    signGameToken(player1, gameId),
    signGameToken(player2, gameId),
  ];

  const env = {
    ...process.env,
    PORT: String(port),
    JWT_SECRET,
    DEV: DEV ? '1' : '',
  };

  const child = spawn('npx', ['tsx', GAME_SERVER_ENTRY, player1, player2, '--dev'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeGames.set(port, child);

  const endCallbacks: (() => void)[] = [];

  // Wait for the game server to print its "listening" message
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Game server on port ${port} failed to start within 15s`));
    }, 15000);

    child.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        lobbyLog.log('game-stdout', { port, line });
        if (line.includes('listening on port')) {
          clearTimeout(timeout);
          resolve();
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        lobbyLog.log('game-stderr', { port, line });
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Game server exited with code ${code} before becoming ready`));
    });
  });

  child.on('exit', (code) => {
    lobbyLog.log('game-exit', { port, code });
    activeGames.delete(port);
    for (const cb of endCallbacks) cb();
  });

  // If this is an AI game, spawn the AI client now (server is ready)
  let pseudoAiRelay: PseudoAiRelay | null = null;

  if (options?.ai) {
    const isPseudo = options.pseudoAi ?? false;
    const aiScript = path.join(__dirname, isPseudo ? './pseudo-ai-client.ts' : './ai-client.ts');
    const aiArgs = ['tsx', aiScript, String(port), player2, tokens[1]];
    if (options?.aiDeckId) aiArgs.push('--deck', options.aiDeckId);
    const aiChild = spawn('npx', aiArgs, {
      env: process.env,
      stdio: isPseudo ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    });
    aiChild.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        lobbyLog.log('ai-stdout', { port, line });
      }
    });
    aiChild.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        lobbyLog.log('ai-stderr', { port, line });
      }
    });
    child.on('exit', () => {
      if (!aiChild.killed) aiChild.kill();
    });

    // Wire up IPC relay for pseudo-AI games
    if (isPseudo) {
      const actionCallbacks: ((actions: readonly EvaluatedAction[], phase: string) => void)[] = [];
      aiChild.on('message', (msg: { type: string; actions?: readonly EvaluatedAction[]; phase?: string }) => {
        if (msg.type === 'pseudo-ai-actions' && msg.actions && msg.phase) {
          for (const cb of actionCallbacks) cb(msg.actions, msg.phase);
        }
      });
      pseudoAiRelay = {
        onActions(callback) { actionCallbacks.push(callback); },
        sendPick(action) { aiChild.send({ type: 'pseudo-ai-pick', action }); },
      };
    }
  }

  return {
    port,
    tokens,
    onEnd(callback: () => void) {
      endCallbacks.push(callback);
    },
    pseudoAiRelay,
  };
}

/** Check whether a port is currently hosting an active game-server child process. */
export function isActiveGamePort(port: number): boolean {
  return activeGames.has(port);
}

/** Kill all active game server processes (called on lobby shutdown). */
export function shutdownAllGames(): void {
  for (const [port, child] of activeGames) {
    lobbyLog.log('game-kill', { port });
    child.kill('SIGTERM');
  }
  activeGames.clear();
}
