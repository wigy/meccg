/**
 * @module cli/headtohead
 *
 * Who actually wins? — a head-to-head with the seats swapped every game.
 *
 * `gate` does this properly, with Elo and parallel children, and it is the tool
 * to reach for when a change needs a verdict. This is the smaller thing: a
 * plain paired match that prints each game as it finishes, so a run can be
 * watched rather than waited on. A 24-game `gate` run produced no output for an
 * hour, which is a bad way to learn how slow an agent is.
 *
 * Seats are swapped every game and both seatings share a seed, so the pair
 * differs only in who moved first — the same control `gate` uses, because
 * moving first in MECCG is worth something and an unpaired sample measures that
 * along with everything else.
 *
 * Usage:
 *   npm run headtohead -w @meccg/sim -- [--games 6] [--agents h2,heuristic] [--seed 1]
 */

import { setEngineConsoleLog } from '@meccg/shared';
import { playGame } from '../runner.js';
import { parseCliArgs, numberFlag, resolveAgent, resolvePair, resolveDecks } from './common.js';
import type { Agent } from '../types.js';

/** Flag reference, printed by `--help`. */
const USAGE = `headtohead — who actually wins, with the seats swapped every game

Usage:
  npm run headtohead -w @meccg/sim -- [options]

Options:
  --games <n>       paired games; each pair plays both seatings (default 6)
  --agents <a,b>    the two agents (default h2,heuristic)
  --decks <a,b>     deck IDs
  --seed <n>        base seed (default 1)
  --max-decisions   abandon a game after this many decisions (default 6000)
  --help            this message
`;

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
setEngineConsoleLog(false);

const pairs = numberFlag(args, 'games', 6);
const baseSeed = numberFlag(args, 'seed', 1);
const [specA, specB] = resolvePair(args, 'agents', ['h2', 'heuristic']);
const decks = resolveDecks(args);
// The runner's own cap is 25000, which at H2's speed is minutes of a game that
// has already stopped being a game. A pass-loop between two agents is a real
// outcome worth seeing reported, not something to wait out.
const maxDecisions = numberFlag(args, 'max-decisions', 6000);

let winsA = 0;
let winsB = 0;
let draws = 0;

for (let g = 0; g < pairs; g++) {
  for (const swapped of [false, true]) {
    const agents: readonly [Agent, Agent] = swapped
      ? [resolveAgent(specB), resolveAgent(specA)]
      : [resolveAgent(specA), resolveAgent(specB)];
    const { result } = playGame({ agents, decks, seed: baseSeed + g, maxDecisions });
    // Scores come back keyed by player ID, and the seat A occupies alternates,
    // so read them by seat and unswap before counting.
    const scores = result.finalScores ?? {};
    const ids = Object.keys(scores);
    const seat0 = scores[ids[0]] ?? 0;
    const seat1 = scores[ids[1]] ?? 0;
    const scoreA = swapped ? seat1 : seat0;
    const scoreB = swapped ? seat0 : seat1;
    if (result.outcome !== 'completed') {
      // A deadlocked or errored game is not a draw — counting it as one would
      // quietly credit whichever agent caused it.
      console.log(`  game ${g + 1}${swapped ? 'b' : 'a'}: ${result.outcome} after `
        + `${result.decisions} decisions — not counted`);
      continue;
    }
    if (scoreA > scoreB) winsA++;
    else if (scoreB > scoreA) winsB++;
    else draws++;
    console.log(`  game ${g + 1}${swapped ? 'b' : 'a'}: ${specA} ${scoreA} — ${scoreB} ${specB}`
      + `   (running ${winsA}-${winsB}${draws > 0 ? `-${draws}` : ''})`);
  }
}

const played = winsA + winsB + draws;
console.log('');
console.log(`${specA} ${winsA} — ${winsB} ${specB}${draws > 0 ? ` (${draws} drawn)` : ''}`
  + ` over ${played} games`);
const rate = played > 0 ? ((winsA + draws / 2) / played) * 100 : 0;
console.log(`${specA} scores ${rate.toFixed(1)}% of the points available.`);
console.log('');
if (played < pairs * 2) {
  console.log(`${pairs * 2 - played} game(s) did not complete and are excluded.`);
}
console.log('');
console.log('Paired seatings, so first-move advantage cancels. This is a small sample:');
console.log('a dozen games separate nothing but a landslide — use `gate` for a verdict.');
