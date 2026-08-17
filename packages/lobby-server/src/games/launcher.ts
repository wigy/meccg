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

/**
 * tsx tsconfig for spawned game servers: maps @meccg/shared onto its SOURCE
 * instead of the package's built dist. The children run TypeScript via tsx
 * anyway, and resolving dist made them hostage to stale/mid-edit compiler
 * output (a half-emitted tutorial script once crashed every broadcast).
 */
const GAME_SERVER_TSCONFIG = path.join(__dirname, '../../../game-server/tsconfig.dev.json');

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
  /**
   * The game id the server logs under — `~/.meccg/logs/games/<gameId>.jsonl`.
   * Returned so the lobby can hand it to the Ask AI observer, whose whole view
   * of the position is that log (`specs/2026-08-17-ask-ai-observer.md`).
   */
  readonly gameId: string;
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
  /**
   * Trained-model weights path for a Real-AI opponent. Forwarded to the
   * spawned AI client as `--model <path>`; without it the client plays the
   * heuristic strategy.
   */
  aiModelPath?: string;
  /**
   * Sim agent registry spec for the AI opponent (e.g. `mc:ms=2000/turns=2`),
   * forwarded as `--agent <spec>`. Falls back to the `MECCG_AI_AGENT`
   * environment variable, which is how a non-default agent is selected
   * server-wide without a lobby protocol change.
   */
  aiAgentSpec?: string;
  /**
   * Launch the guided tutorial: the game server runs with `--tutorial`,
   * player2 ("Mentor") is played server-side by the game session's
   * TutorialController, and no AI client is spawned.
   */
  tutorial?: boolean;
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

/**
 * Forward a child process output stream to the lobby log line by line under
 * the given event name. `onLine` additionally sees each line (e.g. to detect
 * the game server's "listening" message).
 */
function forwardChildLines(
  stream: NodeJS.ReadableStream | null,
  event: string,
  port: number,
  onLine?: (line: string) => void,
): void {
  stream?.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n').filter(Boolean)) {
      lobbyLog.log(event, { port, line });
      onLine?.(line);
    }
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

  const serverArgs = ['tsx', '--tsconfig', GAME_SERVER_TSCONFIG, GAME_SERVER_ENTRY, player1, player2, '--dev'];
  if (options?.tutorial) serverArgs.push('--tutorial');
  const child = spawn('npx', serverArgs, {
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

    forwardChildLines(child.stdout, 'game-stdout', port, (line) => {
      if (line.includes('listening on port')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    forwardChildLines(child.stderr, 'game-stderr', port);

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
    const aiScript = path.join(__dirname, '../../../text-client/src/', isPseudo ? 'pseudo-ai-client.ts' : 'ai-client.ts');
    if (!options.aiDeckId) {
      throw new Error('aiDeckId is required to start an AI game');
    }
    const aiArgs = ['tsx', aiScript, String(port), player2, tokens[1], '--deck', options.aiDeckId];
    // A sim agent spec wins over a trained model: it is the more general
    // seam (`bc:weights.json` is itself a valid spec), and it is how a
    // non-model agent such as the flat Monte-Carlo searcher is selected.
    const agentSpec = options.aiAgentSpec ?? process.env.MECCG_AI_AGENT;
    if (agentSpec) aiArgs.push('--agent', agentSpec);
    else if (options.aiModelPath) aiArgs.push('--model', options.aiModelPath);
    const aiChild = spawn('npx', aiArgs, {
      env: process.env,
      stdio: isPseudo ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    });
    forwardChildLines(aiChild.stdout, 'ai-stdout', port);
    forwardChildLines(aiChild.stderr, 'ai-stderr', port);
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
        sendPick(action) {
          try {
            aiChild.send({ type: 'pseudo-ai-pick', action });
          } catch (err) {
            lobbyLog.log('error', { context: 'pseudo-ai-send', error: String(err) });
          }
        },
      };
    }
  }

  return {
    port,
    gameId,
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

/**
 * Kill the game-server child on `port` if it is still running, resolving
 * once the process has exited. Used when a relaunch replaces a still-live
 * server: the old child would otherwise linger until its idle-exit grace
 * period ran out, showing the same game twice in the watchable list.
 * Waiting for the exit matters because the child writes a final autosave
 * on SIGTERM — a caller that deletes or restores saves must not race it.
 * The exit fires the normal onEnd cleanup.
 */
export function killGame(port: number): Promise<void> {
  const child = activeGames.get(port);
  if (!child) return Promise.resolve();
  lobbyLog.log('game-kill', { port });
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

/** Kill all active game server processes (called on lobby shutdown). */
export function shutdownAllGames(): void {
  for (const [port, child] of activeGames) {
    lobbyLog.log('game-kill', { port });
    child.kill('SIGTERM');
  }
  activeGames.clear();
}
