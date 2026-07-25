/**
 * @module cli/jobs
 *
 * Child-process fan-out for the sim CLIs. Games are independent and fully
 * seeded, so a batch of N games splits into J contiguous seed slices run
 * by J child processes with bit-identical results to a serial run — the
 * merge just preserves seed order. Children are fresh `tsx` processes
 * running the same CLI scripts (worker_threads would need loader
 * gymnastics under tsx; a ~2s process startup amortizes over minutes of
 * simulation).
 */

import { spawn } from 'child_process';

/** One contiguous slice of a game batch. */
export interface GameSlice {
  /** Slice index in [0, jobs). */
  readonly index: number;
  /** First game index (0-based within the batch) of this slice. */
  readonly firstGame: number;
  /** Number of games in this slice. */
  readonly games: number;
}

/** Splits `games` into at most `jobs` contiguous, seed-ordered slices. */
export function sliceGames(games: number, jobs: number): GameSlice[] {
  const sliceCount = Math.max(1, Math.min(jobs, games));
  const slices: GameSlice[] = [];
  let assigned = 0;
  for (let i = 0; i < sliceCount; i++) {
    const size = Math.floor(games / sliceCount) + (i < games % sliceCount ? 1 : 0);
    slices.push({ index: i, firstGame: assigned, games: size });
    assigned += size;
  }
  return slices;
}

/**
 * Runs a CLI script once per argument list, all concurrently, and resolves
 * with each child's captured stdout. Rejects if any child exits non-zero
 * (with its stderr tail in the message). Children inherit the parent's
 * working directory and environment.
 */
export function runChildren(scriptPath: string, argLists: readonly (readonly string[])[]): Promise<string[]> {
  return Promise.all(argLists.map(argList => new Promise<string>((resolve, reject) => {
    const child = spawn('npx', ['tsx', scriptPath, ...argList], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`child ${scriptPath} exited ${code}: ${stderr.slice(-2000)}`));
    });
  })));
}
