/**
 * @module cli/play
 *
 * Play headless games with a live decision transcript and optional replay
 * recording.
 *
 * Usage:
 *   npm run play -w @meccg/sim -- [--games N] [--seed S]
 *     [--agents a,b] [--decks d1,d2] [--max-decisions N]
 *     [--replay-dir DIR] [--quiet] [--no-candidates] [--max-candidates N]
 */

import * as fs from 'fs';
import * as path from 'path';
import { playGame } from '../runner.js';
import { ReplayWriter } from '../replay.js';
import { TranscriptPrinter } from '../transcript.js';
import type { GameObserver } from '../types.js';
import { parseCliArgs, numberFlag, resolveAgent, resolvePair, resolveDecks } from './common.js';

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const games = numberFlag(args, 'games', 1);
  const baseSeed = numberFlag(args, 'seed', Date.now() % 1_000_000_000);
  const maxDecisions = numberFlag(args, 'max-decisions', 25000);
  const agentNames = resolvePair(args, 'agents', ['heuristic', 'heuristic']);
  const decks = resolveDecks(args);
  const replayDir = typeof args.flags['replay-dir'] === 'string' ? args.flags['replay-dir'] : undefined;
  const quiet = args.flags['quiet'] === true;

  if (replayDir !== undefined) fs.mkdirSync(replayDir, { recursive: true });

  for (let i = 0; i < games; i++) {
    const seed = baseSeed + i;
    const observers: GameObserver[] = [];
    if (!quiet) {
      observers.push(new TranscriptPrinter({
        showCandidates: args.flags['no-candidates'] !== true,
        maxCandidates: numberFlag(args, 'max-candidates', 6),
      }));
    }
    let writer: ReplayWriter | undefined;
    let replayPath: string | undefined;
    if (replayDir !== undefined) {
      replayPath = path.join(replayDir, `replay-${decks[0].id}-vs-${decks[1].id}-seed${seed}.jsonl`);
      writer = new ReplayWriter(replayPath);
      observers.push(writer);
    }

    const run = playGame({
      agents: [resolveAgent(agentNames[0]), resolveAgent(agentNames[1])],
      decks,
      seed,
      maxDecisions,
      observers,
    });
    await writer?.close();

    if (quiet) {
      const r = run.result;
      const outcome = r.outcome === 'completed'
        ? `winner ${String(r.winner)} by ${r.winReason ?? '?'}`
        : `${r.outcome}${r.error ? ` (${r.error})` : ''}`;
      console.log(`seed ${seed}: ${outcome} — ${r.turns} turns, ${r.decisions} decisions, ${(r.durationMs / 1000).toFixed(1)}s`);
    }
    if (replayPath !== undefined) {
      console.log(`Replay saved to ${replayPath}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
