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
import * as path from 'path';
import { GAME_PORT_BASE, JWT_SECRET, DEV } from '../config.js';
import { signGameToken } from '../auth/jwt.js';

const GAME_SERVER_ENTRY = path.join(__dirname, '../../../game-server/src/ws/server.ts');

/** Next available port for game servers. */
let nextPort = GAME_PORT_BASE;

/** Active game processes keyed by port. */
const activeGames = new Map<number, ChildProcess>();

/** Result of launching a game. */
export interface LaunchResult {
  /** Port the game server is listening on. */
  readonly port: number;
  /** JWT tokens for [player1, player2]. */
  readonly tokens: [string, string];
  /** Register a callback for when the game ends (child process exits). */
  onEnd(callback: () => void): void;
}

/** Options for launching a game. */
export interface LaunchOptions {
  /** Whether player2 is an AI (spawn a headless AI client). */
  ai?: boolean;
}

/**
 * Launch a new game-server process for the given players.
 * Waits for the server to be ready before resolving.
 * Returns the port, game tokens, and an onEnd hook.
 */
export async function launchGame(player1: string, player2: string, options?: LaunchOptions): Promise<LaunchResult> {
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

  const prefix = `[game:${port}]`;
  const endCallbacks: (() => void)[] = [];

  // Wait for the game server to print its "listening" message
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Game server on port ${port} failed to start within 15s`));
    }, 15000);

    child.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        console.log(`${prefix} ${line}`);
        if (line.includes('listening on port')) {
          clearTimeout(timeout);
          resolve();
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        console.error(`${prefix} ${line}`);
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Game server exited with code ${code} before becoming ready`));
    });
  });

  child.on('exit', (code) => {
    console.log(`${prefix} exited with code ${code}`);
    activeGames.delete(port);
    for (const cb of endCallbacks) cb();
  });

  // If this is an AI game, spawn the AI client now (server is ready)
  if (options?.ai) {
    const aiScript = path.join(__dirname, './ai-client.ts');
    const aiChild = spawn('npx', ['tsx', aiScript, String(port), player2, tokens[1]], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    aiChild.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        console.log(`[ai:${port}] ${line}`);
      }
    });
    aiChild.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        console.error(`[ai:${port}] ${line}`);
      }
    });
    child.on('exit', () => {
      if (!aiChild.killed) aiChild.kill();
    });
  }

  return {
    port,
    tokens,
    onEnd(callback: () => void) {
      endCallbacks.push(callback);
    },
  };
}

/** Kill all active game server processes (called on lobby shutdown). */
export function shutdownAllGames(): void {
  for (const [port, child] of activeGames) {
    console.log(`Killing game server on port ${port}`);
    child.kill('SIGTERM');
  }
  activeGames.clear();
}
