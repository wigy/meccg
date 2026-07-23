/**
 * @module cli/replay
 *
 * Replay playback: renders a saved replay file as a human-readable
 * transcript — the agents' decision-making (weighted candidates, chosen
 * actions) alongside the game events (transitions, dice rolls,
 * notifications) — and optionally verifies the replay by deterministic
 * re-simulation.
 *
 * Usage:
 *   npm run replay -w @meccg/sim -- <replay.jsonl>
 *     [--verify] [--no-candidates] [--max-candidates N] [--steps] [--quiet]
 */

import { readReplay, verifyReplay } from '../replay.js';
import { renderHeader, renderTransition, renderDecision, renderResult } from '../transcript.js';
import type { TranscriptOptions, TransitionRecord } from '../index.js';
import { parseCliArgs, numberFlag } from './common.js';

const args = parseCliArgs(process.argv.slice(2));
const file = args.positional[0];
if (!file) {
  console.error('Usage: replay <replay.jsonl> [--verify] [--no-candidates] [--max-candidates N] [--steps] [--quiet]');
  process.exit(1);
}

const replay = readReplay(file);

if (args.flags['quiet'] !== true) {
  const options: TranscriptOptions = {
    showCandidates: args.flags['no-candidates'] !== true,
    maxCandidates: numberFlag(args, 'max-candidates', 6),
    showSteps: args.flags['steps'] === true,
  };
  for (const line of renderHeader(replay.header)) console.log(line);
  let previous: TransitionRecord | null = null;
  for (const record of replay.records) {
    if (record.kind === 'transition') {
      for (const line of renderTransition(record, previous, options)) console.log(line);
      previous = record;
    } else {
      for (const line of renderDecision(record, options)) console.log(line);
    }
  }
  if (replay.result) {
    for (const line of renderResult(replay.result, replay.header)) console.log(line);
  } else {
    console.log('\n(replay file has no result record — the game was interrupted)');
  }
}

if (args.flags['verify'] === true) {
  console.log('\nVerifying replay by re-simulation…');
  const verification = verifyReplay(replay);
  if (verification.ok) {
    console.log(`✓ Replay verified: ${verification.decisionsReplayed} decisions re-applied deterministically.`);
  } else {
    console.error(`✗ Replay verification FAILED after ${verification.decisionsReplayed} decisions:`);
    for (const mismatch of verification.mismatches) console.error(`  - ${mismatch}`);
    process.exit(2);
  }
}
