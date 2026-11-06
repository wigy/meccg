/**
 * @module cli/human-results
 *
 * How is each AI doing against people, in numbers that can move?
 *
 * Win rate alone barely can: the AI wins few games, so a real improvement shows
 * up as noise for months. Margin and pace can. So this reports, per AI and
 * month, games finished on marshalling points (a forfeited game has no value and
 * counts nowhere), wins, the median final margin, and where the points come from — and
 * for the chosen AI, the raw points of both seats turn by turn, which is what
 * showed the modular AI stalling at 8–10 points from turn 6 while humans gain
 * one a turn.
 *
 * It reads the corpus and writes nothing.
 *
 * Usage:
 *   npm run human-results -w @meccg/sim -- --dir ~/backup/ai-meccg.com [--agent AI-Modular] [--since 2026-10]
 */

import * as fs from 'fs';
import * as path from 'path';
import { cliPreamble, stringFlag } from './common.js';
import { categoryTable, paceTable, playedOut, resultsByMonth, seatsOf } from './human-results-core.js';
import type { FinishedGame, Pace } from './human-results-core.js';

const USAGE = `Usage: human-results --dir <corpus> [--agent <name>] [--since <YYYY-MM>]

How each AI is doing against people, from a recorded corpus.
  --dir    corpus directory holding games/ and logs/games/
  --agent  the AI seat the category and pace tables describe (default AI-Modular)
  --since  leave out games started before this month, in those two tables`;

const args = cliPreamble(USAGE);
const dir = stringFlag(args, 'dir');
if (!dir) {
  console.error('human-results: pass --dir <corpus>');
  process.exit(2);
}
const agent = stringFlag(args, 'agent') ?? 'AI-Modular';
const since = stringFlag(args, 'since') ?? '';

const games: FinishedGame[] = fs.readdirSync(path.join(dir, 'games'))
  .filter(file => file.endsWith('.json'))
  .map(file => JSON.parse(fs.readFileSync(path.join(dir, 'games', file), 'utf-8')) as FinishedGame);

console.log('month    AI                 finished  AI wins  median margin (human − AI)');
for (const row of resultsByMonth(games)) {
  console.log(`${row.month}  ${row.agent.padEnd(18)} ${String(row.finished).padStart(8)}  ${String(row.aiWins).padStart(7)}  ${row.medianMargin}`);
}

const chosen = games.filter(game => playedOut(game) && game.startedAt >= since && seatsOf(game)?.ai.name === agent);
console.log(`\n${agent}${since ? ` since ${since}` : ''}: ${chosen.length} games\n`);
console.log('category   human median/mean   AI median/mean   AI games at zero');
for (const row of categoryTable(chosen)) {
  console.log(`${row.category.padEnd(10)} ${`${row.humanMedian} / ${row.humanMean.toFixed(1)}`.padEnd(19)} `
    + `${`${row.aiMedian} / ${row.aiMean.toFixed(1)}`.padEnd(16)} ${row.aiZero}/${chosen.length}`);
}

/** The raw points of both seats at the start of each turn of one game. */
function paceOf(game: FinishedGame): Pace | null {
  const seats = seatsOf(game);
  const file = path.join(dir!, 'logs', 'games', `${game.gameId}.jsonl`);
  if (!seats || !fs.existsSync(file)) return null;
  const pace = new Map<number, { human: number; ai: number }>();
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (line.length === 0) continue;
    let record: { turn?: number; state?: { players?: { id: string; marshallingPoints: Record<string, number> }[] } };
    try {
      record = JSON.parse(line) as typeof record;
    } catch {
      continue;
    }
    const turn = record.turn;
    if (turn === undefined || !record.state?.players || pace.has(turn)) continue;
    const pointsOf = (id: string): number => Object.values(
      record.state!.players!.find(p => p.id === id)?.marshallingPoints ?? {},
    ).reduce((sum, points) => sum + points, 0);
    pace.set(turn, { human: pointsOf(seats.human.playerId), ai: pointsOf(seats.ai.playerId) });
  }
  return pace;
}

console.log('\nturn  human  AI  games');
const paces = chosen.map(paceOf).filter((pace): pace is Pace => pace !== null);
for (const row of paceTable(paces)) {
  console.log(`${String(row.turn).padStart(4)}  ${String(row.human).padStart(5)}  ${String(row.ai).padStart(2)}  ${row.games}`);
}
